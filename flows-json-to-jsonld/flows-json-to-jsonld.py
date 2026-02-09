#!/usr/bin/env python3
"""
Node-RED flow export -> JSON-LD exporter (flow library index).

Purpose
-------
Transforms one or more Node-RED flow exports into a JSON-LD dataset describing
each flow (tab) as a schema:SoftwareSourceCode entry, enriched with a simple
keyword summary (unique node types used in the flow).

I/O Layout
----------
Input:
  ./input/*.json
Each input file is expected to be either:
  - a list of Node-RED nodes (typical export), or
  - a JSON object containing such a list under a common key (flows/nodes/data/items/content)

Output:
  ./output/<same_basename>.jsonld
Exactly one JSON-LD dataset is produced per input file. Each dataset contains:
  - One named graph (@id fixed to "urn:graph:flowslib")
  - One node per Node-RED tab, using:
      * schema:title
      * schema:url
      * schema:identifier
      * schema:keywords

Runtime Coupling (URDF + ZURL)
------------------------------
This script is designed to cooperate with a Node-RED runtime exposing URDF
endpoints:

  - ZURL compaction dictionary:
      GET {NODERED_URDF}/urdf/zurl
    Used to optionally shorten repeated IRIs to identifiers "z:<index>".

  - Dataset ingestion endpoint:
      POST {NODERED_URDF}/urdf/loadFile
    Payload format:
      {"doc": <dataset>}

JSON-LD Style and Loader Constraints
------------------------------------
- No compact @context and no prefixes are used in emitted graph content.
- The dataset is always a JSON array (list), because the downstream loader
  expects to apply list-level operations (e.g., json.filter(...)).
- Every predicate value is an array, because the downstream renaming logic
  expects to iterate n[p].forEach(...).

Environment Variables
---------------------
- FLOWS_URL:
    Required. Used only to populate schema:url in each flow entry.
- NODERED_URDF:
    Optional but required for ZURL fetching and upload; if missing, upload is
    skipped. ZURL fetch occurs at import time and will raise if NODERED_URDF is
    unset or unreachable.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

# -----------------------------------------------------------------------------
# Filesystem configuration
# -----------------------------------------------------------------------------

INPUT_DIR = Path("input")
OUTPUT_DIR = Path("output")

# -----------------------------------------------------------------------------
# Runtime configuration (URDF endpoints)
# -----------------------------------------------------------------------------

NODERED_URDF = os.environ.get("NODERED_URDF", "").rstrip("/")

# -----------------------------------------------------------------------------
# Vocabulary IRIs
# -----------------------------------------------------------------------------

SCHEMA = "https://schema.org/"
LIBFLOW_CLASS = f"{SCHEMA}SoftwareSourceCode"

# -----------------------------------------------------------------------------
# ZURL support
# -----------------------------------------------------------------------------
#
# ZURL is a runtime-provided array of IRIs. If an IRI exists in that array, it
# can be replaced with a compact identifier "z:<index>" to reduce output size.
#
# The ZURL list is fetched from:
#   GET {NODERED_URDF}/urdf/zurl
# -----------------------------------------------------------------------------

def get_zurl(nodered_urdf: str, timeout: int = 30) -> List[str]:
    """
    Fetch a JSON array of IRIs from the URDF ZURL endpoint.

    Args:
        nodered_urdf:
            Base URL of the Node-RED runtime exposing /urdf endpoints.
        timeout:
            Socket timeout (seconds) for the HTTP request.

    Returns:
        A Python list of string IRIs.

    Raises:
        ValueError:
            When the base URL is missing or the response JSON is malformed.
        RuntimeError:
            When the HTTP request fails.
    """
    if not nodered_urdf:
        raise ValueError("Missing nodered_urdf base URL (e.g., http://host:1880).")

    base = nodered_urdf.rstrip("/")
    url = f"{base}/urdf/zurl"

    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json"},
        method="GET",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {url} failed (HTTP {e.code}): {err_body}") from e
    except Exception as e:
        raise RuntimeError(f"GET {url} failed: {e}") from e

    try:
        data: Any = json.loads(body)
    except Exception as e:
        raise ValueError(f"Invalid JSON returned by {url}: {e}\nBody: {body[:500]}") from e

    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise ValueError(
            f"{url} did not return a JSON array of strings. Got: {type(data).__name__}"
        )

    return data


def z(iri: str, zurl: List[str]) -> str:
    """
    Convert a full IRI to a compact "z:<index>" identifier if it exists in ZURL.

    Args:
        iri:
            Full IRI to compact.
        zurl:
            List of IRIs acting as the compaction dictionary.

    Returns:
        "z:<index>" if iri is present in zurl, otherwise the original iri.
    """
    try:
        idx = zurl.index(iri)
        return f"z:{idx}"
    except ValueError:
        return iri


# Fetch ZURL at import time so that downstream builder functions can use it.
ZURL = get_zurl(NODERED_URDF)

# -----------------------------------------------------------------------------
# Input loading helpers
# -----------------------------------------------------------------------------

def load_json(path: Path) -> Any:
    """
    Load and parse a UTF-8 JSON file.

    Args:
        path:
            Input file path.

    Returns:
        Parsed JSON value (dict/list/scalar).
    """
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def extract_nodes_list(doc: Any) -> List[Dict[str, Any]]:
    """
    Extract the Node-RED node list from common export shapes.

    Supported input shapes:
      - list: treated as the nodes list directly
      - dict: first list found under common keys (flows/nodes/data/items/content)

    Args:
        doc:
            Parsed JSON content.

    Returns:
        A list of node dictionaries.

    Raises:
        ValueError:
            If no node list can be located.
    """
    if isinstance(doc, list):
        return [n for n in doc if isinstance(n, dict)]

    if isinstance(doc, dict):
        for key in ("flows", "nodes", "data", "items", "content"):
            val = doc.get(key)
            if isinstance(val, list):
                return [n for n in val if isinstance(n, dict)]

    raise ValueError(
        "Unsupported input JSON structure: expected a list of Node-RED nodes or an object containing one."
    )

# -----------------------------------------------------------------------------
# JSON-LD builder
# -----------------------------------------------------------------------------

def build_jsonld(flows_url: str, graph_id: str, nodes_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convert a Node-RED export into a JSON-LD dataset describing each tab as a node.

    Flow identification rule:
      - A "flow" is a node with type == "tab".

    Grouping rule:
      - Nodes are assigned to a tab via their "z" property (tab id).
      - The tab node itself is excluded from keywords.

    Emitted properties:
      - schema:title: label/name/id fallback
      - schema:url: FLOWS_URL (external landing page for the library)
      - schema:identifier: tab id
      - schema:keywords: comma-separated unique node types in the tab

    Args:
        flows_url:
            URL string used only to set schema:url on each emitted flow record.
        graph_id:
            JSON-LD named graph identifier.
        nodes_list:
            Node-RED nodes list.

    Returns:
        A JSON-LD dataset (list) containing one graph object.
    """
    tabs = [n for n in nodes_list if n.get("type") == "tab" and isinstance(n.get("id"), str)]

    by_tab: Dict[str, List[Dict[str, Any]]] = {}
    for n in nodes_list:
        ztab = n.get("z")
        if isinstance(ztab, str) and ztab:
            by_tab.setdefault(ztab, []).append(n)

    libflows: List[Dict[str, Any]] = []
    for tab in tabs:
        flow_id = tab.get("id")
        if not isinstance(flow_id, str) or not flow_id:
            continue

        label = tab.get("label") or tab.get("name") or flow_id

        types: set[str] = set()
        for n in by_tab.get(flow_id, []):
            t = n.get("type")
            if isinstance(t, str) and t and t != "tab":
                types.add(t)

        libflows.append(
            {
                "@id": f"urn:libflow:{flow_id}",
                "@type": [z(LIBFLOW_CLASS, ZURL)],
                z(f"{SCHEMA}title", ZURL): [{"@value": str(label)}],
                z(f"{SCHEMA}url", ZURL): [{"@value": str(flows_url)}],
                z(f"{SCHEMA}identifier", ZURL): [{"@value": str(flow_id)}],
                z(f"{SCHEMA}keywords", ZURL): [{"@value": ",".join(sorted(types))}],
            }
        )

    return [
        {
            "@context": {},
            "@id": graph_id,
            "@graph": libflows,
        }
    ]

# -----------------------------------------------------------------------------
# Upload support
# -----------------------------------------------------------------------------

def post_jsonld(doc: Any, out_path: Path) -> None:
    """
    POST a generated JSON-LD dataset to the URDF /urdf/loadFile endpoint.

    The request payload format is:
      {"doc": <dataset>}

    Args:
        doc:
            The JSON-LD dataset (list containing one graph).
        out_path:
            Path of the file used for logging context.

    Behavior:
        - If NODERED_URDF is not set, upload is skipped.
        - HTTP errors are printed and re-raised.
    """
    if not NODERED_URDF:
        print("No 'NODERED_URDF' env var set; skipping upload.")
        return

    url = f"{NODERED_URDF}/urdf/loadFile"
    payload = {"doc": doc}
    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            print(f"Uploaded {out_path} -> {url} (HTTP {resp.status})")
            if body:
                print(body)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"Upload failed for {out_path} (HTTP {e.code}): {err_body}")
        raise
    except Exception as e:
        print(f"Upload failed for {out_path}: {e}")
        raise

# -----------------------------------------------------------------------------
# CLI entrypoint
# -----------------------------------------------------------------------------

def main() -> int:
    """
    Main program flow:
      - Validate required environment variables
      - Ensure input/output directories exist
      - For each input JSON file:
          * Parse and extract nodes
          * Build JSON-LD dataset (list with one graph)
          * Write to output/<basename>.jsonld
          * Optionally upload to URDF endpoint

    Returns:
        Process exit code (0 indicates success).
    """
    flows_url = os.environ.get("FLOWS_URL", "").strip()
    if not flows_url:
        raise SystemExit(
            "Missing environment variable FLOWS_URL (used only to set https://schema.org/url)."
        )

    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    input_files = sorted(p for p in INPUT_DIR.iterdir() if p.is_file() and p.suffix.lower() == ".json")
    if not input_files:
        raise SystemExit("No .json files found in ./input")

    for input_path in input_files:
        doc = load_json(input_path)
        nodes_list = extract_nodes_list(doc)

        graph_id = "urn:graph:flowslib"
        jsonld = build_jsonld(flows_url, graph_id, nodes_list)

        output_path = OUTPUT_DIR / f"{input_path.stem}.jsonld"
        with output_path.open("w", encoding="utf-8") as f:
            json.dump(jsonld, f, ensure_ascii=False, indent=2)

        post_jsonld(jsonld, output_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

