# Discourse Forum to JSON-LD Exporter

This repository provides a small, self-contained pipeline for transforming Discourse forum exports into JSON-LD datasets. The generated datasets can optionally be loaded into a Node-RED URDF endpoint. The tooling is designed to be simple, reproducible, and suitable for batch processing, both locally and in containerized environments.

The primary goal is the semantic enrichment of forum discussions, with a focus on Node-RED–related content, using conservative heuristics applied to topic metadata and titles.

---

## Repository Contents

### Python script

**`discourse-forum-to-jsonld.py`**

A Python 3 script that performs the following tasks:

- Reads Discourse JSON exports from an input directory.
- Extracts topics from `topic_list/topics`.
- Converts each input file into a JSON-LD dataset containing a single named graph.
- Enriches topics with inferred metadata, including:
  - Tags represented as `schema:DefinedTerm` entities.
  - A normalized rating derived from `like_count` values within each file.
  - Operating system hints inferred from topic titles.
  - Node.js version hints inferred from topic titles.
  - Node-RED version hints inferred from topic titles using strict contextual rules.
  - Containerization hints inferred from topic titles.
- Writes the resulting JSON-LD datasets to an output directory.
- Optionally uploads the generated datasets to a Node-RED URDF endpoint.

The script deliberately avoids JSON-LD compaction. All properties are expressed using full IRIs (or ZURL indirections when available), and the `@context` is intentionally left empty.

---

### Dockerfile

**`Dockerfile`**

A minimal container definition that:

- Uses the official `python:3.12-slim` base image.
- Copies the Python script into the container image.
- Creates the expected runtime directories.
- Executes the script as the container entrypoint with unbuffered output.

The container is intended for batch execution and integrates cleanly with bind-mounted directories for input and output data.

---

## Directory Layout

```
.
├── discourse-forum-to-jsonld.py
├── Dockerfile
├── input/
│   └── *.json
└── output/
    └── *.jsonld
```

- **`input/`**  
  Contains one or more Discourse JSON export files. Each file is processed independently.

- **`output/`**  
  Receives one JSON-LD file per input file, using the same base filename.

---

## Input Format

Each input file must be a valid JSON object containing a Discourse topic list structured as follows:

```json
{
  "topic_list": {
    "topics": [
      {
        "id": 123,
        "slug": "example-topic",
        "title": "Example title",
        "last_posted_at": "2024-01-01T12:00:00Z",
        "tags": ["example", "tag"],
        "like_count": 5
      }
    ]
  }
}
```

Only the fields shown above are required. Any additional fields present in the input are ignored.

---

## Output Format

For each input file, the script produces a JSON-LD dataset structured as a list containing a single named graph.

- The graph `@id` is derived from the input filename.
- The graph contains:
  - A `schema:DefinedTermSet` representing all tags found in the file.
  - One `schema:DefinedTerm` per unique tag.
  - One `schema:Rating` per topic, normalized within the scope of the file.
  - One `schema:DigitalDocument` per topic, linking all inferred entities.

No JSON-LD prefixes are used. All properties are expanded IRIs (or ZURL references when enabled).

---

## Heuristic Enrichment Summary

All heuristic enrichment is derived exclusively from topic titles and is intentionally conservative.

- **Operating system detection**  
  Keyword-based detection with word-boundary safeguards to reduce false positives.

- **Node.js version detection**  
  A version is extracted only when the literal string `node.js` appears and is immediately followed by a valid version token.

- **Node-RED version detection**  
  A version is extracted only when a valid version token is immediately preceded by one of: `nr`, `nodered`, or `node-red`.

- **Containerization hint**  
  A boolean flag is set when common container-related terms appear in the title.

---

## Running Without Docker

Requirements:

- Python 3.12 or compatible

Example:

```bash
mkdir -p input output
cp forum-export.json input/

python discourse-forum-to-jsonld.py
```

---

## Running With Docker

Build the image:

```bash
docker build -t discourse-jsonld .
```

Run the container with bind-mounted directories:

```bash
docker run --rm \
  -v "$PWD/input:/app/input" \
  -v "$PWD/output:/app/output" \
  discourse-jsonld
```

To enable ZURL resolution and dataset upload, provide the URDF endpoint:

```bash
docker run --rm \
  -e NODERED_URDF=http://localhost:1880 \
  -v "$PWD/input:/app/input" \
  -v "$PWD/output:/app/output" \
  discourse-jsonld
```

---

## Design Notes

- Each input file is processed independently to preserve contextual normalization (for example, rating scaling).
- Identifiers are deterministic and stable within the scope of a file.
- The output favors explicitness and interoperability over compactness.
- The script is suitable for automation, scheduled execution, and integration into larger ingestion pipelines.

