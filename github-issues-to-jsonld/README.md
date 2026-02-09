# GitHub Issues → JSON-LD Exporter

This repository provides a small, self-contained command-line tool for transforming
GitHub Issues / Pull Requests JSON exports into JSON-LD datasets based on
**schema.org** and a lightweight Node-RED–specific ontology.

The tool is designed to be deterministic, inspectable, and easy to integrate into
data pipelines that analyse or curate GitHub issue metadata at scale.

---

## What this tool does

For each input GitHub Issues / PRs JSON file, the exporter:

- Reads a JSON array produced by the GitHub REST API (`/issues` endpoint).
- Generates **one JSON-LD named graph** per input file.
- Emits:
  - `schema:DigitalDocument` nodes (one per issue / PR)
  - A `schema:DefinedTermSet` describing known Node-RED labels
  - One `schema:DefinedTerm` per known label
  - One `schema:Rating` per issue / PR (derived from reactions)
- Applies **conservative, title-based heuristics** to infer:
  - Operating system (`schema:OperatingSystem`)
  - Node.js runtime and version
  - Node-RED runtime versions
  - Containerisation hints (Docker / containers)

No JSON-LD compaction is performed. The output graph is explicit and fully expanded,
making it suitable for downstream processing, filtering, or loading into RDF/graph
stores.

---

## Repository contents

### Python script

**`github-issues-to-jsonld.py`**

A Python 3.12+ script that performs the full transformation pipeline:

- Loads GitHub Issues / PRs JSON exports
- Builds stable URNs for all generated entities
- Converts labels into a controlled vocabulary
- Computes ratings from `+1` / `-1` reactions
- Applies runtime and OS detection heuristics
- Emits JSON-LD datasets ready for ingestion

The script is dependency-free and relies only on the Python standard library.

### Dockerfile

**`Dockerfile`**

A minimal container image that:

- Packages the exporter script
- Defines `/app/input` and `/app/output` directories
- Runs the exporter as the container entrypoint

This allows the tool to be executed without installing Python locally.

---

## Directory layout

```
.
├── github-issues-to-jsonld.py
├── Dockerfile
├── input/
│   └── *.json
└── output/
    └── *.jsonld
```

- **`input/`**  
  Place one or more GitHub Issues / PRs JSON exports here.

- **`output/`**  
  Generated JSON-LD datasets will be written here, one per input file.

---

## Input format

Each input file must be a valid JSON array where each element is an issue or pull
request object as returned by the GitHub REST API.

Only a subset of fields is used, including:

- `title`
- `updated_at`
- `html_url`
- `labels`
- `reactions`

Additional fields are ignored.

---

## Output format

For each input file, the exporter writes a JSON-LD **dataset** (array containing one
named graph):

```json
[
  {
    "@context": {},
    "@id": "urn:graph:<slug>",
    "@graph": [ ...nodes... ]
  }
]
```

Characteristics:

- No prefixes or compact context
- Stable, deterministic URNs
- One graph per input file
- Explicit typing (`schema:DigitalDocument`, `schema:Rating`, etc.)

---

## Heuristic enrichment

All enrichment is based **only on the issue / PR title** and follows conservative
rules to avoid over-interpretation.

### Operating system detection

Keyword-based matching maps titles to OS platform identifiers such as:

- `linux`
- `darwin`
- `win32`
- `freebsd`
- `android`

### Runtime detection

- **Node.js**
  - Detected when `node.js` appears in the title
  - The immediately following token is parsed as a version number

- **Node-RED**
  - Any remaining version-like tokens are interpreted as Node-RED versions
  - Node.js version tokens are explicitly excluded

### Containerisation

If the title contains terms such as `docker`, `containerised`, or `dockerized`, the
document is annotated with:

```
nrua:isContainerised = true
```

---

## JSON-LD vocabulary usage

- **schema.org**
  - `DigitalDocument`
  - `DefinedTerm`
  - `DefinedTermSet`
  - `Rating`
  - `OperatingSystem`

- **Node-RED User Application Ontology**
  - `NodeJs`
  - `NodeRed`
  - `isContainerised`

---

## ZURL support (optional)

If the environment variable `NODERED_URDF` is set, the script:

1. Fetches a ZURL IRI list from:
   ```
   GET {NODERED_URDF}/urdf/zurl
   ```
2. Rewrites known IRIs into compact `z:<index>` identifiers.
3. Optionally uploads generated graphs to:
   ```
   POST {NODERED_URDF}/urdf/loadFile
   ```

If `NODERED_URDF` is not set, the exporter runs fully offline.

---

## Usage

### Local execution

```bash
python github-issues-to-jsonld.py
```

Requirements:

- Python 3.12 or newer
- Input files in `./input`
- Write access to `./output`

### Docker execution

```bash
docker build -t github-issues-jsonld .

docker run --rm   -v $(pwd)/input:/app/input   -v $(pwd)/output:/app/output   github-issues-jsonld
```

---

## Design principles

- **Deterministic output** – same input produces the same graph
- **No hidden inference** – all heuristics are explicit and inspectable
- **Minimal dependencies** – standard library only
- **Graph-first mindset** – designed for RDF / knowledge graph workflows

---

## License

MIT License (or compatible).  
See `LICENSE` file if provided.
