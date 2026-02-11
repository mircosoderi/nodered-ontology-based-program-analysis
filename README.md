# Node-RED Ontology-Based Program Analysis

> Towards lightweight RDF store and N3 reasoner embedded in the Node-RED engine via runtime and editor plugins for ontology-based analysis of the user application with humans in the loop.

---

## Overview

This repository explores how **semantic technologies (RDF, JSON-LD, N3 reasoning)** can be embedded directly into the **Node-RED runtime** to support:

- Static and structural analysis of user flows  
- Cross-linking with community knowledge (GitHub issues, forum discussions, flows library)  
- Detection of architectural patterns and anti-patterns  
- Human-in-the-loop inspection and reasoning  
- Resource-efficient semantic processing inside a low-code environment  

The core idea is to treat a Node-RED user application as a **knowledge graph**, and to enable reasoning directly inside the running engine.

---

## Repository Structure

```
.
├── nodered-urdf/                      # Dockerized Node-RED + RDF + reasoning integration
│   ├── node-red-urdf-plugin/          # Runtime + editor plugin
│   ├── Dockerfile
│   └── openapi.yaml
│
├── nodered-user-application-ontology/ # Ontology for modeling Node-RED applications
│
├── experiments/                       # Resource-utilization and scalability experiments
│
├── github-issues-to-jsonld/           # GitHub Issues → JSON-LD exporter
├── discourse-forum-to-jsonld/         # Discourse forum → JSON-LD exporter
├── flows-json-to-jsonld/              # Node-RED flows library → JSON-LD exporter
│
└── README.md
```

---

## Quick Start — Try It Out

The fastest way to evaluate the system is to build and run the Docker image in:

```
nodered-urdf/
```

### 1️⃣ Clone the repository

```bash
git clone https://github.com/mircosoderi/nodered-ontology-based-program-analysis.git
cd nodered-ontology-based-program-analysis/nodered-urdf
```

### 2️⃣ Build the Docker image

```bash
docker build -t nodered-urdf:4.1.3-22 .
```

### Create a user-defined Docker network

```bash
 docker network create nodered-urdf-net
```

### 3️⃣ Run the container

```bash
docker run -it --rm \
  --name nodered-urdf \
  --network nodered-urdf-net \
  -p 1880:1880 \
  -v nodered_urdf_data:/data \
  -e NODE_RED_CREDENTIAL_SECRET="CHANGE_ME" \
  -e NODE_RED_INSTANCE_id="123" \
  nodered-urdf:4.1.3-22
```

Open in browser:

```
http://localhost:1880/
```

This starts a Node-RED instance with:

- Embedded RDF store (uRDF.js)  
- Embedded N3 reasoner (eyeling)  
- Admin HTTP API (`/urdf/*`)  
- Editor sidebar plugin (human-in-the-loop inspection)  
- Preloaded ontology and rules  

### Load example community knowledge

Some of the pre-loaded example rules only work if you upload the example GitHub issues, discourse forum posts, and library flows.

To upload the example GitHub issues:

```bash
    cd github-issues-to-jsonld
    
    docker build -t github-issues-to-jsonld .
    
    docker run --rm --network nodered-urdf-net \
      -v "$(pwd)/input:/app/input:ro" \
      -v "$(pwd)/output:/app/output" \
      -e NODERED_URDF="http://nodered-urdf:1880/" \
      github-issues-to-jsonld
```

To upload the example discourse forum posts:

```bash
    cd discourse-forum-to-jsonld
    
    docker build -t discourse-forum-to-jsonld .
    
    docker run --rm --network nodered-urdf-net \  
    -v "$(pwd)/input:/app/input:ro" \  
    -v "$(pwd)/output:/app/output" \  
    -e NODERED_URDF="http://nodered-urdf:1880/" \  
    discourse-forum-to-jsonld
```

To upload the example library flows:

```bash
    cd flows-json-to-jsonld
    
    docker build -t flows-json-to-jsonld .
    
    docker run --rm --network nodered-urdf-net \
      -v "$(pwd)/input:/app/input:ro" \
      -v "$(pwd)/output:/app/output" \
      -e NODERED_URDF="http://nodered-urdf:1880/" \
      -e FLOWS_URL="https://github.com/node-red/cookbook-flows" \
      flows-json-to-jsonld
```

Make a minor change and redeploy the Node-RED application to trigger the reasoning after uploading the example community knowledge.

---

## Core Concepts

### Node-RED as Knowledge Graph

The running flow is modeled as RDF:

- Nodes  
- Flows  
- Connections  
- Runtime environment metadata  
- Application ontology  

This enables semantic querying and reasoning.

---

### Named Graph Architecture

The RDF store is organized into named graphs:

- Ontology graph  
- Application graph  
- Rules graph  
- Inferred graph  
- Environment graph  

This separation allows controlled reasoning and incremental updates.

---

### Human-in-the-Loop Reasoning

The editor sidebar allows users to:

- Load, query, clear semantic data  
- Manage rules
- Inspect reasoning results

---

### Lightweight by Design

The system is:

- Embedded inside Node-RED  
- Resource-aware  
- Experimentally measured  

See `experiments/` for reproducible measurements of resource usage and scalability.

---

## Ontology

The dedicated ontology for modeling Node-RED applications:

```
nodered-user-application-ontology/
```

It reuses established vocabularies such as schema.org where appropriate and focuses on structural representation of flows and nodes.

[Link to the Web page of the ontology](https://mircosoderi.github.io/nodered-ontology-based-program-analysis/nodered-user-application-ontology/release/1.0.0/index-en.html)

---

## Data Importers

JSON → JSON-LD converters for enriching the RDF store with community knowledge:

- GitHub Issues exporter  
- Discourse forum exporter  
- Node-RED flows library exporter  

---

## Experiments

The `experiments/` folder contains structured documentation for:

- Resource utilization  
- Scalability behavior  
- Comparison runs (with and without reasoning)  

Each experiment is documented with reproducible procedures.

---

## API

The runtime plugin exposes Admin HTTP endpoints:

```
/urdf/health
/urdf/size
/urdf/graph
/urdf/export
/urdf/query
/urdf/load
/urdf/clear
/urdf/rules/*
```

Formal specification:

```
nodered-urdf/openapi.yaml
```

---

## Intended Audience

- Semantic Web researchers  
- Node-RED developers  
- Low-code platform researchers  
- Software architecture analysis researchers  
- Sustainable software engineering researchers  
- Human-centered AI practitioners  

---

## Status

Research-oriented proof-of-concept.

Includes:

- Working Docker image  
- Runtime + editor plugins  
- Experimental infrastructure  
- API specification  
- Ontology releases  

---

## Contact

Open an issue on GitHub for questions or collaboration inquiries.
