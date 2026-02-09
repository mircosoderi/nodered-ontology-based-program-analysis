# JSON-LD Flattener (CLI)

This repository provides a small, self-contained command-line utility for flattening JSON-LD documents.

The tool reads a JSON or JSON-LD file from disk, applies JSON-LD flattening using a standards-compliant processor, and writes a normalized JSON-LD output file next to the original input.

The goal is to simplify downstream processing by converting nested or distributed graph structures into a predictable, flat representation while preserving semantic identifiers.

---

## Repository Contents

### JavaScript script

**`index.js`**

A Node.js (ES module) script that performs the following steps:

- Reads a JSON or JSON-LD file from disk.
- Parses and validates the input as JSON.
- Applies JSON-LD flattening using the `jsonld` library.
- Writes the flattened result to a new file with a deterministic name.
- Reports input and output paths on successful completion.
- Exits with meaningful error codes on failure.

The script is dependency-light and intended to be used directly from the command line or as part of a data processing pipeline.

---

## Directory Layout

```
.
├── index.js
├── package.json
└── data/
    └── input.jsonld
```

- **`index.js`**  
  The CLI entry point.

- **`package.json`**  
  Declares runtime dependencies and module type.

- **`data/input.jsonld`**  
  Example input file (optional, not required by the tool).

---

## Input File

The input file must:

- Be valid UTF-8 encoded JSON text.
- Represent either:
  - a valid JSON-LD document, or
  - plain JSON (flattening may fail if JSON-LD semantics are missing).

No assumptions are made about document shape; objects and arrays are supported at any nesting depth.

---

## Output File

The output file:

- Is written to the same directory as the input.
- Uses the naming convention:

```
<original_name>.flattened.jsonld
```

Example:

```
input.jsonld → input.flattened.jsonld
```

Characteristics of the output:

- Valid JSON-LD.
- Flattened graph structure.
- Stable, human-readable formatting (2-space indentation).
- No modification of identifiers beyond what flattening requires.
- No compaction, framing, or context rewriting is performed.

---

## Command-Line Usage

Run the tool using Node.js:

```bash
node index.js --file <path-to-json-or-jsonld>
```

### Options

- `--file`, `-f`  
  Path to the input JSON or JSON-LD file (required).

- `--help`, `-h`  
  Print usage information and exit.

If the `--file` option is missing, usage information is printed and execution terminates with an error code.

---

## Exit Codes

The process exits with the following codes:

- `0`  
  Success, or help requested.

- `1`  
  JSON-LD flattening failed (input is syntactically valid JSON but not valid JSON-LD).

- `2`  
  Usage error, file read failure, JSON parse error, or file write failure.

These codes are intended to be meaningful when the tool is used in scripts or CI pipelines.

---

## Runtime Requirements

- Node.js 18 or newer
- One runtime dependency:
  - `jsonld`

---

## Design Notes

- The tool performs **no mutation** of the input file.
- Flattening is applied as a single semantic operation; no heuristics or partial transformations are used.
- Error handling is explicit and fail-fast.
- The implementation favors clarity and predictability over configurability.

This makes the tool suitable as a reliable preprocessing step in larger semantic data workflows.
