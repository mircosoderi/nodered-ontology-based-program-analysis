# Node-RED Flows JSON → JSON-LD Exporter

This repository provides a small, self-contained command-line tool and Docker image
for transforming Node-RED flow exports into JSON-LD datasets suitable for ingestion
into a uRDF-compatible store.

Each Node-RED *flow tab* is converted into a semantic resource described as
`schema:SoftwareSourceCode`, with lightweight metadata extracted directly from the
flow structure.

---

## Repository Contents

### Python script

**`flows-json-to-jsonld.py`**

A single-file Python 3 script that performs the following tasks:

- Reads one or more Node-RED flow export files from a directory.
- Identifies flow tabs (`type == "tab"`) and groups nodes by tab.
- Extracts:
  - a human-readable title
  - a stable identifier
  - the set of node types used in each flow
- Emits a JSON-LD dataset where each flow is represented as a resource.
- Optionally uploads the generated dataset to a running Node-RED uRDF endpoint.

### Dockerfile

**`Dockerfile`**

A minimal container image that:

- Uses `python:3.12-slim` as the runtime base.
- Copies the converter script into the image.
- Exposes `/app/input` and `/app/output` as conventional volume mount points.
- Runs the converter script as the container entrypoint.

---

## Directory Layout

```
.
├── flows-json-to-jsonld.py
├── Dockerfile
├── input/
│   └── *.json
├── output/
│   └── *.jsonld
└── README.md
```

- **`input/`**  
  Directory containing one or more Node-RED flow export files (`.json`).

- **`output/`**  
  Directory where the generated JSON-LD datasets are written.

---

## Input Format

The input files must be valid JSON exports produced by Node-RED.

Supported shapes:

- A top-level JSON array of node objects (typical Node-RED export).
- A JSON object containing such an array under one of the following keys:
  `flows`, `nodes`, `data`, `items`, or `content`.

Each node is expected to follow standard Node-RED conventions (`id`, `type`, `z`, etc.).

---

## Output Format

For each input file, the tool produces **one JSON-LD dataset** (a JSON array)
containing a single named graph.

Characteristics:

- No JSON-LD compaction or prefixing is performed.
- All predicate values are arrays (loader-compatible).
- The dataset contains one graph with:
  - one node per Node-RED flow tab
  - `schema:SoftwareSourceCode` as the declared type
  - keywords derived from node types used in the flow

Example (simplified):

```json
[
  {
    "@context": {},
    "@id": "urn:graph:flowslib",
    "@graph": [
      {
        "@id": "urn:libflow:abcd1234",
        "@type": ["https://schema.org/SoftwareSourceCode"],
        "https://schema.org/title": [{"@value": "Example Flow"}],
        "https://schema.org/url": [{"@value": "https://example.org/flows"}],
        "https://schema.org/identifier": [{"@value": "abcd1234"}],
        "https://schema.org/keywords": [{"@value": "inject,http request,debug"}]
      }
    ]
  }
]
```

---

## ZURL (IRI Indexing)

When connected to a Node-RED runtime exposing uRDF endpoints, the script can
retrieve a **ZURL dictionary**:

```
GET {NODERED_URDF}/urdf/zurl
```

If enabled:

- Known IRIs are replaced with compact `z:<index>` identifiers.
- Unknown IRIs are left untouched.
- The transformation is purely syntactic; no semantic meaning is altered.

This reduces repetition of long IRIs while keeping the dataset reversible.

---

## Environment Variables

The script is configured entirely via environment variables:

- **`FLOWS_URL`** (required)  
  External URL associated with the flow library.  
  Used only to populate `schema:url`.

- **`NODERED_URDF`** (optional)  
  Base URL of a Node-RED runtime exposing `/urdf` endpoints.
  When set, enables:
  - ZURL dictionary fetching
  - automatic upload via `/urdf/loadFile`

If `NODERED_URDF` is not set, upload is skipped and files are only written locally.

---

## Running with Docker

Build the image:

```bash
docker build -t flows-json-to-jsonld .
```

Run the converter:

```bash
docker run --rm \
  -e FLOWS_URL=https://example.org/flows \
  -e NODERED_URDF=http://localhost:1880 \
  -v $(pwd)/input:/app/input \
  -v $(pwd)/output:/app/output \
  flows-json-to-jsonld
```

---

## Runtime Requirements (Non-Docker)

- Python 3.12 or newer
- No external Python dependencies

---

## Design Notes

- The transformation is deterministic and order-preserving.
- The script intentionally avoids JSON-LD context compaction to keep all IRIs explicit.
- The output structure matches the expectations of uRDF’s dataset loader.
- The tool is designed for batch operation and CI-friendly usage.

---

## Intended Use

This tool is intended as a **structural bridge** between Node-RED flow design
and semantic indexing:

- Flow libraries
- Knowledge graphs of automation assets
- Documentation and discovery services
- Lightweight semantic analysis of low-code systems
