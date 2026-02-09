import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// -----------------------------------------------------------------------------
// Module path resolution (ESM)
// -----------------------------------------------------------------------------
//
// In ES modules, __filename and __dirname are not provided by Node.js.
// They are reconstructed from import.meta.url to support relative file access.
// -----------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -----------------------------------------------------------------------------
// CLI argument parsing
// -----------------------------------------------------------------------------
//
// Supported flags:
//   --in <file>         Input JSON-LD filename (default: input.jsonld)
//   --iris <file>       IRI list filename (default: iris.json)
//   --out <file>        Output JSON-LD filename (default: output.jsonld)
//   --pretty            Pretty-print JSON output (default: false)
//   --rewrite-ids       Rewrite @id and other IRI-looking string values (default: false)
//
// Unknown flags cause an error and exit code 2.
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// JSON parsing with contextual error messages
// -----------------------------------------------------------------------------
//
// Two JSON inputs are expected:
//   1) JSON-LD input file (object or array; valid JSON)
//   2) IRI list file (JSON array of strings)
//
// Errors are wrapped to provide a targeted hint.
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// IRI dictionary indexing
// -----------------------------------------------------------------------------
//
// iris.json is expected to be a JSON array of strings.
// The array position becomes the stable index for that IRI.
//
// Mapping rules:
//   - First occurrence wins (later duplicates are ignored).
//   - Non-string entries are rejected.
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// IRI compaction helper
// -----------------------------------------------------------------------------
//
// If iri is present in the dictionary map:
//   iri -> "z:<index>"
// Otherwise:
//   iri -> iri (unchanged)
//
// This compacts repeated IRIs to reduce output size.
// -----------------------------------------------------------------------------

function toZ(iri, iriMap) {
  const idx = iriMap.get(iri);
  return idx === undefined ? iri : `z:${idx}`;
}

// -----------------------------------------------------------------------------
// Lightweight IRI detection
// -----------------------------------------------------------------------------
//
// This is a heuristic, not a full RFC validation.
// It is used only to decide whether a string should be considered IRI-like.
// -----------------------------------------------------------------------------

function looksLikeIri(s) {
  return typeof s === "string" && (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("urn:"));
}

// -----------------------------------------------------------------------------
// SPARQL detection heuristic
// -----------------------------------------------------------------------------
//
// "SPARQL-ish" strings are detected to allow safe comment stripping.
//
// Requirements:
//   - must include at least one query form: SELECT / CONSTRUCT / ASK / DESCRIBE
//   - and must include at least one additional SPARQL-ish marker:
//       PREFIX, BASE, WHERE, FILTER, OPTIONAL, GRAPH, BIND, VALUES
//
// This reduces the chance of stripping text that merely contains comment markers.
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// SPARQL comment stripping
// -----------------------------------------------------------------------------
//
// Supported comment types:
//   - Line comments starting with '#', ending at newline
//   - Block comments delimited by '/*' and '*/'
//
// Protected regions where comment markers must be ignored:
//   - Single quoted strings: '...'
//   - Double quoted strings: "..."
//   - IRIREFs: <...>
//
// Implementation notes:
//   - A simple state machine scans the query character-by-character.
//   - Escapes inside quoted strings are honored (backslash).
//   - Newlines are preserved for line comments to keep line structure.
//
// This is not a full SPARQL parser; it aims to be correct for typical queries.
// -----------------------------------------------------------------------------

function stripSparqlComments(query) {
  if (typeof query !== "string" || query.length === 0) return query;

  let out = "";
  let i = 0;

  let inSingle = false;       // '...'
  let inDouble = false;       // "..."
  let inIriRef = false;       // <...>
  let inLineComment = false;  // # ... \n
  let inBlockComment = false; // /* ... */

  while (i < query.length) {
    const c = query[i];
    const next = i + 1 < query.length ? query[i + 1] : "";

    // End of line comment: drop content until newline; keep newline.
    if (inLineComment) {
      if (c === "\n") {
        inLineComment = false;
        out += c;
      }
      i++;
      continue;
    }

    // End of block comment: drop content until closing '*/'.
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    // IRIREF <...>: copy verbatim until '>'.
    if (inIriRef) {
      out += c;
      if (c === ">") inIriRef = false;
      i++;
      continue;
    }

    // Quoted strings: copy verbatim, handle escapes.
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

    // Enter protected regions.
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

    // Enter comments (only when not in protected regions).
    if (c === "#") {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }

    // Ordinary character.
    out += c;
    i++;
  }

  return out;
}

// -----------------------------------------------------------------------------
// Conditional SPARQL comment stripping
// -----------------------------------------------------------------------------
//
// Only strip comments when the value looks like a SPARQL query.
// Otherwise return the original string unchanged.
// -----------------------------------------------------------------------------

function maybeStripSparqlComments(s) {
  return looksLikeSparql(s) ? stripSparqlComments(s) : s;
}

// -----------------------------------------------------------------------------
// JSON-LD transformation
// -----------------------------------------------------------------------------
//
// Recursively transform a JSON-LD input to use "z:<index>" identifiers.
//
// Operations:
//   1) Predicate keys (object properties) are rewritten via toZ(), except:
//        - JSON-LD keywords starting with '@' are preserved
//
//   2) @type rewriting:
//        - string => toZ(value)
//        - array of strings => each string rewritten
//        - other forms unchanged
//
//   3) Optional ID/value rewriting when rewriteIds is true:
//        - @id string values may be rewritten if they look like IRIs
//        - other string values may be rewritten if they look like IRIs
//
//   4) SPARQL comment stripping:
//        - any string that looks like SPARQL is cleaned by removing comments
//        - cleaning happens before optional IRI rewriting
//
// This function does not change the structural shape of the JSON; it only
// rewrites keys and string values under the above rules.
// -----------------------------------------------------------------------------

function transformJsonLd(node, iriMap, { rewriteIds }) {
  if (Array.isArray(node)) {
    return node.map((x) => transformJsonLd(x, iriMap, { rewriteIds }));
  }

  if (node && typeof node === "object") {
    const out = {};

    for (const [key, value] of Object.entries(node)) {
      // Rewrite non-JSON-LD keys; preserve JSON-LD keywords (starting with '@').
      const newKey = key.startsWith("@") ? key : toZ(key, iriMap);

      // @type rewriting.
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

      // Optional @id rewriting (only if enabled).
      if (rewriteIds && key === "@id" && typeof value === "string") {
        const cleaned = maybeStripSparqlComments(value);
        out[newKey] = looksLikeIri(cleaned) ? toZ(cleaned, iriMap) : cleaned;
        continue;
      }

      // Recurse into objects/arrays.
      if (value && typeof value === "object") {
        out[newKey] = transformJsonLd(value, iriMap, { rewriteIds });
        continue;
      }

      // Primitive handling:
      //   - For strings: optionally strip SPARQL comments, then optionally rewrite IRIs.
      //   - For other primitives: copy as-is.
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

  // Primitive at root or inside arrays:
  // Apply SPARQL stripping to standalone strings as well.
  if (typeof node === "string") {
    return maybeStripSparqlComments(node);
  }

  return node;
}

// -----------------------------------------------------------------------------
// Main program flow
// -----------------------------------------------------------------------------
//
// Steps:
//   - Parse CLI args
//   - Read input JSON-LD and iris list
//   - Parse/validate JSON
//   - Build IRI index map
//   - Transform JSON-LD structure
//   - Write output JSON (pretty or compact)
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Top-level error handling
// -----------------------------------------------------------------------------
//
// Ensures a clear error message and a non-zero exit code for failures.
// -----------------------------------------------------------------------------

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

