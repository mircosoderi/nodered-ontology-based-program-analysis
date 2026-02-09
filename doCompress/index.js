import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = {
    inFile: "input.jsonld",
    irisFile: "iris.json",
    outFile: "output.jsonld",
    pretty: false,
    rewriteIds: false
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.inFile = argv[++i];
    else if (a === "--iris") args.irisFile = argv[++i];
    else if (a === "--out") args.outFile = argv[++i];
    else if (a === "--pretty") args.pretty = true;
    else if (a === "--rewrite-ids") args.rewriteIds = true;
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function safeJsonParse(text, label) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const hint =
      label === "IRI list"
        ? "\nHint: check your iris.json is valid JSON (commas between strings, etc.)."
        : "\nHint: check your JSON-LD file is valid JSON.";
    throw new Error(`Failed to parse ${label}: ${e.message}${hint}`);
  }
}

function buildIriIndexMap(iriArray) {
  if (!Array.isArray(iriArray)) {
    throw new Error("iris.json must be a JSON array of strings.");
  }
  const map = new Map();
  for (let i = 0; i < iriArray.length; i++) {
    const v = iriArray[i];
    if (typeof v !== "string") {
      throw new Error(`iris.json contains a non-string at index ${i}.`);
    }
    if (!map.has(v)) map.set(v, i); // stable first occurrence
  }
  return map;
}

function toZ(iri, iriMap) {
  const idx = iriMap.get(iri);
  return idx === undefined ? iri : `z:${idx}`;
}

function looksLikeIri(s) {
  return typeof s === "string" && (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("urn:"));
}

/**
 * Heuristic "looks like SPARQL":
 * - contains common SPARQL keywords OR PREFIX/BASE lines
 * - and has at least one of: SELECT/CONSTRUCT/ASK/DESCRIBE
 */
function looksLikeSparql(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 10) return false;

  const upper = t.toUpperCase();

  const hasForm =
    upper.includes("SELECT") ||
    upper.includes("CONSTRUCT") ||
    upper.includes("ASK") ||
    upper.includes("DESCRIBE");

  const hasSparqlish =
    upper.includes("PREFIX ") ||
    upper.includes("BASE ") ||
    upper.includes("WHERE") ||
    upper.includes("FILTER") ||
    upper.includes("OPTIONAL") ||
    upper.includes("GRAPH") ||
    upper.includes("BIND") ||
    upper.includes("VALUES");

  return hasForm && hasSparqlish;
}


/**
 * Strip SPARQL comments, preserving comment markers inside:
 *  - quoted strings ("..." or '...')
 *  - IRIREFs (<...>)  <-- IMPORTANT because IRIs often contain '#'
 *
 * Supports:
 *  - # line comments
 *  - /* block comments *\/
 */
function stripSparqlComments(query) {
  if (typeof query !== "string" || query.length === 0) return query;

  let out = "";
  let i = 0;

  let inSingle = false;       // '...'
  let inDouble = false;       // "..."
  let inIriRef = false;       // <...>  (IRIREF)
  let inLineComment = false;  // # ... \n
  let inBlockComment = false; // /* ... */

  while (i < query.length) {
    const c = query[i];
    const next = i + 1 < query.length ? query[i + 1] : "";

    // End of line comment
    if (inLineComment) {
      if (c === "\n") {
        inLineComment = false;
        out += c; // keep newline
      }
      i++;
      continue;
    }

    // End of block comment
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    // Inside IRIREF <...>: copy verbatim, do NOT interpret comment markers.
    // Note: SPARQL IRIREF does not allow '>' inside except escaped forms; for our purposes
    // this simple state machine is correct for typical queries.
    if (inIriRef) {
      out += c;
      if (c === ">") inIriRef = false;
      i++;
      continue;
    }

    // Inside quoted strings: copy verbatim, honor escapes
    if (inSingle || inDouble) {
      out += c;

      if (c === "\\") {
        if (i + 1 < query.length) {
          out += query[i + 1];
          i += 2;
        } else {
          i++;
        }
        continue;
      }

      if (inSingle && c === "'") inSingle = false;
      else if (inDouble && c === '"') inDouble = false;

      i++;
      continue;
    }

    // Not in quote/comment/IRIREF: detect start of protected regions
    if (c === "<") {
      inIriRef = true;
      out += c;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      out += c;
      i++;
      continue;
    }

    // Start of line comment: #  (only when not in IRIREF/quotes)
    if (c === "#") {
      inLineComment = true;
      i++;
      continue;
    }

    // Start of block comment: /*  (only when not in IRIREF/quotes)
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }

    // Normal char
    out += c;
    i++;
  }

  return out;
}

/**
 * If it's SPARQL-ish, strip comments; otherwise return unchanged.
 */
function maybeStripSparqlComments(s) {
  return looksLikeSparql(s) ? stripSparqlComments(s) : s;
}

/**
 * Transform JSON-LD:
 * - rewrite predicate IRIs (object keys), excluding JSON-LD keywords (starting with "@")
 * - rewrite @type values (string or array)
 * - optionally rewrite @id and other IRI-looking string values (if --rewrite-ids)
 * - additionally: if any string value looks like SPARQL, strip comments from it
 */
function transformJsonLd(node, iriMap, { rewriteIds }) {
  if (Array.isArray(node)) {
    return node.map((x) => transformJsonLd(x, iriMap, { rewriteIds }));
  }

  if (node && typeof node === "object") {
    const out = {};

    for (const [key, value] of Object.entries(node)) {
      const newKey = key.startsWith("@") ? key : toZ(key, iriMap);

      // @type rewriting
      if (key === "@type") {
        if (typeof value === "string") {
          out[newKey] = toZ(value, iriMap);
        } else if (Array.isArray(value)) {
          out[newKey] = value.map((t) => (typeof t === "string" ? toZ(t, iriMap) : t));
        } else {
          out[newKey] = value;
        }
        continue;
      }

      // Optional @id rewriting
      if (rewriteIds && key === "@id" && typeof value === "string") {
        const cleaned = maybeStripSparqlComments(value);
        out[newKey] = looksLikeIri(cleaned) ? toZ(cleaned, iriMap) : cleaned;
        continue;
      }

      // Recurse for objects/arrays
      if (value && typeof value === "object") {
        out[newKey] = transformJsonLd(value, iriMap, { rewriteIds });
        continue;
      }

      // Primitive string handling:
      // 1) strip SPARQL comments if needed
      // 2) optionally rewrite IRI-valued strings
      if (typeof value === "string") {
        const cleaned = maybeStripSparqlComments(value);
        if (rewriteIds && looksLikeIri(cleaned)) {
          out[newKey] = toZ(cleaned, iriMap);
        } else {
          out[newKey] = cleaned;
        }
      } else {
        out[newKey] = value;
      }
    }

    return out;
  }

  // Primitive: if it's a string, also apply SPARQL stripping (covers strings in arrays)
  if (typeof node === "string") {
    return maybeStripSparqlComments(node);
  }

  return node;
}

async function main() {
  const args = parseArgs(process.argv);

  const inPath = path.join(__dirname, args.inFile);
  const irisPath = path.join(__dirname, args.irisFile);
  const outPath = path.join(__dirname, args.outFile);

  const [jsonldText, irisText] = await Promise.all([
    readFile(inPath, "utf8"),
    readFile(irisPath, "utf8")
  ]);

  const jsonld = safeJsonParse(jsonldText, "JSON-LD input");
  const iriArray = safeJsonParse(irisText, "IRI list");
  const iriMap = buildIriIndexMap(iriArray);

  const transformed = transformJsonLd(jsonld, iriMap, { rewriteIds: args.rewriteIds });

  const spacing = args.pretty ? 2 : 0;
  const outputText = JSON.stringify(transformed, null, spacing) + "\n";
  await writeFile(outPath, outputText, "utf8");

  console.log(
    `Done. Wrote ${args.outFile} (pretty=${args.pretty}, rewriteIds=${args.rewriteIds}).`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

