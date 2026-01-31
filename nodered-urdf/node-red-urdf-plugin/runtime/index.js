module.exports = function (RED) {
  "use strict";

  const TOPIC = "urdf/events";

  const express = require("express");
  const jsonParser = express.json({ limit: "5mb" });
  const fs = require("fs");

  let eyeling;
try {
  eyeling = require("eyeling/eyeling.js");
} catch (e) {
  eyeling = null;
}

if (eyeling && typeof eyeling.reasonStream === "function") {
  RED.log.info("[uRDF] Eyeling reasonStream loaded");
} else {
  RED.log.warn("[uRDF] Eyeling not available (reasonStream missing)");
}


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
  // Rules load (startup)
  // -------------------------
  async function loadRulesJsonLdOnStartup() {
    if (!urdf) return;
  
    const filePath = process.env.URDF_RULES_PATH || "/opt/urdf/rules.jsonld";
    const gid = process.env.URDF_RULES_GID || "urn:nrua:rules";

    if (!fs.existsSync(filePath)) {
      RED.log.warn("[uRDF] Rules file not found: " + filePath);
      return;
    }
    
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const doc = JSON.parse(raw);

      // load as named graph
      const toLoad = Array.isArray(doc) ? { "@id": gid, "@graph": doc } : { ...doc, "@id": gid };
      await urdf.load(toLoad);

      RED.log.info("[uRDF] Rules JSON-LD loaded into gid=" + gid + " from " + filePath);

      publish({
        ts: Date.now(),
        type: "startupLoad",
        request: { method: "INIT", path: "rules", summary: filePath },
        response: { ok: true, gid, filePath, totalSize: urdf.size() }
      });
    } catch (e) {
      RED.log.error("[uRDF] Failed to load rules JSON-LD: " + (e?.message || String(e)));
    }
  }

  loadRulesJsonLdOnStartup();

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
  // Inference and rules mgmt
  // -------------------------
	
  const GID_RULES = process.env.URDF_RULES_GID || "urn:nrua:rules";
  const GID_INFERRED = process.env.URDF_INFERRED_GID || "urn:graph:inferred";
  const SCHEMA_TEXT = "https://schema.org/text";
  const NRUA_RULE = "https://w3id.org/nodered-static-program-analysis/user-application-ontology#Rule";
  const SCHEMA_PROGRAMMING_LANGUAGE = "https://schema.org/programmingLanguage";
  const SCHEMA_ENCODING_FORMAT = "https://schema.org/encodingFormat";
  const SCHEMA_HASPART = "https://schema.org/hasPart";
  const SCHEMA_SOFTWARE_SOURCE_CODE = "https://schema.org/SoftwareSourceCode";

function stripN3Quotes(v) {
  // Eyeling gives literals as strings like "\"derived\"" or "\"Flow 1\""
  // We want the lexical value without the surrounding quotes and with escapes interpreted.
  if (typeof v !== "string") return String(v ?? "");

  const s = v.trim();

  // If it starts and ends with a quote, remove one layer and unescape
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const inner = s.slice(1, -1);
    // Eyeling uses backslash escapes in the string content
    return inner
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }

  return s;
}

function looksLikeIri(v) {
  // Minimal heuristic: IRIs in your system are typically urn:... or http(s)...
  return typeof v === "string" && (v.startsWith("urn:") || v.startsWith("http://") || v.startsWith("https://") || v.startsWith("_:"));
}

function eyelingDfToSpo(df) {
  // df sample shows: { fact: { s:{value}, p:{value}, o:{value} }, ... }
  const f = df && df.fact;
  const s = f && f.s && f.s.value;
  const p = f && f.p && f.p.value;
  const o = f && f.o && f.o.value;

  if (!s || !p || o == null) return null;
  return { s, p, o };
}

function eyelingObjectToJsonLd(oVal) {
  // oVal can be:
  // - "\"derived\"" (quoted literal)
  // - "<iri>" (unlikely here) or plain iri string
  // - "_:b1" (possible)
  if (looksLikeIri(oVal)) return { "@id": oVal };

  // Default: treat as literal; strip quotes if quoted
  return { "@value": stripN3Quotes(oVal) };
}

function rdfjsTermToJsonLd(term) {
  if (!term || typeof term !== "object") {
    throw new Error("Invalid RDFJS term: " + JSON.stringify(term));
  }

  if (term.termType === "NamedNode") {
    return { "@id": term.value };
  }

  if (term.termType === "BlankNode") {
    // RDFJS BlankNode.value is WITHOUT "_:"
    return { "@id": "_:" + term.value };
  }

  if (term.termType === "Literal") {
    const out = { "@value": term.value };

    if (term.language) {
      out["@language"] = term.language;
    } else if (term.datatype && term.datatype.value && term.datatype.value !== "http://www.w3.org/2001/XMLSchema#string") {
      out["@type"] = term.datatype.value;
    }

    return out;
  }

  throw new Error("Unsupported RDFJS termType: " + term.termType);
}

function addToBySubject(bySubject, sId, pIri, oJsonLd) {
  let node = bySubject.get(sId);
  if (!node) {
    node = { "@id": sId };
    bySubject.set(sId, node);
  }
  if (!node[pIri]) node[pIri] = [];
  node[pIri].push(oJsonLd);
}

function escapeNTriplesString(s) {
  // N-Triples string escaping: backslash, quotes, newlines, carriage returns, tabs
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function termToNTriples(term) {
  if (term == null) throw new Error("Null term");

  // uRDF query bindings look like: { value: "...", type: "uri"|"literal"|"bnode", ... }
  if (typeof term === "object") {
    const t = (term.type || "").toLowerCase();
    const v = term.value;

    if (t === "uri") {
      if (!v) throw new Error("URI term missing value");
      return `<${v}>`;
    }

    if (t === "bnode" || t === "blanknode") {
      if (!v) throw new Error("Blank node term missing value");
      // Keep as _:... (uRDF supports it; and we clear inferred graph each run)
      return v.startsWith("_:") ? v : `_:${v}`;
    }

    if (t === "literal") {
      const lex = escapeNTriplesString(v ?? "");
      // Optional language or datatype if present
      if (term["xml:lang"] || term.lang) {
        const lang = term["xml:lang"] || term.lang;
        return `"${lex}"@${lang}`;
      }
      if (term.datatype) {
        return `"${lex}"^^<${term.datatype}>`;
      }
      return `"${lex}"`;
    }

    // Fallback: if it looks like an @id JSON-LD-ish object
    if (typeof term["@id"] === "string") {
      const id = term["@id"];
      if (id.startsWith("_:")) return id;
      return `<${id}>`;
    }
  }

  // Fallback: raw string as IRI
  if (typeof term === "string") {
    if (term.startsWith("_:")) return term;
    return `<${term}>`;
  }

  throw new Error("Unsupported term shape: " + JSON.stringify(term));
}

function bindingToNTripleLine(b) {
  const s = termToNTriples(b.s);
  const p = termToNTriples(b.p);
  const o = termToNTriples(b.o);
  return `${s} ${p} ${o} .`;
}

function normalizeQueryResults(qres) {
  if (Array.isArray(qres)) return qres;
  if (qres && Array.isArray(qres.results)) return qres.results;
  return [];
}

function hasSpo(binding) {
  if (!binding || typeof binding !== "object") return false;
  return binding.s != null && binding.p != null && binding.o != null;
}

function normalizeLang(x) {
  if (!x) return "";
  return String(x).trim().toLowerCase();
}

function isN3Rule(rule) {
  const lang = normalizeLang(getPropFirstValue(rule, SCHEMA_PROGRAMMING_LANGUAGE));
  const fmt  = normalizeLang(getPropFirstValue(rule, SCHEMA_ENCODING_FORMAT));

  // Accept a few common variants
  return (
    lang === "n3" ||
    lang === "notation3" ||
    lang.includes("n3") ||
    fmt.includes("n3") ||
    fmt.includes("notation3")
  );
}

function extractN3ProjectionSparql(rule, nodesById) {
  const parts = rule && rule[SCHEMA_HASPART];
  if (!Array.isArray(parts) || parts.length === 0) return undefined;

  for (const partRef of parts) {
    if (!partRef || typeof partRef !== "object") continue;

    let part = partRef;
    const pid = partRef["@id"];
    if (pid && nodesById && nodesById.has(pid)) {
      part = nodesById.get(pid);
    }

    const pl = normalizeLang(getPropFirstValue(part, SCHEMA_PROGRAMMING_LANGUAGE));
    const types = part["@type"];
    const t = Array.isArray(types) ? types : (types ? [types] : []);
    const hasSoftwareSourceCodeType = t.includes(SCHEMA_SOFTWARE_SOURCE_CODE);

    if (hasSoftwareSourceCodeType || pl === "sparql") {
      const q = getPropFirstValue(part, SCHEMA_TEXT);
      if (typeof q === "string" && q.trim()) return q;
    }
  }
  return undefined;
}
 
function getPropFirstValue(node, iri) {
  const arr = node && node[iri];
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const v = arr[0];
  if (v && typeof v === "object") {
    if (typeof v["@value"] !== "undefined") return v["@value"];
    if (typeof v["@id"] !== "undefined") return v["@id"];
  }
  return v;
}

// Normalize various SPARQL binding shapes into JSON-LD object forms.
function bindingToJsonLdObject(term) {
  // Common cases:
  // - string IRI or literal
  // - { value, type: "uri"|"literal", datatype, "xml:lang" }
  // - { termType: "NamedNode"|"Literal", value, datatype, language }
  if (term == null) return null;

  if (typeof term === "string") {
    // Ambiguous: assume IRI if it looks like one, else literal
    // (fallback only; prefer structured bindings)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(term)) return { "@id": term };
    return { "@value": term };
  }

  if (typeof term === "object") {
    // RDFJS-like
    if (term.termType === "NamedNode") return { "@id": term.value };
    if (term.termType === "BlankNode") return { "@id": "_:" + term.value };
    if (term.termType === "Literal") {
      const lit = { "@value": term.value };
      if (term.language) lit["@language"] = term.language;
      const dt = term.datatype && (term.datatype.value || term.datatype);
      if (dt && typeof dt === "string" && dt !== "http://www.w3.org/2001/XMLSchema#string") {
        lit["@type"] = dt;
      }
      return lit;
    }

    // SPARQL JSON results-like
    const value = term.value ?? term["@value"] ?? term["@id"];
    const type = term.type; // "uri" | "literal" | "bnode"
    if (type === "uri") return { "@id": value };
    if (type === "bnode") return { "@id": "_:" + value };
    if (type === "literal") {
      const lit = { "@value": value };
      if (term["xml:lang"]) lit["@language"] = term["xml:lang"];
      if (term.datatype && term.datatype !== "http://www.w3.org/2001/XMLSchema#string") lit["@type"] = term.datatype;
      return lit;
    }

    // JSON-LD-like direct
    if (typeof term["@id"] === "string") return { "@id": term["@id"] };
    if (typeof term["@value"] !== "undefined") {
      const lit = { "@value": term["@value"] };
      if (term["@language"]) lit["@language"] = term["@language"];
      if (term["@type"]) lit["@type"] = term["@type"];
      return lit;
    }

    // Last resort: try to use .value
    if (typeof value === "string") {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return { "@id": value };
      return { "@value": value };
    }
  }

  // Fallback literal
  return { "@value": String(term) };
}

function bindingToIri(term) {
  if (term == null) return null;
  if (typeof term === "string") return term;
  if (typeof term === "object") {
    if (term.termType === "NamedNode") return term.value;
    if (term.type === "uri") return term.value;
    if (typeof term["@id"] === "string") return term["@id"];
    if (typeof term.value === "string") return term.value; // last resort
  }
  return null;
}

async function recomputeInferencesFromRules(triggerReason) {
  if (!urdf) return;


  const ts = Date.now();

  try {
    // 1) Read the rules graph
    const rulesGraph = urdf.findGraph(GID_RULES);
    if (!Array.isArray(rulesGraph) || rulesGraph.length === 0) {
      // Deterministic: if no rules, clear inferred graph
      await urdf.clear(GID_INFERRED);
      publish({
        ts,
        type: "inference",
        request: { method: "AUTO", path: "rules", summary: `no rules (${triggerReason || ""})` },
        response: { ok: true, ts, rules: 0, triples: 0, gid: GID_INFERRED }
      });
      return;
    }

    const nodesById = new Map();
for (const n of rulesGraph) {
  if (n && typeof n === "object" && typeof n["@id"] === "string") {
    nodesById.set(n["@id"], n);
  }
}


    // 2) Extract rule resources
    const rules = rulesGraph.filter((n) => {
      const types = n && n["@type"];
      if (!types) return false;
      const t = Array.isArray(types) ? types : [types];
      return t.includes(NRUA_RULE);
    });

    // 3) Execute each rule, collect triples
    // We'll build inferred triples as JSON-LD node objects grouped by subject
    const bySubject = new Map(); // subjectIri -> nodeObject

    let firedTriples = 0;
for (const rule of rules) {
  const programText = getPropFirstValue(rule, SCHEMA_TEXT);
  if (!programText || typeof programText !== "string" || !programText.trim()) continue;

  // ---- New: detect N3 rules and extract their projection query ----
if (isN3Rule(rule)) {
  const projection = extractN3ProjectionSparql(rule, nodesById);

  if (!projection) {
    RED.log.warn("[uRDF] N3 rule found but missing schema:hasPart projection SPARQL query: " + (rule["@id"] || "(no @id)"));
    continue;
  }

  // NEW: execute projection query
  let projRes;
  try {
    projRes = await urdf.query(projection);
  } catch (e) {
    RED.log.warn("[uRDF] N3 projection query failed for rule " + (rule["@id"] || "(no @id)") + ": " + (e && e.message ? e.message : e));
    continue;
  }

  const bindings = normalizeQueryResults(projRes);
  const ok = bindings.filter(hasSpo);
  const bad = bindings.length - ok.length;

  // Log a tiny sample (first 3) so we see term shapes without flooding logs
  for (let i = 0; i < Math.min(3, ok.length); i++) {
    const b = ok[i];
  }

	let factsLines = [];
for (const b of ok) {
  try {
    factsLines.push(bindingToNTripleLine(b));
  } catch (e) {
    RED.log.warn("[uRDF] Failed to serialize binding to N-Triples for rule " + (rule["@id"] || "(no @id)") +
      ": " + (e && e.message ? e.message : e) +
      " binding=" + JSON.stringify(b)
    );
  }
}

const factsText = factsLines.join("\n");

// Preview only (avoid log spam)
const previewCount = Math.min(10, factsLines.length);

const n3Program = programText; // rule's schema:text (already validated)
const n3Input = factsText + "\n\n" + n3Program;

if (!eyeling || typeof eyeling.reasonStream !== "function") {
  RED.log.warn("[uRDF] Eyeling reasonStream not available at runtime, skipping N3 execution for " + (rule["@id"] || "(no @id)"));
  continue;
}

let derivedCount = 0;
const maxPreview = 10;

const derivedDF = [];
const derivedPreview = [];

let loggedFirstDf = false;

function onDerived(ev) {
  derivedCount++;

  if (ev && ev.df) {
    derivedDF.push(ev.df);

    if (!loggedFirstDf) {
      loggedFirstDf = true;
    }
  }

  if (derivedPreview.length < 2 && ev && typeof ev.triple === "string") {
    derivedPreview.push(ev.triple);
  }
}

try {
  const out = eyeling.reasonStream(n3Input, { onDerived });  // <-- correct signature

for (const df of derivedDF) {
  const spo = eyelingDfToSpo(df);
  if (!spo) {
    RED.log.warn("[uRDF] Derived df missing fact.s/p/o: " + JSON.stringify(df));
    continue;
  }

  const sId = spo.s;   // already an IRI or _:...
  const pIri = spo.p;  // IRI
  const oJson = eyelingObjectToJsonLd(spo.o);

	const INTERNAL_PRED_PREFIX = "urn:nrua:pv:";
if (pIri.startsWith(INTERNAL_PRED_PREFIX)) {
  continue; // do not persist helper predicates
}

  addToBySubject(bySubject, sId, pIri, oJson);
}

} catch (e) {
  RED.log.warn("[uRDF] Eyeling failed for rule " + (rule["@id"] || "(no @id)") + ": " + (e && e.message ? e.message : e));
}

continue; // still no writing to inferred graph

}

  // ---- Existing SPARQL path remains exactly the same ----
  const q = programText;
  const qres = await urdf.query(q);
  const bindings = Array.isArray(qres) ? qres : (qres && Array.isArray(qres.results) ? qres.results : []);

  for (const b of bindings) {
  // Expect bindings for s,p,o
        const sTerm = b.s ?? b["?s"] ?? b.subject ?? b.S;
        const pTerm = b.p ?? b["?p"] ?? b.predicate ?? b.P;
        const oTerm = b.o ?? b["?o"] ?? b.object ?? b.O;

        const sIri = bindingToIri(sTerm);
        const pIri = bindingToIri(pTerm);
        const oJson = bindingToJsonLdObject(oTerm);

        if (!sIri || !pIri || !oJson) continue;

        let subjNode = bySubject.get(sIri);
        if (!subjNode) {
          subjNode = { "@id": sIri };
          bySubject.set(sIri, subjNode);
        }

        subjNode[pIri] = subjNode[pIri] || [];
        subjNode[pIri].push(oJson);

        firedTriples++;
  }
}


    // 4) Replace inferred graph deterministically
const inferredGraphToLoad = Array.from(bySubject.values());

await urdf.clear(GID_INFERRED);
await urdf.load({
  "@id": GID_INFERRED,
  "@graph": inferredGraphToLoad
});

    const payload = {
      ok: true,
      ts,
      rules: rules.length,
      triples: firedTriples,
      gid: GID_INFERRED,
      reason: triggerReason || "manual",
      size: urdf.size(GID_INFERRED),
      totalSize: urdf.size()
    };

    publish({
      ts,
      type: "inference",
      request: { method: "AUTO", path: "rules", summary: `applied ${rules.length} rule(s)` },
      response: payload
    });

  } catch (e) {
    const payload = { ok: false, ts, gid: GID_INFERRED, error: e?.message || String(e) };
    publish({
      ts,
      type: "inference",
      request: { method: "AUTO", path: "rules", summary: "FAILED" },
      response: payload
    });
    RED.log.error("[uRDF] Rule inference failed: " + payload.error);
  }
}

function asArray(x) {
  return Array.isArray(x) ? x : (x ? [x] : []);
}

function isRuleNode(n) {
  const t = asArray(n && n["@type"]);
  return t.includes(NRUA_RULE);
}

function getGraphSafe(gid) {
  const g = urdf.findGraph(gid);
  return Array.isArray(g) ? g : [];
}

async function replaceNamedGraph(gid, graphArray) {
  // context optional; uRDF stores expanded IRIs anyway
  await urdf.clear(gid);
  await urdf.load({ "@id": gid, "@graph": graphArray });
}

RED.httpAdmin.post("/urdf/rules/create", jsonParser, async (req, res) => {
  const ts = Date.now();
  if (!requireUrdf(ts, "rulesCreate", { method: "POST", path: "/urdf/rules/create" }, res)) return;

  const rule = req.body && req.body.rule;
  if (!rule || typeof rule !== "object") return res.status(400).json({ ok: false, ts, error: 'Body must be { "rule": { ... } }' });
  if (!rule["@id"] || typeof rule["@id"] !== "string") return res.status(400).json({ ok: false, ts, error: 'rule["@id"] is required' });
  if (!isRuleNode(rule)) return res.status(400).json({ ok: false, ts, error: `rule["@type"] must include ${NRUA_RULE}` });

  try {
    const graph = getGraphSafe(GID_RULES);

    if (graph.some(n => n && n["@id"] === rule["@id"])) {
      return res.status(409).json({ ok: false, ts, error: "Rule already exists", id: rule["@id"] });
    }

    graph.push(rule);
    await replaceNamedGraph(GID_RULES, graph);

    return res.status(200).json({ ok: true, ts, gid: GID_RULES, created: rule["@id"], count: graph.length });
  } catch (e) {
    return res.status(500).json({ ok: false, ts, error: e?.message || String(e) });
  }
});

RED.httpAdmin.post("/urdf/rules/update", jsonParser, async (req, res) => {
  const ts = Date.now();
  if (!requireUrdf(ts, "rulesUpdate", { method: "POST", path: "/urdf/rules/update" }, res)) return;

  const rule = req.body && req.body.rule;
  if (!rule || typeof rule !== "object") return res.status(400).json({ ok: false, ts, error: 'Body must be { "rule": { ... } }' });
  if (!rule["@id"] || typeof rule["@id"] !== "string") return res.status(400).json({ ok: false, ts, error: 'rule["@id"] is required' });
  if (!isRuleNode(rule)) return res.status(400).json({ ok: false, ts, error: `rule["@type"] must include ${NRUA_RULE}` });

  try {
    const graph = getGraphSafe(GID_RULES);
    const idx = graph.findIndex(n => n && n["@id"] === rule["@id"]);
    if (idx < 0) return res.status(404).json({ ok: false, ts, error: "Rule not found", id: rule["@id"] });

    graph[idx] = rule;
    await replaceNamedGraph(GID_RULES, graph);

    return res.status(200).json({ ok: true, ts, gid: GID_RULES, updated: rule["@id"], count: graph.length });
  } catch (e) {
    return res.status(500).json({ ok: false, ts, error: e?.message || String(e) });
  }
});

RED.httpAdmin.post("/urdf/rules/delete", jsonParser, async (req, res) => {
  const ts = Date.now();
  if (!requireUrdf(ts, "rulesDelete", { method: "POST", path: "/urdf/rules/delete" }, res)) return;

  const id = req.body && req.body.id ? String(req.body.id) : "";
  if (!id.trim()) return res.status(400).json({ ok: false, ts, error: 'Body must be { "id": "..." }' });

  try {
    const graph = getGraphSafe(GID_RULES);
    const next = graph.filter(n => !(n && n["@id"] === id));
    if (next.length === graph.length) return res.status(404).json({ ok: false, ts, error: "Rule not found", id });

    await replaceNamedGraph(GID_RULES, next);

    return res.status(200).json({ ok: true, ts, gid: GID_RULES, deleted: id, count: next.length });
  } catch (e) {
    return res.status(500).json({ ok: false, ts, error: e?.message || String(e) });
  }
});


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

  // --- NEW: collect keywords per flow (tab) ---
  const flowKeywords = new Map(); // flowIri -> Set(keyword)

  function addKw(flowIri, kw) {
    if (!kw) return;
    const k = String(kw).trim();
    if (!k) return;
    let set = flowKeywords.get(flowIri);
    if (!set) {
      set = new Set();
      flowKeywords.set(flowIri, set);
    }
    set.add(k);
  }

  // Tabs -> Flow entities
  const tabs = flowsArray.filter((n) => n && n.type === "tab");
  for (const t of tabs) {
    const fid = flowId(t.id);

    graph.push({
      "@id": fid,
      "@type": "nrua:Flow",
      "schema:identifier": String(t.id),
      ...(t.label ? { "schema:name": String(t.label) } : {}),
      "schema:isPartOf": { "@id": appId() }
    });

    // ensure map exists even if flow has no nodes
    flowKeywords.set(fid, flowKeywords.get(fid) || new Set());
  }

  // Nodes (including config nodes)
  for (const n of flowsArray) {
    if (!n || typeof n !== "object") continue;
    if (!n.id || !n.type) continue;
    if (n.type === "tab") continue;

    const thisNodeId = nodeId(n.id);

    const partOf = n.z ? flowId(String(n.z)) : appId();

    // --- NEW: add node type as keyword to its flow ---
    if (n.z) {
      addKw(partOf, n.type); // e.g. "inject", "change", "debug", ...
    }

    const node = {
      "@id": thisNodeId,
      "@type": "nrua:Node",
      "schema:identifier": String(n.id),
      "nrua:type": String(n.type),
      ...(n.name ? { "schema:name": String(n.name) } : {}),
      "schema:isPartOf": { "@id": partOf }
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

  // --- NEW: write schema:keywords onto each Flow node (sorted for determinism) ---
for (const [flowIri, set] of flowKeywords.entries()) {
  if (!set || set.size === 0) continue;
  const flowNode = graph.find((x) => x && x["@id"] === flowIri);
  if (!flowNode) continue;

  flowNode["schema:keywords"] = Array.from(set)
    .map((kw) => String(kw).trim())   // optional safety
    .filter(Boolean)                  // optional safety
    .sort()
    .join(",");
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
    await recomputeInferencesFromRules(reason);

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

