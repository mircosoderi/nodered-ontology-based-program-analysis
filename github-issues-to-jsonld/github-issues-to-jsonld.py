#!/usr/bin/env python3
"""
GitHub Issues/PRs JSON -> JSON-LD exporter.

Purpose
-------
Transforms one or more GitHub REST API /issues JSON exports into JSON-LD datasets
describing schema:DigitalDocument items, enriched with lightweight heuristics.

I/O Layout
----------
Input:
  ./input/*.json
Each input file is expected to contain a JSON array of Issue/PR objects
(as returned by GitHub REST API list endpoints).

Output:
  ./output/<same_basename>.jsonld
Exactly one JSON-LD dataset is produced per input file. Each dataset contains:
  - One named graph (@id derived from the input filename)
  - A collection of nodes describing:
      * A DefinedTermSet for Node-RED labels (full known label list)
      * DefinedTerm nodes for each known label
      * A Rating node per issue/PR (derived from reactions)
      * A DigitalDocument node per issue/PR, enriched with heuristics
      * Optional about nodes for inferred OS/runtime entities

Issue/PR-to-JSON-LD Mapping (per item)
--------------------------------------
- schema:DigitalDocument
  * schema:title <- title
  * schema:date  <- updated_at
  * schema:url   <- html_url (preferred)
  * schema:category <- schema:DefinedTerm per label (filtered to KNOWN_LABELS)
  * schema:contentRating <- schema:Rating (clamped from reactions +1/-1)
  * schema:about <- inferred OS/Node.js/Node-RED runtime nodes (when present)
  * nrua:isContainerised <- boolean (title keyword matching)

Heuristic Enrichment (title-only)
---------------------------------
- OS detection uses ordered patterns and returns a Node.js-like os.platform label.
- Containerisation detection triggers on docker/container-related substrings.
- Node.js version: if "node.js" appears, the immediately following token is
  parsed as a digits-and-dots version.
- Node-RED versions: any version-like tokens are extracted from title, excluding
  the Node.js token immediately after "node.js" (to avoid double counting).

JSON-LD Style
-------------
- No compact context and no prefixes are used in the output graph content.
- A ZURL indirection feature may shorten IRIs to "z:<index>" identifiers,
  when those IRIs are present in a runtime-provided ZURL list.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# -----------------------------------------------------------------------------
# Filesystem configuration
# -----------------------------------------------------------------------------

INPUT_DIR = Path("input")
OUTPUT_DIR = Path("output")

# Base URL for a Node-RED runtime exposing URDF endpoints (required for ZURL+upload).
NODERED_URDF = os.environ.get("NODERED_URDF", "").rstrip("/")

# -----------------------------------------------------------------------------
# Vocabulary IRIs
# -----------------------------------------------------------------------------

SCHEMA = "https://schema.org/"
XSD = "http://www.w3.org/2001/XMLSchema#"
NRUA = "https://w3id.org/nodered-static-program-analysis/user-application-ontology#"

# -----------------------------------------------------------------------------
# GitHub label vocabulary (stable list)
# -----------------------------------------------------------------------------

KNOWN_LABELS = [
    "backport-2.x",
    "bug",
    "build",
    "chore",
    "dependencies",
    "docs",
    "duplicate",
    "editor",
    "enhancement",
    "epic",
    "feature",
    "fixed",
    "good first issue",
    "hacktoberfest-accepted",
    "needs-info",
    "needs-test-case",
    "needs-triage",
    "node",
    "packaging",
    "project-modernization",
    "question",
    "ready-to-review",
    "runtime",
    "task",
    "testing",
    "upstream",
    "wontfix",
]

# -----------------------------------------------------------------------------
# Title heuristics configuration: container detection
# -----------------------------------------------------------------------------

CONTAINER_TERMS = [
    "docker",
    "container",
    "containerised",
    "containerized",
    "dockerised",
    "dockerized",
]

# -----------------------------------------------------------------------------
# Title heuristics configuration: OS detection
# -----------------------------------------------------------------------------

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

# -----------------------------------------------------------------------------
# Title heuristics configuration: version token parsing
# -----------------------------------------------------------------------------

VERSION_TOKEN_RE = re.compile(r"(\(?\s*v?\s*(\d+\.\d+(?:\.\d+)*)\s*\)?)")
NODEJS_RE = re.compile(r"node\.js", re.I)

# -----------------------------------------------------------------------------
# ZURL support
# -----------------------------------------------------------------------------
#
# ZURL is a runtime-provided array of IRIs. If an IRI exists in that array, it
# can be replaced with a compact identifier "z:<index>" to reduce output size.
#
# The ZURL list is fetched from:
#   GET {NODERED_URDF}/urdf/zurl
#
# This script fetches ZURL at import time so all builder functions can compact
# IRIs consistently.
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


def z(iri: str, ZURL: list[str]) -> str:
    """
    Convert a full IRI to a compact "z:<index>" identifier if it exists in ZURL.
    """
    try:
        idx = ZURL.index(iri)
        return f"z:{idx}"
    except ValueError:
        return iri


ZURL = get_zurl(NODERED_URDF)

# -----------------------------------------------------------------------------
# Utility functions
# -----------------------------------------------------------------------------

def safe_slug(name: str) -> str:
    """
    Convert an arbitrary string into a lowercase slug usable in URNs.
    """
    s = name.strip()
    s = re.sub(r"\.[^.]+$", "", s)
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-").lower()
    return s or "graph"


def urn(*parts: str) -> str:
    """
    Build a URN by joining parts with ":".
    """
    joined = ":".join(p.strip(":") for p in parts if p)
    return f"urn:{joined}"


def clamp(v: int, lo: int, hi: int) -> int:
    """
    Clamp an integer v to the inclusive range [lo, hi].
    """
    return max(lo, min(hi, v))

# -----------------------------------------------------------------------------
# JSON-LD node builders (full IRIs; optionally Z-compacted)
# -----------------------------------------------------------------------------

def build_defined_term_set(set_id: str, name: str) -> Dict[str, Any]:
    """
    Build a schema:DefinedTermSet node.
    """
    return {
        "@id": set_id,
        "@type": [z("https://schema.org/DefinedTermSet", ZURL)],
        z("https://schema.org/name", ZURL): [{"@value": name}],
    }


def build_defined_term(term_id: str, label: str, set_id: str) -> Dict[str, Any]:
    """
    Build a schema:DefinedTerm node belonging to a schema:DefinedTermSet.
    """
    return {
        "@id": term_id,
        "@type": [z("https://schema.org/DefinedTerm", ZURL)],
        z("https://schema.org/name", ZURL): [{"@value": label}],
        z("https://schema.org/inDefinedTermSet", ZURL): [{"@id": set_id}],
    }


def build_rating(rating_id: str, value: int) -> Dict[str, Any]:
    """
    Build a schema:Rating node with a fixed [-10, 10] scale.
    """
    return {
        "@id": rating_id,
        "@type": [z("https://schema.org/Rating", ZURL)],
        z("https://schema.org/worstRating", ZURL): [{"@value": -10}],
        z("https://schema.org/bestRating", ZURL): [{"@value": 10}],
        z("https://schema.org/ratingValue", ZURL): [{"@value": value}],
    }

# -----------------------------------------------------------------------------
# Input helpers and title heuristics
# -----------------------------------------------------------------------------

def extract_label_names(item: Dict[str, Any]) -> List[str]:
    """
    Extract label names from a GitHub issue/PR object.

    Supports the common GitHub formats:
      - labels: [{name: "..."} ...]
      - labels: ["...", "..."]
    """
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
    """
    Apply OS_RULES in order and return the first matched platform name.
    """
    for pat, platform_name in OS_RULES:
        if pat.search(title):
            return platform_name
    return None


def title_has_container_hint(title: str) -> bool:
    """
    Detect whether the title includes any containerisation hint substrings.
    """
    t = title.lower()
    return any(term in t for term in CONTAINER_TERMS)


def extract_nodejs_version_from_title(title: str) -> Optional[str]:
    """
    Extract a Node.js version number from a title.

    Rule:
      - If "node.js" occurs, take the immediately following whitespace token.
      - Strip all characters except digits and dots.
      - Validate the resulting string as a dot-separated numeric version.
    """
    m = NODEJS_RE.search(title)
    if not m:
        return None

    after = title[m.end():].lstrip()
    if not after:
        return None

    token = after.split()[0] if after.split() else ""
    cleaned = re.sub(r"[^0-9.]+", "", token)
    if not cleaned:
        return None

    if not re.fullmatch(r"\d+(?:\.\d+)*", cleaned):
        return None

    return cleaned


def nodejs_version_span(title: str) -> Optional[Tuple[int, int]]:
    """
    Return the (start, end) character span of the Node.js version token that
    immediately follows "node.js", if it exists and validates.
    """
    m = NODEJS_RE.search(title)
    if not m:
        return None

    after = title[m.end():]
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

    start = m.end() + offset
    end = start + len(token)
    return (start, end)


def extract_nodered_versions_from_title(
    title: str,
    nodejs_span: Optional[Tuple[int, int]] = None,
) -> List[str]:
    """
    Extract version-like tokens from a title, excluding the Node.js version token
    immediately after "node.js" (when its span is provided).

    This is intentionally permissive: any token matching digits+dots (at least
    "X.Y") is accepted, except those overlapping the excluded span.
    """
    versions: List[str] = []
    exclude_spans: List[Tuple[int, int]] = []
    if nodejs_span:
        exclude_spans.append(nodejs_span)

    for match in VERSION_TOKEN_RE.finditer(title):
        full_span = match.span(1)
        ver = match.group(2)
        if not ver:
            continue

        overlaps_excluded = any(
            not (full_span[1] <= ex[0] or full_span[0] >= ex[1]) for ex in exclude_spans
        )
        if overlaps_excluded:
            continue

        cleaned = re.sub(r"[^0-9.]+", "", ver)
        if cleaned and re.fullmatch(r"\d+\.\d+(?:\.\d+)*", cleaned):
            versions.append(cleaned)

    return versions

# -----------------------------------------------------------------------------
# Core transformation
# -----------------------------------------------------------------------------

def transform_file(path: Path) -> List[Dict[str, Any]]:
    """
    Transform one GitHub issues/PR JSON file into a JSON-LD dataset (list with one graph).

    Dataset structure:
      [
        {
          "@context": {},   # intentionally empty
          "@id": "<graph_urn>",
          "@graph": [ ...nodes... ]
        }
      ]

    The @graph will include:
      - One DefinedTermSet for known labels
      - One DefinedTerm per known label
      - One Rating node per issue/PR (reactions-based)
      - One DigitalDocument node per issue/PR, referencing:
          * categories (DefinedTerms)
          * contentRating (Rating)
          * optional about nodes (OS, Node.js, Node-RED versions)
          * optional isContainerised boolean
    """
    base = path.stem
    slug = safe_slug(base)
    graph_id = urn("graph", slug)

    label_set_id = urn("termset", slug, "labels")
    label_term_id = {lab: urn("term", slug, "label", safe_slug(lab)) for lab in KNOWN_LABELS}

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"Input must be a JSON array: {path}")

    nodes: List[Dict[str, Any]] = []

    nodes.append(build_defined_term_set(label_set_id, "Node-RED GitHub Labels"))
    for lab in KNOWN_LABELS:
        nodes.append(build_defined_term(label_term_id[lab], lab, label_set_id))

    for item in raw:
        if not isinstance(item, dict):
            continue

        title = (item.get("title") or "").strip()
        updated_at = (item.get("updated_at") or "").strip()
        html_url = (item.get("html_url") or "").strip()

        cats: List[str] = []
        for lab in extract_label_names(item):
            if lab in label_term_id:
                cats.append(label_term_id[lab])

        reactions = item.get("reactions") or {}
        plus = int(reactions.get("+1") or 0)
        minus = int(reactions.get("-1") or 0)
        rating_value = clamp(plus - minus, -10, 10)

        number = item.get("number")
        local_key = str(number) if number is not None else str(item.get("id") or "unknown")

        rating_id = urn("rating", slug, local_key)
        nodes.append(build_rating(rating_id, rating_value))

        about_ids: List[str] = []

        os_platform = detect_os_platform_from_title(title)
        if os_platform:
            os_id = urn("os", slug, local_key, os_platform)
            nodes.append(
                {
                    "@id": os_id,
                    "@type": [z("https://schema.org/OperatingSystem", ZURL)],
                    z("https://schema.org/name", ZURL): [{"@value": os_platform}],
                }
            )
            about_ids.append(os_id)

        nj_span = nodejs_version_span(title)
        nodejs_ver = extract_nodejs_version_from_title(title)
        if nodejs_ver:
            nodejs_id = urn("runtime", slug, local_key, "nodejs", safe_slug(nodejs_ver))
            nodes.append(
                {
                    "@id": nodejs_id,
                    "@type": [
                        z(
                            "https://w3id.org/nodered-static-program-analysis/user-application-ontology#NodeJs",
                            ZURL,
                        )
                    ],
                    z("https://schema.org/version", ZURL): [{"@value": nodejs_ver}],
                }
            )
            about_ids.append(nodejs_id)

        for v in extract_nodered_versions_from_title(title, nodejs_span=nj_span):
            nodered_id = urn("runtime", slug, local_key, "nodered", safe_slug(v))
            nodes.append(
                {
                    "@iD": nodered_id,  # NOTE: preserve "@id" casing in JSON-LD consumers if needed
                    "@id": nodered_id,
                    "@type": [
                        z(
                            "https://w3id.org/nodered-static-program-analysis/user-application-ontology#NodeRed",
                            ZURL,
                        )
                    ],
                    z("https://schema.org/version", ZURL): [{"@value": v}],
                }
            )
            about_ids.append(nodered_id)

        is_containerised = title_has_container_hint(title)

        doc_id = html_url if html_url else urn("doc", slug, local_key)
        doc: Dict[str, Any] = {
            "@id": doc_id,
            "@type": [z("https://schema.org/DigitalDocument", ZURL)],
            z("https://schema.org/title", ZURL): [{"@value": title}],
            **({z("https://schema.org/date", ZURL): [{"@value": updated_at}]} if updated_at else {}),
            **({z("https://schema.org/url", ZURL): [{"@value": html_url}]} if html_url else {}),
            **({z("https://schema.org/category", ZURL): [{"@id": c} for c in cats]} if cats else {}),
            z("https://schema.org/contentRating", ZURL): [{"@id": rating_id}],
            **(
                {
                    z(
                        "https://w3id.org/nodered-static-program-analysis/user-application-ontology#isContainerised",
                        ZURL,
                    ): [{"@value": True}]
                }
                if is_containerised
                else {}
            ),
            **({z("https://schema.org/about", ZURL): [{"@id": a} for a in about_ids]} if about_ids else {}),
        }

        nodes.append(doc)

    return [
        {
            "@context": {},
            "@id": graph_id,
            "@graph": nodes,
        }
    ]

# -----------------------------------------------------------------------------
# Upload support
# -----------------------------------------------------------------------------

def post_jsonld(doc: dict, out_path) -> None:
    """
    POST a generated JSON-LD dataset to the URDF /urdf/loadFile endpoint.

    Behavior:
      - If NODERED_URDF is not set, upload is skipped.
      - If a dataset list is provided, the first graph object is uploaded
        (to match endpoints expecting a single JSON-LD object with "@id").
    """
    if not NODERED_URDF:
        print("No 'NODERED_URDF' env var set; skipping upload.")
        return

    url = f"{NODERED_URDF}/urdf/loadFile"

    doc_to_upload = doc
    if isinstance(doc, list):
        if not doc:
            raise ValueError("JSON-LD dataset is empty; cannot upload.")
        doc_to_upload = doc[0]

    payload = {"doc": doc_to_upload}
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
      - Validate input directory
      - Create output directory if missing
      - For each input JSON file:
          * Transform to JSON-LD dataset (list)
          * Write to output/<basename>.jsonld
          * Optionally upload to URDF endpoint

    Returns:
        Process exit code (0 indicates success).
    """
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

