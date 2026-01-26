#!/usr/bin/env python3
"""
GitHub Issues/PRs (REST /issues) JSON -> JSON-LD (schema:DigitalDocument) exporter.

Layout:
- input files:  ./input/*.json
- output files: ./output/<same_basename>.jsonld
- script:        ./generate_jsonld.py  (run from repo/container root)

Per input file:
- Produces a JSON-LD document with a named graph whose @id depends on the input filename.
- Creates:
  * One schema:DigitalDocument per item in the JSON array
  * A schema:DefinedTermSet for Node-RED labels (with the full known label list)
  * One schema:DefinedTerm per label (and uses them in schema:category)
  * One schema:Rating per document (schema:contentRating)
  * Optional schema:OperatingSystem instance linked via schema:about (title keyword matching)
  * Optional nrua:NodeJs instance linked via schema:about (title contains "node.js" + version)
  * Optional nrua:NodeRed instance(s) linked via schema:about (version tokens in title, excluding Node.js versions)
  * Optional nrua:isContainerised boolean on the document (title keyword matching)
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import os
import urllib.request
import urllib.error

INPUT_DIR = Path("input")
OUTPUT_DIR = Path("output")
NODERED_URDF = os.environ.get("NODERED_URDF", "").rstrip("/")

SCHEMA = "https://schema.org/"
XSD = "http://www.w3.org/2001/XMLSchema#"
NRUA = "https://w3id.org/nodered-static-program-analysis/user-application-ontology#"

KNOWN_LABELS = [
    "backport-2.x", "bug", "build", "chore", "dependencies", "docs", "duplicate",
    "editor", "enhancement", "epic", "feature", "fixed", "good first issue",
    "hacktoberfest-accepted", "needs-info", "needs-test-case", "needs-triage",
    "node", "packaging", "project-modernization", "question", "ready-to-review",
    "runtime", "task", "testing", "upstream", "wontfix",
]

CONTAINER_TERMS = [
    "docker", "container", "containerised", "containerized", "dockerised", "dockerized"
]

# OS detection mapping (title keyword -> schema:name = os.platform taxonomy)
# Order matters (e.g., "macos" should map to darwin)
OS_RULES: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"linux", re.I), "linux"),
    (re.compile(r"darwin|macos|ios", re.I), "darwin"),
    (re.compile(r"Windows"), "win32"),
    (re.compile(r"\b(win32|win64|windows|win)\b", re.I), "win32"),
    (re.compile(r"freebsd", re.I), "freebsd"),
    (re.compile(r"openbsd", re.I), "openbsd"),
    (re.compile(r"sunos", re.I), "sunos"),
    (re.compile(r"aix", re.I), "aix"),
    (re.compile(r"android", re.I), "android"),
]

# Version token: starts with number-dot, optionally preceded by v, optionally wrapped in parentheses.
# We will extract digits+dots and validate.
VERSION_TOKEN_RE = re.compile(r"(\(?\s*v?\s*(\d+\.\d+(?:\.\d+)*)\s*\)?)")

NODEJS_RE = re.compile(r"node\.js", re.I)


def safe_slug(name: str) -> str:
    s = name.strip()
    s = re.sub(r"\.[^.]+$", "", s)
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-").lower()
    return s or "graph"


def urn(*parts: str) -> str:
    joined = ":".join(p.strip(":") for p in parts if p)
    return f"urn:{joined}"


def clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def jsonld_context() -> Dict[str, Any]:
    return {
        "schema": SCHEMA,
        "nrua": NRUA,
        "xsd": XSD,
        "title": "schema:title",
        "date": {"@id": "schema:date", "@type": "xsd:dateTime"},
        "url": {"@id": "schema:url", "@type": "@id"},
        "about": {"@id": "schema:about", "@type": "@id"},
        "category": {"@id": "schema:category", "@type": "@id"},
        "contentRating": {"@id": "schema:contentRating", "@type": "@id"},
        "ratingValue": "schema:ratingValue",
        "bestRating": "schema:bestRating",
        "worstRating": "schema:worstRating",
        "name": "schema:name",
        "version": "schema:version",
        "softwareVersion": "schema:softwareVersion",
        "isContainerised": "nrua:isContainerised",
        "inDefinedTermSet": {"@id": "schema:inDefinedTermSet", "@type": "@id"},
    }


def build_defined_term_set(set_id: str, name: str) -> Dict[str, Any]:
    return {"@id": set_id, "@type": "schema:DefinedTermSet", "schema:name": name}


def build_defined_term(term_id: str, label: str, set_id: str) -> Dict[str, Any]:
    return {
        "@id": term_id,
        "@type": "schema:DefinedTerm",
        "schema:name": label,
        "schema:inDefinedTermSet": {"@id": set_id},
    }


def build_rating(rating_id: str, value: int) -> Dict[str, Any]:
    return {
        "@id": rating_id,
        "@type": "schema:Rating",
        "schema:worstRating": -10,
        "schema:bestRating": 10,
        "schema:ratingValue": value,
    }


def extract_label_names(item: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    labels = item.get("labels") or []
    for lab in labels:
        if isinstance(lab, dict):
            name = lab.get("name")
            if name:
                out.append(str(name))
        elif isinstance(lab, str):
            out.append(lab)
    return out


def detect_os_platform_from_title(title: str) -> Optional[str]:
    for pat, platform_name in OS_RULES:
        if pat.search(title):
            return platform_name
    return None


def title_has_container_hint(title: str) -> bool:
    t = title.lower()
    return any(term in t for term in CONTAINER_TERMS)


def extract_nodejs_version_from_title(title: str) -> Optional[str]:
    """
    If 'node.js' appears, take the term immediately following it,
    strip all non [0-9.] characters; if empty or invalid, return None.
    """
    m = NODEJS_RE.search(title)
    if not m:
        return None

    after = title[m.end():].lstrip()
    if not after:
        return None

    # "term that follows node.js" -> take next whitespace-delimited token
    token = after.split()[0] if after.split() else ""
    # keep digits and dots only
    cleaned = re.sub(r"[^0-9.]+", "", token)
    if not cleaned:
        return None
    # validate: digits(.digits)+
    if not re.fullmatch(r"\d+(?:\.\d+)*", cleaned):
        return None
    return cleaned


def extract_nodered_versions_from_title(title: str, nodejs_span: Optional[Tuple[int, int]] = None) -> List[str]:
    """
    Find version tokens in title. Exclude tokens that belong to Node.js version
    (i.e., the version token immediately following 'node.js').
    Return list of cleaned version strings.
    """
    versions: List[str] = []

    # Identify node.js immediate version token span to exclude (best-effort).
    exclude_spans: List[Tuple[int, int]] = []
    if nodejs_span:
        exclude_spans.append(nodejs_span)

    for match in VERSION_TOKEN_RE.finditer(title):
        full_span = match.span(1)
        ver = match.group(2)
        if not ver:
            continue
        # Exclude if overlaps with nodejs span
        if any(not (full_span[1] <= ex[0] or full_span[0] >= ex[1]) for ex in exclude_spans):
            continue
        cleaned = re.sub(r"[^0-9.]+", "", ver)
        if cleaned and re.fullmatch(r"\d+\.\d+(?:\.\d+)*", cleaned):
            versions.append(cleaned)

    return versions


def nodejs_version_span(title: str) -> Optional[Tuple[int, int]]:
    """
    Returns the character span (start, end) of the Node.js version token immediately after 'node.js',
    so we can exclude it from Node-RED version extraction.
    """
    m = NODEJS_RE.search(title)
    if not m:
        return None
    after = title[m.end():]
    # find next token with indices
    ws = re.match(r"\s*", after)
    offset = ws.end() if ws else 0
    rest = after[offset:]
    if not rest:
        return None
    token_m = re.match(r"\S+", rest)
    if not token_m:
        return None
    token = token_m.group(0)
    cleaned = re.sub(r"[^0-9.]+", "", token)
    if not cleaned or not re.fullmatch(r"\d+(?:\.\d+)*", cleaned):
        return None
    # compute span in original title
    start = m.end() + offset
    end = start + len(token)
    return (start, end)


def transform_file(path: Path) -> Dict[str, Any]:
    base = path.stem
    slug = safe_slug(base)
    graph_id = urn("graph", slug)

    label_set_id = urn("termset", slug, "labels")
    label_term_id = {lab: urn("term", slug, "label", safe_slug(lab)) for lab in KNOWN_LABELS}

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"Input must be a JSON array: {path}")

    nodes: List[Dict[str, Any]] = []

    # DefinedTermSet + all known label terms
    nodes.append(build_defined_term_set(label_set_id, "Node-RED GitHub Labels"))
    for lab in KNOWN_LABELS:
        nodes.append(build_defined_term(label_term_id[lab], lab, label_set_id))

    # Transform each issue/PR
    for item in raw:
        if not isinstance(item, dict):
            continue

        title = (item.get("title") or "").strip()
        updated_at = (item.get("updated_at") or "").strip()
        html_url = (item.get("html_url") or "").strip()  # requested: prefer html_url

        # Categories from labels (only those present in KNOWN_LABELS; ignore unknown)
        cats: List[str] = []
        for lab in extract_label_names(item):
            if lab in label_term_id:
                cats.append(label_term_id[lab])

        # Rating
        reactions = item.get("reactions") or {}
        plus = int(reactions.get("+1") or 0)
        minus = int(reactions.get("-1") or 0)
        rating_value = clamp(plus - minus, -10, 10)

        # Stable-ish id components
        number = item.get("number")
        local_key = str(number) if number is not None else str(item.get("id") or "unknown")

        rating_id = urn("rating", slug, local_key)
        nodes.append(build_rating(rating_id, rating_value))

        about_ids: List[str] = []

        # OS detection from title
        os_platform = detect_os_platform_from_title(title)
        if os_platform:
            os_id = urn("os", slug, local_key, os_platform)
            nodes.append({
                "@id": os_id,
                "@type": "schema:OperatingSystem",
                "schema:name": os_platform,
            })
            about_ids.append(os_id)

        # Node.js mention + version extraction from title
        nj_span = nodejs_version_span(title)
        nodejs_ver = extract_nodejs_version_from_title(title)
        if nodejs_ver:
            nodejs_id = urn("runtime", slug, local_key, "nodejs", safe_slug(nodejs_ver))
            nodes.append({
                "@id": nodejs_id,
                "@type": "nrua:NodeJs",
                "schema:version": nodejs_ver,
            })
            about_ids.append(nodejs_id)

        # Node-RED version(s) in title (excluding Node.js version token)
        nodered_versions = extract_nodered_versions_from_title(title, nodejs_span=nj_span)
        for v in nodered_versions:
            nodered_id = urn("runtime", slug, local_key, "nodered", safe_slug(v))
            nodes.append({
                "@id": nodered_id,
                "@type": "nrua:NodeRed",
                "schema:version": v,
            })
            about_ids.append(nodered_id)

        # Containerisation hint on the document itself
        is_containerised = title_has_container_hint(title)

        # DigitalDocument
        # Use html_url as the @id when present (it is a proper IRI).
        doc_id = html_url if html_url else urn("doc", slug, local_key)

        doc: Dict[str, Any] = {
            "@id": doc_id,
            "@type": "schema:DigitalDocument",
            "schema:title": title,
            "schema:date": updated_at if updated_at else None,
            "schema:url": html_url if html_url else None,
            "schema:category": [{"@id": c} for c in cats] if cats else None,
            "schema:contentRating": {"@id": rating_id},
            "nrua:isContainerised": True if is_containerised else None,
            "schema:about": [{"@id": a} for a in about_ids] if about_ids else None,
        }

        # remove nulls
        doc = {k: v for k, v in doc.items() if v is not None}
        nodes.append(doc)

    return {
        "@context": jsonld_context(),
        "@id": graph_id,
        "@graph": nodes,
    }

def post_jsonld(doc: dict, out_path) -> None:
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
            # optional: show server response
            if body:
                print(body)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"Upload failed for {out_path} (HTTP {e.code}): {err_body}")
        raise
    except Exception as e:
        print(f"Upload failed for {out_path}: {e}")
        raise

def main() -> int:
    if not INPUT_DIR.exists():
        raise SystemExit(f"Missing input directory: {INPUT_DIR.resolve()}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    inputs = sorted(INPUT_DIR.glob("*.json"))
    if not inputs:
        print(f"No .json files found in {INPUT_DIR.resolve()}")
        return 0

    for in_path in inputs:
        out_path = OUTPUT_DIR / f"{in_path.stem}.jsonld"
        jsonld = transform_file(in_path)
        out_path.write_text(json.dumps(jsonld, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {out_path}")
        post_jsonld(jsonld, out_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

