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

# -----------------------
# ZURL support (same approach as earlier scripts)
# -----------------------

def get_zurl(nodered_urdf: str, timeout: int = 30) -> list[str]:
    """
    Fetches the ZURL JSON array from the Node-RED runtime admin endpoint:
      GET {NODERED_URDF}/urdf/zurl

    Returns:
      A Python list of strings (IRIs). Raises on HTTP / JSON errors.
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
        data = json.loads(body)
    except Exception as e:
        raise ValueError(f"Invalid JSON returned by {url}: {e}\nBody: {body[:500]}") from e

    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise ValueError(
            f"{url} did not return a JSON array of strings. Got: {type(data).__name__}"
        )

    return data


def z(iri: str, ZURL: list[str]) -> str:
    try:
        idx = ZURL.index(iri)
        return f"z:{idx}"
    except ValueError:
        return iri


ZURL = get_zurl(NODERED_URDF)

# -----------------------
# End ZURL support
# -----------------------


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
        ztab = n.get("z")
        if isinstance(ztab, str) and ztab:
            by_tab.setdefault(ztab, []).append(n)

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
                "@id": f"urn:libflow:{flow_id}",  # resource IRI untouched
                "@type": [z(LIBFLOW_CLASS, ZURL)],  # type IRI wrapped
                z(f"{SCHEMA}title", ZURL): [{"@value": str(label)}],  # predicate IRI wrapped
                z(f"{SCHEMA}url", ZURL): [{"@value": str(flows_url)}],
                z(f"{SCHEMA}identifier", ZURL): [{"@value": str(flow_id)}],
                z(f"{SCHEMA}keywords", ZURL): [{"@value": ",".join(sorted(types))}],
            }
        )

    # IMPORTANT:
    # - uRDF's store loader expects a DATASET (array) because it does json.filter(...)
    # - all predicate values must be ARRAYS because rename() does n[p].forEach(...)
    return [
        {
            "@context": {},  # you requested no context/abbreviations
            "@id": graph_id,  # resource IRI untouched
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

