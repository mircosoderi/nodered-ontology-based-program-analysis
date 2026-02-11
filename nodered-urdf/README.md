# nodered-urdf

Docker build context for a **derived Node-RED image** that bundles:

- an embedded **RDF store** (uRDF.js) and **N3 reasoner** (eyeling),
- a **Node-RED runtime plugin** (admin endpoints + store/reasoning integration),
- a **Node-RED editor sidebar plugin** (human-in-the-loop inspection & actions),
- default assets (ontology, rules, example flows) to make the image runnable out of the box.

## What is in this folder

- `Dockerfile` — multi-stage build that installs the plugin dependencies in a build stage (with `git`), then copies only the prepared plugin directory into the final runtime image.
- `docker-entrypoint.sh` — initializes `/data` (Node-RED user directory) on container start (settings, flows, credential secret) and installs the plugin into `/data/node_modules/`.
- `node-red-urdf-plugin/` — the Node-RED package containing **both** plugins (runtime + editor).
  - Folder README: https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/nodered-urdf/node-red-urdf-plugin/README.md
  - `runtime/` sources: https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/nodered-urdf/node-red-urdf-plugin/runtime
  - `editor/` sources: https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/nodered-urdf/node-red-urdf-plugin/editor
- Preloaded RDF/JSON-LD assets (examples and defaults):
  - `nodered-user-application-ontology*.jsonld` — ontology data (also available as flattened/compressed variants).
  - `rules*.jsonld` — reasoning rules (also available as flattened/compressed variants).
  - `zurl.json` — a curated list of IRIs used by the runtime plugin for memory-efficient triples storage.
  - `nodered-default-settings.js` — minimal `settings.js` template copied into `/data` on first startup.
  - `nodered-default-flows.json` — default flows copied to `/data/flows.json` on startup.
- `openapi.yaml` — OpenAPI specification for the runtime plugin’s Admin HTTP endpoints:
  - https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/nodered-urdf/openapi.yaml

## Quick start

### 1) Clone the repository

```bash
git clone https://github.com/mircosoderi/nodered-ontology-based-program-analysis.git
cd nodered-ontology-based-program-analysis/nodered-urdf
```

### 2) Build the image

```bash
docker build -t nodered-urdf:4.1.3-22 .
```

### 3) Run the container

A named volume is recommended to persist `/data` (flows, projects, credentials, installed modules).

```bash
docker run -it --rm \
  --name nodered-urdf \
  -p 1880:1880 \
  -v nodered_urdf_data:/data \
  -e NODE_RED_CREDENTIAL_SECRET="CHANGE_ME" \
  -e NODE_RED_INSTANCE_ID="123"
  nodered-urdf:4.1.3-22
```

Open:

- Node-RED editor: `http://localhost:1880/`

## Container startup behavior

The entrypoint script (`docker-entrypoint.sh`) is responsible for the initial setup of the Node-RED user directory (`/data`).

### Credential secret

Node-RED encrypts credentials stored in flows. The secret is resolved in this order:

1. `NODE_RED_CREDENTIAL_SECRET` environment variable (recommended for deterministic deployments)
2. `/data/.node-red-credential-secret` persisted file (generated once when missing)

The settings template (`nodered-default-settings.js`) implements the same resolution strategy and falls back to `INSECURE_DEFAULT_CHANGE_ME` when neither value exists.

### settings.js

On first startup (fresh `/data` volume), the entrypoint copies:

- `/opt/nodered-default-settings.js` → `/data/settings.js`

Once created in `/data`, `settings.js` can be edited without rebuilding the image.

### flows.json (default flows)

On container start, the entrypoint copies:

- `/opt/nodered-default-flows.json` → `/data/flows.json`

**Important:** as currently implemented, this copy is unconditional and will overwrite `/data/flows.json` on every start. 

### Plugin installation

Node-RED loads user modules from `/data/node_modules`. The entrypoint copies the plugin into:

- `/opt/node-red-urdf-plugin` → `/data/node_modules/node-red-urdf-plugin`

This copy happens only when the destination directory does not exist. For upgrades, remove the destination directory (inside the volume) or recreate the volume.

## Using the UI (editor sidebar)

The `node-red-urdf-plugin` includes an editor sidebar (“uRDF”) that exposes actions to:

- inspect loaded graphs and configuration,
- inspect inferred triples,
- run store operations from within the editor.

## Runtime HTTP API

The runtime plugin registers Admin HTTP endpoints under `/urdf/*` (Node-RED admin server, typically the same host/port as the editor).

The authoritative API reference is:

- OpenAPI spec: https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/nodered-urdf/openapi.yaml

Implemented endpoints (see `openapi.yaml` for request/response schemas):

- `GET /urdf/health` — plugin health check
- `GET /urdf/size` — store size summary
- `GET /urdf/graph` — list graphs / inspect a graph by `gid`
- `GET /urdf/export` — export a graph by `gid`
- `GET /urdf/node` — inspect a node / resource
- `POST /urdf/clear` — clear a graph or the store
- `POST /urdf/load` — load JSON-LD payload into a graph
- `POST /urdf/loadFile` — load JSON-LD from a server-side file path
- `POST /urdf/query` — run queries (store-level / graph-level)
- `POST /urdf/rules/create` — create a rule
- `POST /urdf/rules/update` — update a rule
- `POST /urdf/rules/delete` — delete a rule

### Data model: named graphs (`gid`)

The store is organized as **named graphs**, each identified by a `gid` string (often a URN/IRI). The OpenAPI `info.description` documents the conventional graph identifiers used by the runtime (examples include ontology, rules, environment, application model, inferred graph).

## Preloaded assets and their role

This folder keeps both “source” JSON-LD and preprocessed variants:

- `*.jsonld` — source representation
- `*.flattened.jsonld` — flattened JSON-LD
- `*.flattened.compressed.jsonld` — flattened + compressed representation

The Docker image copies the **flattened+compressed** variants into `/opt/urdf/` by default:

- `/opt/urdf/nodered-user-application-ontology.flattened.compressed.jsonld`
- `/opt/urdf/rules.flattened.compressed.jsonld`
- `/opt/urdf/zurl.json`

This keeps runtime loading simple and predictable, while retaining the original source files in the repository for review and editing.

## Development and update workflow

### Rebuild after changes

When changing files under `nodered-urdf/` (Dockerfile, entrypoint, default assets, plugin sources), rebuild the image:

```bash
docker build -t nodered-urdf:4.1.3-22 .
```

### Updating the plugin inside an existing volume

Because the plugin is copied into `/data/node_modules/node-red-urdf-plugin` only if missing:

- either delete the named volume and re-run the container:

```bash
docker volume rm nodered_urdf_data
```

- or remove only the plugin directory inside the volume (example using a one-shot container):

```bash
docker run --rm -v nodered_urdf_data:/data alpine:3.20 \
  sh -lc 'rm -rf /data/node_modules/node-red-urdf-plugin'
```

