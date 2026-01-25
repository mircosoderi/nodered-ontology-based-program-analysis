module.exports = function (RED) {
  "use strict";

  const TOPIC = "urdf/events";

  const express = require("express");
  const jsonParser = express.json({ limit: "5mb" });
  const fs = require("fs");

  // Load uRDF module (singleton in-memory store lives inside it)
  let urdf;
  try {
    urdf = require("urdf");
    RED.log.info("[uRDF] module loaded");
  } catch (e) {
    RED.log.error("[uRDF] failed to load module 'urdf': " + e.message);
  }

  function publish(event) {
    try {
      if (RED.comms && typeof RED.comms.publish === "function") {
        RED.comms.publish(TOPIC, event);
      }
    } catch (_) {
      // never break runtime on push failures
    }
  }

  // -------------------------
  // Admin API fetch helper
  // -------------------------
  async function fetchAdminJson(path) {
    const port = Number(process.env.PORT || 1880);
    const p = path.startsWith("/") ? path : `/${path}`;
    const url = `http://127.0.0.1:${port}${p}`;

    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(
        `Admin API fetch failed: ${url} -> HTTP ${r.status}${text ? `; body=${text.slice(0, 200)}` : ""}`
      );
    }
    return await r.json();
  }

  // -------------------------
  // Ontology load (startup)
  // -------------------------
  async function loadOntologyJsonLdOnStartup() {
    if (!urdf) return;

    const filePath = process.env.URDF_ONTOLOGY_PATH || "/opt/urdf/app-ontology.jsonld";
    const gid = process.env.URDF_ONTOLOGY_GID || "urn:nrua:ontology";

    if (!fs.existsSync(filePath)) {
      RED.log.warn("[uRDF] Ontology file not found: " + filePath);
      return;
    }

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const doc = JSON.parse(raw);

      // load as named graph
      const toLoad = Array.isArray(doc) ? { "@id": gid, "@graph": doc } : { ...doc, "@id": gid };
      await urdf.load(toLoad);

      RED.log.info("[uRDF] Ontology JSON-LD loaded into gid=" + gid + " from " + filePath);

      publish({
        ts: Date.now(),
        type: "startupLoad",
        request: { method: "INIT", path: "ontology", summary: filePath },
        response: { ok: true, gid, filePath, totalSize: urdf.size() }
      });
    } catch (e) {
      RED.log.error("[uRDF] Failed to load ontology JSON-LD: " + (e?.message || String(e)));
    }
  }

  loadOntologyJsonLdOnStartup();

  // -------------------------
  // Environment load (startup from /diagnostics + /settings)
  // -------------------------
  const NRUA = "https://w3id.org/nodered-static-program-analysis/user-application-ontology#";
  const SCHEMA = "https://schema.org/";
  const GID_ENV = process.env.URDF_ENV_GID || "urn:nrua:env";

  function notUnset(v) {
    return typeof v !== "undefined" && v !== null && v !== "UNSET";
  }

  function stableJson(obj) {
    if (!obj || typeof obj !== "object") return JSON.stringify(obj);
    const out = {};
    Object.keys(obj)
      .sort()
      .forEach((k) => {
        out[k] = obj[k];
      });
    return JSON.stringify(out);
  }

  function buildEnvJsonLdFromAdmin({ diagnostics, settings }) {
    const osId = "urn:nrua:os";
    const nodeJsId = "urn:nrua:nodejs";
    const nodeRedId = "urn:nrua:nodered";

    const d = diagnostics || {};
    const s = settings || {};

    const osInfo = d.os || {};
    const nodeInfo = d.nodejs || {};
    const rt = d.runtime || {};
    const rtSettings = rt.settings && typeof rt.settings === "object" ? rt.settings : {};

    const graph = [];

    graph.push({
      "@id": osId,
      "@type": "schema:OperatingSystem",
      ...(notUnset(osInfo.type) ? { "schema:name": osInfo.platform } : {}),
      ...(notUnset(osInfo.release) ? { "schema:softwareVersion": osInfo.release } : {}),
      ...(notUnset(osInfo.version) ? { "schema:description": osInfo.version } : {}),
      ...(typeof osInfo.containerised === "boolean" ? { "nrua:isContainerised": osInfo.containerised } : {}),
      ...(typeof osInfo.wsl === "boolean" ? { "nrua:isWsl": osInfo.wsl } : {})
    });

    graph.push({
      "@id": nodeJsId,
      "@type": "nrua:NodeJs",
      ...(notUnset(nodeInfo.version) ? { "schema:version": nodeInfo.version } : {}),
      "schema:operatingSystem": { "@id": osId }
    });

    const nodeRed = {
      "@id": nodeRedId,
      "@type": "nrua:NodeRed",
      ...(notUnset(rt.version) ? { "schema:version": rt.version } : {}),
      // Node-RED runs on Node.js (schema slot)
      "schema:runtimePlatform": { "@id": nodeJsId }
    };

    graph.push(nodeRed);

    return {
      "@context": { nrua: NRUA, schema: SCHEMA },
      "@id": GID_ENV,
      "@graph": graph
    };
  }

  async function loadEnvironmentOnStartupFromAdminApi() {
    if (!urdf) return;

    const ts = Date.now();
    try {
      const diagnostics = await fetchAdminJson("/diagnostics");
      const settings = await fetchAdminJson("/settings");

      const envDoc = buildEnvJsonLdFromAdmin({ diagnostics, settings });
      await urdf.load(envDoc);

      const payload = { ok: true, ts, gid: GID_ENV, size: urdf.size(GID_ENV), totalSize: urdf.size() };
      publish({
        ts,
        type: "envLoad",
        request: { method: "INIT", path: "env", summary: "from /diagnostics + /settings" },
        response: payload
      });
      RED.log.info("[uRDF] Environment loaded from Node-RED Admin API into gid=" + GID_ENV);
    } catch (e) {
      const payload = { ok: false, ts, gid: GID_ENV, error: e?.message || String(e) };
      publish({
        ts,
        type: "envLoad",
        request: { method: "INIT", path: "env", summary: "from /diagnostics + /settings" },
        response: payload
      });
      RED.log.error("[uRDF] Environment load failed: " + payload.error);
      RED.log.error(
        "[uRDF] fetch error details: " +
          JSON.stringify({ message: e?.message, cause: e?.cause ? String(e.cause) : undefined })
      );
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function loadEnvironmentWhenAdminApiReady() {
    const ts0 = Date.now();
    const maxAttempts = 30;
    const delayMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fetchAdminJson("/diagnostics");
        await loadEnvironmentOnStartupFromAdminApi();
        RED.log.info(`[uRDF] Environment load succeeded after attempt ${attempt} (${Date.now() - ts0}ms)`);
        return;
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        RED.log.warn(`[uRDF] Env load attempt ${attempt}/${maxAttempts} failed: ${msg}`);
        await sleep(delayMs);
      }
    }
    RED.log.error("[uRDF] Env load aborted: Admin API never became reachable");
  }

  loadEnvironmentWhenAdminApiReady();

  // -------------------------
  // Application load from /flows (on deploy/start)
  // -------------------------
  const GID_APP = process.env.URDF_APP_GID || "urn:nrua:app";

  function appId() {
    return "urn:nrua:app";
  }
  function flowId(tabId) {
    return `urn:nrua:flow:${tabId}`;
  }
  function nodeId(id) {
    return `urn:nrua:node:${id}`;
  }
  function outId(id, gate) {
    return `urn:nrua:out:${id}:${gate}`;
  }

  const EXCLUDE_NODE_KEYS = new Set([
    // universal / irrelevant:
    "id",
    "type",
    "z",
    "x",
    "y",
    "wires",
    // not part of your KB goal for nodes:
    "info",
    // occasional metadata
    "d",
    "g"
  ]);

  function isPrimitive(v) {
    return v === null || ["string", "number", "boolean"].includes(typeof v);
  }

  function makeId(...parts) {
    // URN-safe deterministic id component encoding
    const enc = (s) =>
      encodeURIComponent(String(s))
        .replace(/%/g, "_"); // readable-ish and safe
    return parts.map(enc).join(":");
  }

  function encodeStructuredValue(graph, value, idBase) {
    // Arrays -> schema:ItemList with schema:ListItem elements
    if (Array.isArray(value)) {
      const listId = makeId(idBase, "list");
      const list = {
        "@id": listId,
        "@type": "schema:ItemList",
        "schema:itemListElement": []
      };

      value.forEach((item, idx) => {
        const liId = makeId(listId, "li", String(idx));
        const li = {
          "@id": liId,
          "@type": "schema:ListItem",
          "schema:position": idx
        };

        if (isPrimitive(item)) {
          li["schema:item"] = item;
        } else {
          const itemId = encodeStructuredValue(graph, item, makeId(liId, "item"));
          li["schema:item"] = { "@id": itemId };
        }

        graph.push(li);
        list["schema:itemListElement"].push({ "@id": liId });
      });

      graph.push(list);
      return listId;
    }

    // Objects -> schema:StructuredValue with additionalProperty entries
    const objId = makeId(idBase, "obj");
    const objNode = {
      "@id": objId,
      "@type": "schema:StructuredValue",
      "schema:additionalProperty": []
    };

    graph.push(objNode);

    // stable order for reproducibility
    for (const k of Object.keys(value || {}).sort()) {
      const v = value[k];

      const pvId = makeId(objId, "pv", k);
      const pv = { "@id": pvId, "@type": "schema:PropertyValue", "schema:name": k };

      if (isPrimitive(v)) {
        pv["schema:value"] = v;
      } else {
        const nestedId = encodeStructuredValue(graph, v, makeId(objId, "v", k));
        pv["schema:valueReference"] = { "@id": nestedId };
      }

      graph.push(pv);
      objNode["schema:additionalProperty"].push({ "@id": pvId });
    }

    return objId;
  }

  function addPropertyValue(graph, subjectId, key, value, baseId) {
    const pvId = makeId(baseId, "pv", key);

    const pv = {
      "@id": pvId,
      "@type": "schema:PropertyValue",
      "schema:name": key
    };

    if (isPrimitive(value)) {
      pv["schema:value"] = value;
    } else {
      const structuredId = encodeStructuredValue(graph, value, makeId(baseId, "v", key));
      pv["schema:valueReference"] = { "@id": structuredId };
    }

    graph.push(pv);

    // subject must already be in graph
    const subj = graph.find((x) => x && x["@id"] === subjectId);
    if (subj) {
      subj["schema:additionalProperty"] = subj["schema:additionalProperty"] || [];
      subj["schema:additionalProperty"].push({ "@id": pvId });
    }
  }

  function buildAppJsonLdFromFlows(flowsArray) {
    const graph = [];

    // Application
    graph.push({
      "@id": appId(),
      "@type": "schema:Application"
    });

    // Tabs -> Flow entities
    const tabs = flowsArray.filter((n) => n && n.type === "tab");
    for (const t of tabs) {
      graph.push({
        "@id": flowId(t.id),
        "@type": "nrua:AppFlow",
        "schema:identifier": String(t.id),
        ...(t.label ? { "schema:name": String(t.label) } : {}),
        "schema:isPartOf": { "@id": appId() }
      });
    }

    // Nodes (including config nodes)
    for (const n of flowsArray) {
      if (!n || typeof n !== "object") continue;
      if (!n.id || !n.type) continue;
      if (n.type === "tab") continue;

      const thisNodeId = nodeId(n.id);

      const node = {
        "@id": thisNodeId,
        "@type": "nrua:Node",
        "schema:identifier": String(n.id),
        "nrua:type": String(n.type),
        ...(n.name ? { "schema:name": String(n.name) } : {}),
        "schema:isPartOf": n.z ? { "@id": flowId(String(n.z)) } : { "@id": appId() }
      };

      graph.push(node);

      // type-specific configuration (lossless; excludes common keys)
      for (const [k, v] of Object.entries(n)) {
        if (EXCLUDE_NODE_KEYS.has(k)) continue;
        if (k === "name") continue;
        if (k === "label" || k === "disabled" || k === "env") continue;
        addPropertyValue(graph, thisNodeId, k, v, thisNodeId);
      }

      // Wiring via NodeOutput
      if (Array.isArray(n.wires)) {
        for (let gate = 0; gate < n.wires.length; gate++) {
          const targets = n.wires[gate];
          if (!Array.isArray(targets) || targets.length === 0) continue;

          graph.push({
            "@id": outId(n.id, gate),
            "@type": "nrua:NodeOutput",
            "nrua:fromGate": gate,
            "nrua:toNode": targets.map((tid) => ({ "@id": nodeId(String(tid)) }))
          });

          node["nrua:hasOutput"] = node["nrua:hasOutput"] || [];
          node["nrua:hasOutput"].push({ "@id": outId(n.id, gate) });
        }
      }
    }

    return {
      "@context": { nrua: NRUA, schema: SCHEMA },
      "@id": GID_APP,
      "@graph": graph
    };
  }

  let appReloadTimer = null;

  function scheduleAppReload(reason) {
    if (appReloadTimer) clearTimeout(appReloadTimer);
    appReloadTimer = setTimeout(() => {
      loadApplicationFromFlows(reason).catch((e) => {
        RED.log.error("[uRDF] Application load failed: " + (e?.message || String(e)));
        publish({
          ts: Date.now(),
          type: "appLoad",
          request: { method: "INIT", path: "app", summary: `failed (${reason})` },
          response: { ok: false, error: e?.message || String(e) }
        });
      });
    }, 250);
  }

  async function loadApplicationFromFlows(reason) {
    if (!urdf) return;

    const ts = Date.now();
    const flows = await fetchAdminJson("/flows");

    if (!Array.isArray(flows)) {
      throw new Error("Expected /flows to return an array; got " + typeof flows);
    }

    const appDoc = buildAppJsonLdFromFlows(flows);

    // Replace graph each time (deploy/update) to keep deterministic state
    await urdf.clear(GID_APP);
    await urdf.load(appDoc);

    const payload = {
      ok: true,
      ts,
      gid: GID_APP,
      reason,
      size: urdf.size(GID_APP),
      totalSize: urdf.size()
    };

    publish({
      ts,
      type: "appUpdate",
      request: { method: "REPLACE", path: "/flows", summary: reason },
      response: payload
    });

    RED.log.info(`[uRDF] Application graph updated from /flows into gid=${GID_APP} (${reason})`);
  }

  if (RED.events && typeof RED.events.on === "function") {
    RED.events.on("flows:started", () => scheduleAppReload("flows:started"));
    RED.events.on("flows:deployed", () => scheduleAppReload("flows:deployed"));
    RED.events.on("flows:updated", () => scheduleAppReload("flows:updated"));
    RED.log.info("[uRDF] Registered flow lifecycle hooks");
  } else {
    RED.log.warn("[uRDF] RED.events not available; deploy hook not registered");
  }

  // -------------------------
  // Existing endpoints (unchanged)
  // -------------------------
  function now() {
    return Date.now();
  }

  function summarizeSparql(s) {
    if (!s || typeof s !== "string") return "";
    const oneLine = s.replace(/\s+/g, " ").trim();
    return oneLine.length > 140 ? oneLine.slice(0, 137) + "..." : oneLine;
  }

  function okOr500(res, payload) {
    return res.status(payload.ok ? 200 : 500).json(payload);
  }

  function requireUrdf(ts, type, reqMeta, res) {
    if (urdf) return true;
    const payload = { ok: false, ts, error: "uRDF module not loaded" };
    publish({ ts, type, request: reqMeta, response: payload });
    res.status(500).json(payload);
    return false;
  }

  // GET /urdf/health
  RED.httpAdmin.get("/urdf/health", function (req, res) {
    const ts = now();
    const ok = !!urdf;
    const payload = {
      ok,
      ts,
      module: "urdf",
      size: ok && typeof urdf.size === "function" ? urdf.size() : undefined
    };

    publish({
      ts,
      type: "health",
      request: { method: "GET", path: "/urdf/health" },
      response: payload
    });

    okOr500(res, payload);
  });

  // GET /urdf/size?gid=...
  RED.httpAdmin.get("/urdf/size", function (req, res) {
    const ts = now();
    if (!requireUrdf(ts, "size", { method: "GET", path: "/urdf/size" }, res)) return;

    const gid = req.query && req.query.gid ? String(req.query.gid) : undefined;

    try {
      if (!gid) {
        const totalSize = urdf.size();
        const payload = { ok: true, ts, totalSize };

        publish({
          ts,
          type: "size",
          request: { method: "GET", path: "/urdf/size", summary: "total size" },
          response: payload
        });

        return res.status(200).json(payload);
      }

      const size = urdf.size(gid);
      const payload = { ok: true, ts, gid, size };

      publish({
        ts,
        type: "size",
        request: { method: "GET", path: "/urdf/size", summary: `gid=${gid}` },
        response: payload
      });

      return res.status(200).json(payload);
    } catch (e) {
      const payload = { ok: false, ts, error: e && e.message ? e.message : String(e) };

      publish({
        ts,
        type: "size",
        request: { method: "GET", path: "/urdf/size", summary: gid ? `gid=${gid}` : "total size" },
        response: payload
      });

      return res.status(500).json(payload);
    }
  });

  // GET /urdf/graph?gid=...
  RED.httpAdmin.get("/urdf/graph", function (req, res) {
    const ts = now();
    if (!requireUrdf(ts, "graph", { method: "GET", path: "/urdf/graph" }, res)) return;

    const gid = req.query && req.query.gid ? String(req.query.gid) : undefined;

    try {
      const graph = gid ? urdf.findGraph(gid) : urdf.findGraph();

      if (gid && graph == null) {
        const payload = { ok: false, ts, gid, error: "Graph not found" };

        publish({
          ts,
          type: "graph",
          request: { method: "GET", path: "/urdf/graph", summary: `gid=${gid}` },
          response: payload
        });

        return res.status(404).json(payload);
      }

      const payload = { ok: true, ts, gid: gid || null, graph };

      publish({
        ts,
        type: "graph",
        request: { method: "GET", path: "/urdf/graph", summary: gid ? `gid=${gid}` : "default graph" },
        response: payload
      });

      return res.status(200).json(payload);
    } catch (e) {
      const payload = { ok: false, ts, error: e && e.message ? e.message : String(e) };

      publish({
        ts,
        type: "graph",
        request: { method: "GET", path: "/urdf/graph", summary: gid ? `gid=${gid}` : "default graph" },
        response: payload
      });

      return res.status(500).json(payload);
    }
  });

  // GET /urdf/export  -> downloads full store as JSON-LD
RED.httpAdmin.get("/urdf/export", function (req, res) {
  const ts = now();
  if (!requireUrdf(ts, "export", { method: "GET", path: "/urdf/export" }, res)) return;

  try {
    const graph = req.query && req.query.gid ? urdf.findGraph(String(req.query.gid)) : urdf.findGraph(); 
    const doc = {
      "@context": {
        nrua: "https://w3id.org/nodered-static-program-analysis/user-application-ontology#",
        schema: "https://schema.org/"
      },
      "@id": req.query && req.query.gid ? req.query.gid : "",
      "@graph": graph
    };

    const filename = `urdf-export-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonld`;

    res.setHeader("Content-Type", "application/ld+json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(JSON.stringify(doc, null, 2));

    publish({
      ts,
      type: "export",
      request: { method: "GET", path: "/urdf/export" },
      response: { ok: true, ts, filename }
    });
  } catch (e) {
    const payload = { ok: false, ts, error: e?.message || String(e) };
    publish({
      ts,
      type: "export",
      request: { method: "GET", path: "/urdf/export" },
      response: payload
    });
    res.status(500).json(payload);
  }
});


  // GET /urdf/node?id=...&gid=...
  RED.httpAdmin.get("/urdf/node", async function (req, res) {
    const ts = now();
    if (!requireUrdf(ts, "node", { method: "GET", path: "/urdf/node" }, res)) return;

    const id = req.query && req.query.id ? String(req.query.id) : "";
    const gid = req.query && req.query.gid ? String(req.query.gid) : undefined;

    if (!id.trim()) {
      const payload = { ok: false, ts, error: "Missing required query param: id" };
      publish({
        ts,
        type: "node",
        request: { method: "GET", path: "/urdf/node", summary: "missing id" },
        response: payload
      });
      return res.status(400).json(payload);
    }

    try {
      const node = gid ? await urdf.find(id, gid) : await urdf.find(id);
      const payload = { ok: true, ts, id, gid: gid || null, node };

      publish({
        ts,
        type: "node",
        request: { method: "GET", path: "/urdf/node", summary: gid ? `id=${id} gid=${gid}` : `id=${id}` },
        response: payload
      });

      res.status(200).json(payload);
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      const status = /not found/i.test(message) ? 404 : 500;
      const payload = { ok: false, ts, error: message };

      publish({
        ts,
        type: "node",
        request: { method: "GET", path: "/urdf/node", summary: gid ? `id=${id} gid=${gid}` : `id=${id}` },
        response: payload
      });

      res.status(status).json(payload);
    }
  });

  // POST /urdf/clear  body: { "gid": "optional" }
  RED.httpAdmin.post("/urdf/clear", jsonParser, async function (req, res) {
    const ts = now();
    if (!requireUrdf(ts, "clear", { method: "POST", path: "/urdf/clear" }, res)) return;

    const gid = req.body && req.body.gid ? String(req.body.gid) : undefined;

    try {
      if (gid) {
        await urdf.clear(gid);
      } else {
        await urdf.clear();
      }

      const payload = gid ? { ok: true, ts, gid } : { ok: true, ts };

      publish({
        ts,
        type: "clear",
        request: { method: "POST", path: "/urdf/clear", summary: gid ? `gid=${gid}` : "default/all" },
        response: payload
      });

      res.status(200).json(payload);
    } catch (e) {
      const payload = { ok: false, ts, error: e && e.message ? e.message : String(e) };

      publish({
        ts,
        type: "clear",
        request: { method: "POST", path: "/urdf/clear", summary: gid ? `gid=${gid}` : "default/all" },
        response: payload
      });

      res.status(500).json(payload);
    }
  });

  // POST /urdf/load  (JSON-LD)
  RED.httpAdmin.post("/urdf/load", jsonParser, async function (req, res) {
    const ts = now();
    if (!requireUrdf(ts, "load", { method: "POST", path: "/urdf/load", summary: "JSON-LD" }, res)) return;

    const body = req.body;

    const isValid =
      body !== null &&
      typeof body !== "undefined" &&
      (Array.isArray(body) || (typeof body === "object" && !Array.isArray(body)));

    if (!isValid) {
      const payload = { ok: false, ts, error: "Request body must be JSON-LD (a JSON object or array)." };
      publish({
        ts,
        type: "load",
        request: { method: "POST", path: "/urdf/load", summary: "invalid body" },
        response: payload
      });
      return res.status(400).json(payload);
    }

    try {
      await urdf.load(body);

      const payload = { ok: true, ts, size: urdf.size() };

      publish({
        ts,
        type: "load",
        request: {
          method: "POST",
          path: "/urdf/load",
          summary: Array.isArray(body) ? `JSON-LD array (${body.length})` : "JSON-LD object"
        },
        response: payload
      });

      res.status(200).json(payload);
    } catch (e) {
      const payload = { ok: false, ts, error: e && e.message ? e.message : String(e) };

      publish({
        ts,
        type: "load",
        request: { method: "POST", path: "/urdf/load", summary: "JSON-LD" },
        response: payload
      });

      res.status(500).json(payload);
    }
  });

  // Load JSON-LD from URL
  RED.httpAdmin.post("/urdf/loadFrom", jsonParser, async function (req, res) {
    const ts = now();
    if (!requireUrdf(ts, "loadFrom", { method: "POST", path: "/urdf/loadFrom" }, res)) return;

    const uri = req.body && req.body.uri ? String(req.body.uri) : "";
    if (!uri.trim()) {
      const payload = { ok: false, ts, error: 'Body must be JSON: { "uri": "https://..." }' };
      publish({
        ts,
        type: "loadFrom",
        request: { method: "POST", path: "/urdf/loadFrom", summary: "missing uri" },
        response: payload
      });
      return res.status(400).json(payload);
    }

    try {
      const r = await fetch(uri, {
        headers: { Accept: "application/ld+json, application/json;q=0.9, */*;q=0.1" }
      });

      if (!r.ok) {
        const payload = { ok: false, ts, error: `Fetch failed: HTTP ${r.status}` };
        publish({
          ts,
          type: "loadFrom",
          request: { method: "POST", path: "/urdf/loadFrom", summary: uri },
          response: payload
        });
        return res.status(502).json(payload);
      }

      const text = await r.text();

      let doc;
      try {
        doc = JSON.parse(text);
      } catch (e) {
        const payload = { ok: false, ts, error: "Fetched content is not valid JSON/JSON-LD" };
        publish({
          ts,
          type: "loadFrom",
          request: { method: "POST", path: "/urdf/loadFrom", summary: uri },
          response: payload
        });
        return res.status(415).json(payload);
      }

      let toLoad;

      if (Array.isArray(doc)) {
        toLoad = { "@id": uri, "@graph": doc };
      } else if (doc && typeof doc === "object") {
        toLoad = { ...doc, "@id": uri };
        if (!Array.isArray(toLoad["@graph"])) {
          const { "@context": ctx, ...node } = toLoad;
          toLoad = {
            ...(ctx ? { "@context": ctx } : {}),
            "@id": uri,
            "@graph": [node]
          };
        }
      } else {
        const payload = { ok: false, ts, error: "Fetched JSON must be an object or array" };
        publish({
          ts,
          type: "loadFrom",
          request: { method: "POST", path: "/urdf/loadFrom", summary: uri },
          response: payload
        });
        return res.status(415).json(payload);
      }

      await urdf.load(toLoad);

      const payload = { ok: true, ts, uri, totalSize: urdf.size() };
      publish({
        ts,
        type: "loadFrom",
        request: { method: "POST", path: "/urdf/loadFrom", summary: uri },
        response: payload
      });
      return res.status(200).json(payload);
    } catch (e) {
      const payload = { ok: false, ts, error: e && e.message ? e.message : String(e) };
      publish({
        ts,
        type: "loadFrom",
        request: { method: "POST", path: "/urdf/loadFrom", summary: uri },
        response: payload
      });
      return res.status(500).json(payload);
    }
  });

// POST /urdf/loadFile  body: { "doc": <JSON-LD> }
// Behavior: if doc has @id => treat it as gid, clear that gid, then load doc
RED.httpAdmin.post("/urdf/loadFile", jsonParser, async function (req, res) {
  const ts = now();
  if (!requireUrdf(ts, "loadFile", { method: "POST", path: "/urdf/loadFile" }, res)) return;

  const doc = req.body && req.body.doc;

  const isValid =
    doc !== null &&
    typeof doc !== "undefined" &&
    (Array.isArray(doc) || (typeof doc === "object" && !Array.isArray(doc)));

  if (!isValid) {
    const payload = { ok: false, ts, error: 'Body must be JSON: { "doc": <JSON-LD object/array> }' };
    publish({ ts, type: "loadFile", request: { method: "POST", path: "/urdf/loadFile", summary: "invalid body" }, response: payload });
    return res.status(400).json(payload);
  }

  // Determine gid
  let gid = null;
  if (doc && typeof doc === "object" && typeof doc["@id"] === "string" && doc["@id"].trim()) {
    gid = doc["@id"].trim();
  }

  if (!gid) {
    const payload = { ok: false, ts, error: 'Uploaded JSON-LD must contain an "@id" to identify the named graph (gid).' };
    publish({ ts, type: "loadFile", request: { method: "POST", path: "/urdf/loadFile", summary: "missing @id" }, response: payload });
    return res.status(400).json(payload);
  }

  try {
    // Replace that named graph
    await urdf.clear(gid);
    await urdf.load(doc);

    const payload = { ok: true, ts, gid, size: urdf.size(gid), totalSize: urdf.size() };
    publish({ ts, type: "loadFile", request: { method: "POST", path: "/urdf/loadFile", summary: `gid=${gid}` }, response: payload });
    return res.status(200).json(payload);
  } catch (e) {
    const payload = { ok: false, ts, gid, error: e?.message || String(e) };
    publish({ ts, type: "loadFile", request: { method: "POST", path: "/urdf/loadFile", summary: `gid=${gid}` }, response: payload });
    return res.status(500).json(payload);
  }
});


  // POST /urdf/query  body: { "sparql": "..." }
  RED.httpAdmin.post("/urdf/query", jsonParser, async function (req, res) {
    const ts = now();
    if (!requireUrdf(ts, "query", { method: "POST", path: "/urdf/query" }, res)) return;

    const sparql = req.body && req.body.sparql;

    if (!sparql || typeof sparql !== "string" || !sparql.trim()) {
      const payload = { ok: false, ts, error: 'Body must be JSON: { "sparql": "..." }' };
      publish({
        ts,
        type: "query",
        request: { method: "POST", path: "/urdf/query", summary: "missing sparql" },
        response: payload
      });
      return res.status(400).json(payload);
    }

    const summary = summarizeSparql(sparql);

    try {
      const result = await urdf.query(sparql);

      const payload =
        typeof result === "boolean" ? { ok: true, ts, type: "ASK", result } : { ok: true, ts, type: "SELECT", results: result };

      publish({
        ts,
        type: "query",
        request: { method: "POST", path: "/urdf/query", summary },
        response: payload
      });

      res.status(200).json(payload);
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      const status = /not implemented/i.test(message) ? 501 : 500;
      const payload = { ok: false, ts, error: message };

      publish({
        ts,
        type: "query",
        request: { method: "POST", path: "/urdf/query", summary },
        response: payload
      });

      res.status(status).json(payload);
    }
  });

  RED.log.info(
    "[uRDF] runtime plugin loaded: /urdf/health /urdf/size /urdf/graph /urdf/node /urdf/clear /urdf/load /urdf/loadFrom /urdf/query"
  );
};

