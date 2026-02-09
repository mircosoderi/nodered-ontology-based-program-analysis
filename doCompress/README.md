# JSON-LD Zify

This repository provides a small, self-contained command-line tool for transforming JSON-LD documents by rewriting IRIs into compact indexed tokens. The transformation uses a user-provided IRI list as a stable dictionary and preserves the original JSON structure while reducing repetition of long IRIs.

The tool also performs conservative cleanup of SPARQL-like query strings by stripping comments while preserving quoted strings and IRI references.

---

## Repository Contents

### JavaScript script

**`index.js`**

A Node.js (ES module) script that performs the following tasks:

- Reads a JSON-LD input file.
- Reads an IRI list file (`iris.json`) containing an ordered JSON array of strings.
- Builds a stable mapping from IRI string to numeric index.
- Rewrites JSON object keys that represent predicate IRIs into `z:<index>` tokens (JSON-LD keywords starting with `@` are preserved).
- Rewrites `@type` values (string or array of strings) into `z:<index>` tokens when present in the IRI list.
- Optionally rewrites:
  - `@id` values
  - other IRI-looking string values
- Detects SPARQL-like strings and removes:
  - `#` line comments
  - `/* ... */` block comments
  while preserving comment markers inside quoted strings and `<...>` IRI references.
- Writes the transformed JSON-LD to an output file, optionally pretty-printed.

---

## Directory Layout

```
.
├── index.js
├── package.json
├── input.jsonld
├── iris.json
└── output.jsonld
```

- **`input.jsonld`**  
  Default input JSON-LD document.

- **`iris.json`**  
  Default IRI list used to build the index dictionary.

- **`output.jsonld`**  
  Default output written by the transformation.

---

## Input Files

### JSON-LD input

The input file must be valid JSON. Objects and arrays are supported at any nesting depth.

Special handling is applied to:

- Predicate keys (non-`@` keys) treated as IRIs for rewriting.
- `@type` values rewritten when string or array of strings.
- `@id` values rewritten only when the optional rewriting mode is enabled.
- String values scanned for SPARQL-like content and cleaned when applicable.

### IRI list

The IRI list file must be a JSON array of strings:

```json
[
  "http://example.org/iri/one",
  "http://example.org/iri/two",
  "urn:example:three"
]
```

Rules:

- Array position defines the numeric index.
- The first occurrence of an IRI determines its index.
- Duplicate IRIs are ignored after the first occurrence.
- Non-string entries are rejected.

---

## Output Format

The output is valid JSON and retains the same structural shape as the input.

- JSON-LD keywords (keys starting with `@`) are preserved.
- Predicate keys and selected string values may be rewritten to `z:<index>` tokens.
- No JSON-LD compaction or context manipulation is performed.
- A trailing newline is always written.

---

## Command-Line Usage

Execution is performed using Node.js:

```bash
node index.js [options]
```

Supported options:

- `--in <file>`  
  Input JSON-LD file (default: `input.jsonld`)

- `--iris <file>`  
  IRI list file (default: `iris.json`)

- `--out <file>`  
  Output file (default: `output.jsonld`)

- `--pretty`  
  Pretty-print JSON output with indentation

- `--rewrite-ids`  
  Rewrite `@id` and other IRI-looking string values

Unknown options cause an error and terminate execution.

---

## NPM Scripts

The following scripts are provided in `package.json`:

- `npm run start`  
  Runs with default files and compact JSON output.

- `npm run start:pretty`  
  Runs with pretty-printed output.

- `npm run start:all`  
  Runs with pretty-printed output and enabled rewriting of `@id` and other IRI-looking string values.

---

## Transformation Summary

### IRI rewriting

When a value matches an entry in the IRI list, it is rewritten as:

```
z:<index>
```

When no match exists, the original value is preserved.

### SPARQL comment stripping

String values that match the SPARQL heuristic are cleaned by removing comments:

- `#` comments until newline
- `/* ... */` comments

Comment markers inside:

- single-quoted strings
- double-quoted strings
- `<...>` IRI references

are preserved as literal content.

---

## Runtime Requirements

- Node.js 18 or newer
- No external dependencies

---

## Design Notes

- The mapping from IRI to index is stable and deterministic.
- The transformation is recursive and order-preserving.
- SPARQL detection is heuristic and intentionally conservative to reduce unintended modifications.
- The tool is suitable for batch processing and integration into larger data pipelines.
