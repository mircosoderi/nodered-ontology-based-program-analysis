#!/usr/bin/env python3
"""
Discourse (Node-RED forum) latest.json -> JSON-LD exporter.

Input:
  ./input/*.json
Each input file is expected to be a Discourse JSON with topics at:
  topic_list/topics  (array)

Output:
  ./output/<same_basename>.jsonld
One named graph per input file. Graph @id is derived from the input filename.

Mapping per topic object:
- schema:DigitalDocument
  * schema:title <- title
  * schema:date  <- last_posted_at
  * schema:url   <- "https://discourse.nodered.org/t/" + slug + "/" + id
  * schema:category <- schema:DefinedTerm per tag (termset computed from all tags across file)
  * schema:contentRating <- schema:Rating (scaled from like_count across topics in that file)

Heuristic enrichment (title-only), aligned with GitHub importer, with one change:
- Node-RED version numbers are only accepted if the token containing the version is
  immediately preceded by one of: "nr", "nodered", "node-red" (case-insensitive).

Also:
- OS detection uses the same improved Windows rule (word-boundary).
- nrua:isContainerised is set on schema:DigitalDocument if title contains (case-insensitive):
  docker, container, containerised/containerized, dockerised/dockerized
- Node.js version: if "node.js" appears, version is extracted from the token immediately
  following it (digits and dots only), else not created.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
import os
import urllib.request
import urllib.error

INPUT_DIR = Path("input")
OUTPUT_DIR = Path("output")
NODERED_URDF = os.environ.get("NODERED_URDF", "").rstrip("/")  # e.g. http://host:1880

SCHEMA = "https://schema.org/"
XSD = "http://www.w3.org/2001/XMLSchema#"
NRUA = "https://w3id.org/nodered-static-program-analysis/user-application-ontology#"

BASE_FORUM_URL = "https://discourse.nodered.org"
TOPIC_URL_PREFIX = f"{BASE_FORUM_URL}/t/"

CONTAINER_TERMS = [
    "docker", "container", "containerised", "containerized", "dockerised", "dockerized"
]

# OS detection mapping (title keyword -> schema:name = os.platform taxonomy)
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

NODEJS_RE = re.compile(r"node\.js", re.I)

# Generic version token matcher (we will apply additional rules for Node-RED):
# captures things like v4.1.3, (v4.1.3), 4.1, 4.1.3
VERSION_TOKEN_RE = re.compile(r"^\(?v?(\d+\.\d+(?:\.\d+)*)\)?$")

# Tokenization: keep simple whitespace tokens; strip punctuation when checking some rules
TOKEN_SPLIT_RE = re.compile(r"\s+")

NODERED_PRECEDERS = {"nr", "nodered", "node-red"}

# -----------------------
# ZURL support (same as earlier script)
# -----------------------

def get_zurl(nodered_urdf: str, timeout: int = 30) -> List[str]:
    """
    Fetches the ZURL JSON array from the Node-RED runtime admin endpoint:
      GET {NODERED_URDF}/urdf/zurl

    Returns:
      A Python list of strings (IRIs). Raises on HTTP / JSON errors.

    Notes:
      - Assumes the endpoint returns a JSON array (e.g., ["iri1", "iri2", ...]).
      - If your Node-RED admin endpoint requires authentication, add headers
        (e.g. Authorization) in the Request below.
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
    try:
        idx = ZURL.index(iri)
        return f"z:{idx}"
    except ValueError:
        return iri


ZURL = get_zurl(NODERED_URDF)

# -----------------------
# End ZURL support
# -----------------------


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


# IMPORTANT: per your requirement, no @context, no prefixes/abbreviations, full IRIs only.
def build_defined_term_set(set_id: str, name: str) -> Dict[str, Any]:
    return {
        "@id": set_id,
        "@type": [z("https://schema.org/DefinedTermSet", ZURL)],
        z("https://schema.org/name", ZURL): [{"@value": name}],
    }


def build_defined_term(term_id: str, label: str, set_id: str) -> Dict[str, Any]:
    return {
        "@id": term_id,
        "@type": [z("https://schema.org/DefinedTerm", ZURL)],
        z("https://schema.org/name", ZURL): [{"@value": label}],
        z("https://schema.org/inDefinedTermSet", ZURL): [{"@id": set_id}],
    }


def build_rating(rating_id: str, value: int) -> Dict[str, Any]:
    return {
        "@id": rating_id,
        "@type": [z("https://schema.org/Rating", ZURL)],
        z("https://schema.org/worstRating", ZURL): [{"@value": -10}],
        z("https://schema.org/bestRating", ZURL): [{"@value": 10}],
        z("https://schema.org/ratingValue", ZURL): [{"@value": value}],
    }


def topic_url(slug: str, topic_id: Any) -> str:
    return f"{TOPIC_URL_PREFIX}{slug}/{topic_id}"


def title_has_container_hint(title: str) -> bool:
    t = title.lower()
    return any(term in t for term in CONTAINER_TERMS)


def detect_os_platform_from_title(title: str) -> Optional[str]:
    for pat, platform_name in OS_RULES:
        if pat.search(title):
            return platform_name
    return None


def extract_nodejs_version_from_title(title: str) -> Optional[str]:
    """
    If 'node.js' appears, take the token immediately following it,
    strip all non [0-9.] characters; validate; otherwise return None.
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


def tokenize(title: str) -> List[str]:
    return [t for t in TOKEN_SPLIT_RE.split(title.strip()) if t]


def normalize_token_for_preceder(tok: str) -> str:
    # lower + strip surrounding punctuation
    return re.sub(r"^[^\w-]+|[^\w-]+$", "", tok.lower())


def extract_nodered_versions_from_title(title: str) -> List[str]:
    """
    Node-RED version tokens are accepted only if the token containing the version
    is immediately preceded by one of: nr, nodered, node-red (case-insensitive).
    """
    toks = tokenize(title)
    out: List[str] = []
    for i in range(1, len(toks)):
        prev = normalize_token_for_preceder(toks[i - 1])
        cur_raw = toks[i]
        cur_norm = re.sub(r"[^\w\.\(\)v-]+", "", cur_raw, flags=re.I)  # mild cleanup
        if prev not in NODERED_PRECEDERS:
            continue

        cur_norm2 = re.sub(r"^[^\w(]+|[^\w)]+$", "", cur_norm)
        m = VERSION_TOKEN_RE.match(cur_norm2)
        if not m:
            continue
        ver = m.group(1)
        if ver and re.fullmatch(r"\d+\.\d+(?:\.\d+)*", ver):
            out.append(ver)

    return out


def rescale_likes_to_rating(like: int, min_like: int, max_like: int) -> int:
    if max_like == min_like:
        return 0
    scaled = -10 + (like - min_like) * 20.0 / (max_like - min_like)
    return clamp(int(round(scaled)), -10, 10)


def transform_file(path: Path) -> List[Dict[str, Any]]:
    base = path.stem
    slug = safe_slug(base)
    graph_id = urn("graph", slug)

    raw = json.loads(path.read_text(encoding="utf-8"))
    topics = (((raw or {}).get("topic_list") or {}).get("topics")) if isinstance(raw, dict) else None
    if not isinstance(topics, list):
        raise ValueError(f"Input JSON must have topic_list/topics array: {path}")

    # Collect all tags across all topics
    all_tags: Set[str] = set()
    like_counts: List[int] = []
    for t in topics:
        if not isinstance(t, dict):
            continue
        tags = t.get("tags") or []
        if isinstance(tags, list):
            for tag in tags:
                if isinstance(tag, str) and tag.strip():
                    all_tags.add(tag.strip())
        like_counts.append(int(t.get("like_count") or 0))

    min_like = min(like_counts) if like_counts else 0
    max_like = max(like_counts) if like_counts else 0

    tag_set_id = urn("termset", slug, "tags")
    tag_term_id: Dict[str, str] = {
        tag: urn("term", slug, "tag", safe_slug(tag)) for tag in sorted(all_tags)
    }

    nodes: List[Dict[str, Any]] = []
    # DefinedTermSet + terms
    nodes.append(build_defined_term_set(tag_set_id, "Node-RED Forum Tags"))
    for tag in sorted(all_tags):
        nodes.append(build_defined_term(tag_term_id[tag], tag, tag_set_id))

    # Create documents
    for t in topics:
        if not isinstance(t, dict):
            continue

        topic_id = t.get("id")
        slug_field = (t.get("slug") or "").strip()
        title = (t.get("title") or "").strip()
        last_posted_at = (t.get("last_posted_at") or "").strip()
        url = topic_url(slug_field, topic_id) if slug_field and topic_id is not None else ""

        local_key = str(topic_id) if topic_id is not None else safe_slug(title) or "unknown"

        # Categories from tags
        cats: List[str] = []
        tags = t.get("tags") or []
        if isinstance(tags, list):
            for tag in tags:
                if isinstance(tag, str) and tag.strip() and tag.strip() in tag_term_id:
                    cats.append(tag_term_id[tag.strip()])

        # Rating from like_count
        like = int(t.get("like_count") or 0)
        rating_value = rescale_likes_to_rating(like, min_like, max_like)
        rating_id = urn("rating", slug, local_key)
        nodes.append(build_rating(rating_id, rating_value))

        about_ids: List[str] = []

        # OS heuristic (title)
        os_platform = detect_os_platform_from_title(title)
        if os_platform:
            os_id = urn("os", slug, local_key, os_platform)
            nodes.append({
                "@id": os_id,
                "@type": [z("https://schema.org/OperatingSystem", ZURL)],
                z("https://schema.org/name", ZURL): [{"@value": os_platform}],
            })
            about_ids.append(os_id)

        # Node.js version heuristic (title)
        nodejs_ver = extract_nodejs_version_from_title(title)
        if nodejs_ver:
            nodejs_id = urn("runtime", slug, local_key, "nodejs", safe_slug(nodejs_ver))
            nodes.append({
                "@id": nodejs_id,
                "@type": [z("https://w3id.org/nodered-static-program-analysis/user-application-ontology#NodeJs", ZURL)],
                z("https://schema.org/version", ZURL): [{"@value": nodejs_ver}],
            })
            about_ids.append(nodejs_id)

        # Node-RED version heuristic (title)
        for ver in extract_nodered_versions_from_title(title):
            nodered_id = urn("runtime", slug, local_key, "nodered", safe_slug(ver))
            nodes.append({
                "@id": nodered_id,
                "@type": [z("https://w3id.org/nodered-static-program-analysis/user-application-ontology#NodeRed", ZURL)],
                z("https://schema.org/version", ZURL): [{"@value": ver}],
            })
            about_ids.append(nodered_id)

        # Container hint on the document
        is_containerised = title_has_container_hint(title)

        # DigitalDocument
        doc_id = url if url else urn("doc", slug, local_key)
        doc: Dict[str, Any] = {
            "@id": doc_id,
            "@type": [z("https://schema.org/DigitalDocument", ZURL)],
            z("https://schema.org/title", ZURL): [{"@value": title}],
            **({z("https://schema.org/date", ZURL): [{"@value": last_posted_at}]} if last_posted_at else {}),
            **({z("https://schema.org/url", ZURL): [{"@value": url}]} if url else {}),
            **({z("https://schema.org/category", ZURL): [{"@id": c} for c in cats]} if cats else {}),
            z("https://schema.org/contentRating", ZURL): [{"@id": rating_id}],
            **({z("https://w3id.org/nodered-static-program-analysis/user-application-ontology#isContainerised", ZURL): [{"@value": True}]} if is_containerised else {}),
            **({z("https://schema.org/about", ZURL): [{"@id": a} for a in about_ids]} if about_ids else {}),
        }
        nodes.append(doc)

    # IMPORTANT: return dataset array so server-side urdf.load can do json.filter(...)
    return [
        {
            "@context": {},  # intentionally empty: you requested no context/abbreviations
            "@id": graph_id,
            "@graph": nodes,
        }
    ]


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
        jsonld = transform_file(in_path)  # returns a LIST (dataset)
        out_path.write_text(json.dumps(jsonld, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {out_path}")
        post_jsonld(jsonld, out_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

