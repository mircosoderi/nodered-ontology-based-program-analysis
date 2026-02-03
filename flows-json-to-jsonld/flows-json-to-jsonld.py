#!/usr/bin/env python3
import os
import json
from pathlib import Path
import urllib.request
import urllib.error

INPUT_DIR = Path("input")
OUTPUT_DIR = Path("output")
NODERED_URDF = os.environ.get("NODERED_URDF", "").rstrip("/")

SCHEMA = "https://schema.org/"
LIBFLOW_CLASS = f"{SCHEMA}SoftwareSourceCode"


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def extract_nodes_list(doc):
    """
    Supports the most common Node-RED exports:
      - a list of nodes (typical export)
      - an object with a top-level list under common keys
    """
    if isinstance(doc, list):
        return doc

    if isinstance(doc, dict):
        for key in ("flows", "nodes", "data", "items", "content"):
            val = doc.get(key)
            if isinstance(val, list):
                return val

    raise ValueError(
        "Unsupported input JSON structure: expected a list of Node-RED nodes or an object containing one."
    )


def build_jsonld(flows_url: str, graph_id: str, nodes_list: list) -> list:
    # Identify flows: nodes with type == "tab"
    tabs = [n for n in nodes_list if isinstance(n, dict) and n.get("type") == "tab"]

    # Group nodes by tab id ("z")
    by_tab = {}
    for n in nodes_list:
        if not isinstance(n, dict):
            continue
        z = n.get("z")
        if isinstance(z, str) and z:
            by_tab.setdefault(z, []).append(n)

    libflows = []
    for tab in tabs:
        flow_id = tab.get("id")
        if not isinstance(flow_id, str) or not flow_id:
            continue

        # Label of the flow: prefer "label", fallback "name", fallback id
        label = tab.get("label") or tab.get("name") or flow_id

        # Collect unique node types in that flow (exclude the tab itself)
        types = set()
        for n in by_tab.get(flow_id, []):
            t = n.get("type")
            if isinstance(t, str) and t and t != "tab":
                types.add(t)

        libflows.append(
            {
                "@id": f"urn:libflow:{flow_id}",
                "@type": [LIBFLOW_CLASS],
                f"{SCHEMA}title": [{"@value": str(label)}],
                f"{SCHEMA}url": [{"@value": str(flows_url)}],
                f"{SCHEMA}identifier": [{"@value": str(flow_id)}],
                f"{SCHEMA}keywords": [{"@value": ",".join(sorted(types))}],
            }
        )

    # IMPORTANT:
    # - uRDF's store loader expects a DATASET (array) because it does json.filter(...)
    # - all predicate values must be ARRAYS because rename() does n[p].forEach(...)
    return [
        {
            "@context": {},  # you requested no context/abbreviations
            "@id": graph_id,
            "@graph": libflows,
        }
    ]


def post_jsonld(doc, out_path) -> None:
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


def main():
    flows_url = os.environ.get("FLOWS_URL", "").strip()
    if not flows_url:
        raise SystemExit(
            "Missing environment variable FLOWS_URL (used only to set https://schema.org/url)."
        )

    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    input_files = sorted(
        [p for p in INPUT_DIR.iterdir() if p.is_file() and p.suffix.lower() == ".json"]
    )

    if not input_files:
        raise SystemExit("No .json files found in ./input")

    for input_path in input_files:
        doc = load_json(input_path)
        nodes_list = extract_nodes_list(doc)

        # graph name: urn:graph:<input filename without extension>
        graph_id = "urn:graph:flowslib"

        jsonld = build_jsonld(flows_url, graph_id, nodes_list)

        output_path = OUTPUT_DIR / f"{input_path.stem}.jsonld"
        with output_path.open("w", encoding="utf-8") as f:
            json.dump(jsonld, f, ensure_ascii=False, indent=2)

        post_jsonld(jsonld, output_path)


if __name__ == "__main__":
    main()

