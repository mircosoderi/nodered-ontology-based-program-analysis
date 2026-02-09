# JSON-LD Flattened Checker

This repository provides a small, self-contained command-line tool for checking
whether a JSON or JSON-LD document is already *flattened*, based on an
equivalence comparison with the output of `jsonld.flatten`.

The tool is intentionally conservative: it does **not** modify the input
document and does **not** attempt to flatten it. Its sole purpose is to answer
the question *“Is this document already flattened?”* and to explain why when it
is not.

---

## Repository Contents

### JavaScript script

**`index.js`**

A Node.js (ES module) command-line script that performs the following tasks:

- Reads a JSON or JSON-LD file from disk.
- Parses and validates the file as JSON.
- Delegates flattened-equivalence checking to a domain-specific library.
- Reports a clear yes/no result on standard output.
- Provides a human-readable reason and optional hint when the document is not
  flattened.
- Exits with stable, automation-friendly exit codes.

---

## Directory Layout

```
.
├── index.js
├── lib/
│   └── checkFlattened.js
├── package.json
└── README.md
```

- **`index.js`**  
  CLI entry point.

- **`lib/checkFlattened.js`**  
  Library implementing the flattened-equivalence logic.

---

## Input File

### JSON / JSON-LD document

The input file must:

- Be valid UTF‑8 text.
- Contain valid JSON.
- Represent either a generic JSON structure or a JSON-LD document.

No assumptions are made about contexts, compaction, or ordering. Objects and
arrays are supported at any nesting depth.

---

## Output and Exit Codes

### Console output

The tool prints a concise, human-oriented report:

- ✅ when the document is already flattened.
- ❌ when the document is not flattened.

When not flattened, additional sections are printed:

- **Reason** – the primary cause of the mismatch.
- **Hint** (optional) – guidance on what differs from a flattened form.

### Exit codes

| Code | Meaning |
|-----:|--------|
| 0 | Document is flattened |
| 1 | Document is valid JSON but not flattened |
| 2 | Usage error, file read error, or JSON parse error |

These codes are stable and intended for scripting and CI usage.

---

## Command-Line Usage

Execution is performed using Node.js:

```bash
node index.js --file <path-to-json-or-jsonld>
```

Short form:

```bash
node index.js -f <path>
```

Help:

```bash
node index.js --help
```

### Examples

```bash
node index.js --file ./data/doc.jsonld
node index.js --file ./data/flattened.json
```

---

## Runtime Requirements

- Node.js 18 or newer
- No external runtime dependencies

---

## Design Notes

- This tool performs *verification*, not transformation.
- Flattened equivalence is delegated to a dedicated library to keep the CLI
  logic simple and auditable.
- Error handling is explicit and fail-fast.
- Output is designed for both human inspection and machine consumption.
- No JSON-LD context rewriting, compaction, or normalization is performed.

---

## Intended Use Cases

- Pre-flight validation before ingesting JSON-LD into systems that require
  flattened form.
- Debugging JSON-LD pipelines.
- CI checks to enforce data-shape invariants.
- Educational inspection of JSON-LD flattening behavior.
