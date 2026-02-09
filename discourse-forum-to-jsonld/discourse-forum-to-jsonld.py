#!/usr/bin/env python3
"""
Discourse (Node-RED forum) latest.json -> JSON-LD exporter.

Purpose
-------
Transforms one or more Discourse JSON exports (with a topic list) into JSON-LD
datasets suitable for loading into a URDF/JSON-LD ingestion endpoint.

I/O Layout
----------
Input:
  ./input/*.json
Each input file is expected to contain a JSON object with topics at:
  topic_list/topics  (array of topic objects)

Output:
  ./output/<same_basename>.jsonld
Exactly one JSON-LD dataset is produced per input file. Each dataset contains:
  - One named graph (@id derived from the input filename)
  - A collection of nodes describing:
      * A DefinedTermSet for tags
      * DefinedTerm nodes for each tag
      * A Rating node per topic (scaled from like_count within the file)
      * A DigitalDocument node per topic, enriched with heuristics

Topic-to-JSON-LD Mapping (per topic object)
-------------------------------------------
- schema:DigitalDocument
  * schema:title <- title
  * schema:date  <- last_posted_at
  * schema:url   <- "https://discourse.nodered.org/t/" + slug + "/" + id
  * schema:category <- schema:DefinedTerm per tag (termset computed across file)
  * schema:contentRating <- schema:Rating (scaled from like_count across file)

Heuristic Enrichment (title-only)
---------------------------------
- Node-RED version numbers are accepted only when the version token is
  immediately preceded by: "nr", "nodered", or "node-red" (case-insensitive).
- OS detection uses a Windows word-boundary rule to reduce false positives.
- nrua:isContainerised is set on schema:DigitalDocument when title contains:
  docker, container, containerised/containerized, dockerised/dockerized
- Node.js version: if "node.js" appears, the immediately following token is
  parsed as a digits-and-dots version; otherwise no Node.js version node is created.

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
from typing import Any, Dict, List, Optional, Set, Tuple

# -----------------------------------------------------------------------------
# Filesystem configuration
# -----------------------------------------------------------------------------

# Directory containing Discourse JSON exports to transform.
INPUT_DIR = Path("input")

# Directory to store generated JSON-LD datasets.
OUTPUT_DIR = Path("output")

# Base URL for a Node-RED runtime exposing URDF endpoints (optional).
# When set, generated datasets are also uploaded to {NODERED_URDF}/urdf/loadFile.
NODERED_URDF = os.environ.get("NODERED_URDF", "").rstrip("/")  # e.g. http://host:1880

# -----------------------------------------------------------------------------
# Vocabulary IRIs
# -----------------------------------------------------------------------------

# Canonical IRIs kept for readability and potential future extension.
SCHEMA = "https://schema.org/"
XSD = "http://www.w3.org/2001/XMLSchema#"
NRUA = "https://w3id.org/nodered-static-program-analysis/user-application-ontology#"

# -----------------------------------------------------------------------------
# Discourse forum URL construction
# -----------------------------------------------------------------------------

# Base forum URL used to construct topic page URLs.
BASE_FORUM_URL = "https://discourse.nodered.org"

# Prefix for Discourse topic page URLs.
TOPIC_URL_PREFIX = f"{BASE_FORUM_URL}/t/"

# -----------------------------------------------------------------------------
# Title heuristics configuration: container detection
# -----------------------------------------------------------------------------

# Substrings indicating containerisation; checked case-insensitively.
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

# Ordered rules: the first matching pattern determines the OS platform label.
# The mapping values align with a Node.js-like os.platform taxonomy.
OS_RULES: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"linux", re.I), "linux"),
    (re.compile(r"darwin|macos|ios", re.I), "darwin"),
    # A dedicated capitalized "Windows" rule is included before the word-boundary
    # rule, matching certain title patterns as-is.
    (re.compile(r"Windows"), "win32"),
    # Word-boundary rule to reduce false positives (e.g., "window" vs "windows").
    (re.compile(r"\b(win32|win64|windows|win)\b", re.I), "win32"),
    (re.compile(r"freebsd", re.I), "freebsd"),
    (re.compile(r"openbsd", re.I), "openbsd"),
    (re.compile(r"sunos", re.I), "sunos"),
    (re.compile(r"aix", re.I), "aix"),
    (re.compile(r"android", re.I), "android"),
]

# -----------------------------------------------------------------------------
# Title heuristics configuration: Node.js version extraction
# -----------------------------------------------------------------------------

# Matches the literal "node.js" in a case-insensitive way.
NODEJS_RE = re.compile(r"node\.js", re.I)

# -----------------------------------------------------------------------------
# Title heuristics configuration: generic version tokens and tokenization
# -----------------------------------------------------------------------------

# Matches typical version tokens such as:
#   v4.1.3, 4.1, 4.1.3, (v4.1.3), (4.1.3)
# Captures only the numeric part in group(1).
VERSION_TOKEN_RE = re.compile(r"^\(?v?(\d+\.\d+(?:\.\d+)*)\)?$")

# Tokenization rule: split titles on whitespace.
TOKEN_SPLIT_RE = re.compile(r"\s+")

# Preceder tokens that must immediately appear before the Node-RED version token.
# Comparison is done after lowercasing and trimming surrounding punctuation.
NODERED_PRECEDERS = {"nr", "nodered", "node-red"}

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
# If NODERED_URDF is not set, fetching ZURL fails early; this is intentional,
# since ZURL and upload are runtime-coupled features in this script.
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
        # HTTPError is a file-like object; read() may contain an informative body.
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

    Args:
        iri:
            Full IRI to compact.
        ZURL:
            List of IRIs acting as the compaction dictionary.

    Returns:
        "z:<index>" if iri is present in ZURL, otherwise the original iri.
    """
    try:
        idx = ZURL.index(iri)
        return f"z:{idx}"
    except ValueError:
        return iri


# Fetch ZURL at import time so that downstream builder functions can use it.
# This will raise if NODERED_URDF is not set or the endpoint cannot be reached.
ZURL = get_zurl(NODERED_URDF)

# -----------------------------------------------------------------------------
# Utility functions
# -----------------------------------------------------------------------------

def safe_slug(name: str) -> str:
    """
    Convert an arbitrary string into a lowercase slug usable in URNs.

    Steps:
      - Trim whitespace
      - Remove trailing file extension
      - Replace non-alphanumeric/underscore/dash sequences with "-"
      - Collapse repeated "-" and trim edges
      - Lowercase

    Returns:
        A non-empty slug string; defaults to "graph" if empty.
    """
    s = name.strip()
    s = re.sub(r"\.[^.]+$", "", s)
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-").lower()
    return s or "graph"


def urn(*parts: str) -> str:
    """
    Build a URN by joining parts with ":".

    Args:
        parts:
            Components to join; leading ":" on each component is trimmed.

    Returns:
        A URN string, e.g., "urn:graph:myfile".
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
#
# All builder functions return expanded JSON-LD node objects.
# No @context is used to define prefixes; every property IRI is emitted in full
# unless it is compacted through ZURL.
# -----------------------------------------------------------------------------

def build_defined_term_set(set_id: str, name: str) -> Dict[str, Any]:
    """
    Build a schema:DefinedTermSet node.

    Args:
        set_id:
            Node identifier (IRI).
        name:
            Human-readable name of the term set.

    Returns:
        JSON-LD node for the term set.
    """
    return {
        "@id": set_id,
        "@type": [z("https://schema.org/DefinedTermSet", ZURL)],
        z("https://schema.org/name", ZURL): [{"@value": name}],
    }


def build_defined_term(term_id: str, label: str, set_id: str) -> Dict[str, Any]:
    """
    Build a schema:DefinedTerm node belonging to a schema:DefinedTermSet.

    Args:
        term_id:
            Node identifier (IRI).
        label:
            Term label.
        set_id:
            IRI of the parent term set.

    Returns:
        JSON-LD node for the term.
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

    Args:
        rating_id:
            Node identifier (IRI).
        value:
            Rating value on the fixed scale.

    Returns:
        JSON-LD node for the rating.
    """
    return {
        "@id": rating_id,
        "@type": [z("https://schema.org/Rating", ZURL)],
        z("https://schema.org/worstRating", ZURL): [{"@value": -10}],
        z("https://schema.org/bestRating", ZURL): [{"@value": 10}],
        z("https://schema.org/ratingValue", ZURL): [{"@value": value}],
    }

# -----------------------------------------------------------------------------
# URL and heuristic helpers
# -----------------------------------------------------------------------------

def topic_url(slug: str, topic_id: Any) -> str:
    """
    Construct a Discourse topic URL given the topic slug and topic id.
    """
    return f"{TOPIC_URL_PREFIX}{slug}/{topic_id}"


def title_has_container_hint(title: str) -> bool:
    """
    Detect whether the title includes any containerisation hint substrings.
    """
    t = title.lower()
    return any(term in t for term in CONTAINER_TERMS)


def detect_os_platform_from_title(title: str) -> Optional[str]:
    """
    Apply OS_RULES in order and return the first matched platform name.

    Returns:
        Platform label string, or None if no rule matches.
    """
    for pat, platform_name in OS_RULES:
        if pat.search(title):
            return platform_name
    return None


def extract_nodejs_version_from_title(title: str) -> Optional[str]:
    """
    Extract a Node.js version number from a title.

    Rule:
      - If "node.js" occurs, take the immediately following whitespace token.
      - Strip all characters except digits and dots.
      - Validate the resulting string as a dot-separated numeric version.

    Returns:
        Version string such as "18.19.0", or None if not found/invalid.
    """
    m = NODEJS_RE.search(title)
    if not m:
        return None

    # Consider only the substring after the matched "node.js".
    after = title[m.end():].lstrip()
    if not after:
        return None

    # Take the immediately following token (split on whitespace).
    token = after.split()[0] if after.split() else ""
    cleaned = re.sub(r"[^0-9.]+", "", token)
    if not cleaned:
        return None

    if not re.fullmatch(r"\d+(?:\.\d+)*", cleaned):
        return None

    return cleaned


def tokenize(title: str) -> List[str]:
    """
    Split a title into whitespace-delimited tokens, omitting empty tokens.
    """
    return [t for t in TOKEN_SPLIT_RE.split(title.strip()) if t]


def normalize_token_for_preceder(tok: str) -> str:
    """
    Normalize a token for preceder comparison:
      - Lowercase
      - Remove leading/trailing non-word characters (except '-')
    """
    return re.sub(r"^[^\w-]+|[^\w-]+$", "", tok.lower())


def extract_nodered_versions_from_title(title: str) -> List[str]:
    """
    Extract Node-RED versions from a title using a strict preceder rule.

    Rule:
      - Iterate tokens.
      - A token that looks like a version (via VERSION_TOKEN_RE) is accepted only
        if the immediately preceding token (normalized) is one of:
          "nr", "nodered", "node-red"

    Examples accepted:
      - "NR 3.1.0 ..." -> ["3.1.0"]
      - "node-red v4.0.0 ..." -> ["4.0.0"]
      - "nodered (3.0.2) ..." -> ["3.0.2"]

    Returns:
        A list of version strings (may contain multiple versions).
    """
    toks = tokenize(title)
    out: List[str] = []

    # Start at 1 since a preceding token is required.
    for i in range(1, len(toks)):
        prev = normalize_token_for_preceder(toks[i - 1])
        cur_raw = toks[i]

        # Light cleanup to remove some punctuation while preserving digits, dots,
        # parentheses, v-prefix, and hyphens.
        cur_norm = re.sub(r"[^\w\.\(\)v-]+", "", cur_raw, flags=re.I)

        if prev not in NODERED_PRECEDERS:
            continue

        # Trim additional edge punctuation that might remain.
        cur_norm2 = re.sub(r"^[^\w(]+|[^\w)]+$", "", cur_norm)

        m = VERSION_TOKEN_RE.match(cur_norm2)
        if not m:
            continue

        ver = m.group(1)
        if ver and re.fullmatch(r"\d+\.\d+(?:\.\d+)*", ver):
            out.append(ver)

    return out


def rescale_likes_to_rating(like: int, min_like: int, max_like: int) -> int:
    """
    Rescale a like_count into an integer rating in [-10, 10].

    Linear mapping:
      min_like -> -10
      max_like ->  10

    If min_like == max_like, return 0 to avoid division by zero.

    Returns:
        Rounded integer rating clamped to [-10, 10].
    """
    if max_like == min_like:
        return 0
    scaled = -10 + (like - min_like) * 20.0 / (max_like - min_like)
    return clamp(int(round(scaled)), -10, 10)

# -----------------------------------------------------------------------------
# Core transformation
# -----------------------------------------------------------------------------

def transform_file(path: Path) -> List[Dict[str, Any]]:
    """
    Transform one Discourse JSON file into a JSON-LD dataset (list with one graph object).

    Dataset structure:
      [
        {
          "@context": {},   # intentionally empty
          "@id": "<graph_urn>",
          "@graph": [ ...nodes... ]
        }
      ]

    The @graph will include:
      - One DefinedTermSet for tags across the file
      - One DefinedTerm per unique tag
      - One Rating node per topic (scaled within this file)
      - One DigitalDocument node per topic, referencing:
          * categories (DefinedTerms)
          * contentRating (Rating)
          * optional about nodes (OS, Node.js, Node-RED versions)
          * optional isContainerised boolean

    Args:
        path:
            Path of the input .json file.

    Returns:
        A list containing a single JSON-LD graph object.

    Raises:
        ValueError:
            If the expected topic_list/topics array is missing.
    """
    base = path.stem
    slug = safe_slug(base)
    graph_id = urn("graph", slug)

    # Load and validate the expected Discourse structure.
    raw = json.loads(path.read_text(encoding="utf-8"))
    topics = (((raw or {}).get("topic_list") or {}).get("topics")) if isinstance(raw, dict) else None
    if not isinstance(topics, list):
        raise ValueError(f"Input JSON must have topic_list/topics array: {path}")

    # -------------------------------------------------------------------------
    # Pass 1: collect global-per-file information
    # -------------------------------------------------------------------------
    #
    # - all_tags: used to create a stable tag vocabulary for the file
    # - like_counts: used to rescale ratings consistently within the file
    # -------------------------------------------------------------------------
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

    # Create stable IDs for the tag term set and each tag term.
    tag_set_id = urn("termset", slug, "tags")
    tag_term_id: Dict[str, str] = {
        tag: urn("term", slug, "tag", safe_slug(tag)) for tag in sorted(all_tags)
    }

    nodes: List[Dict[str, Any]] = []

    # -------------------------------------------------------------------------
    # Emit tag vocabulary nodes (DefinedTermSet + DefinedTerms)
    # -------------------------------------------------------------------------
    nodes.append(build_defined_term_set(tag_set_id, "Node-RED Forum Tags"))

    for tag in sorted(all_tags):
        nodes.append(build_defined_term(tag_term_id[tag], tag, tag_set_id))

    # -------------------------------------------------------------------------
    # Pass 2: emit nodes per topic (ratings, enrichment nodes, and documents)
    # -------------------------------------------------------------------------
    for t in topics:
        if not isinstance(t, dict):
            continue

        topic_id = t.get("id")
        slug_field = (t.get("slug") or "").strip()
        title = (t.get("title") or "").strip()
        last_posted_at = (t.get("last_posted_at") or "").strip()

        # Construct a canonical forum URL when possible.
        url = topic_url(slug_field, topic_id) if slug_field and topic_id is not None else ""

        # Local key used in URN-based identifiers when URL is missing.
        local_key = str(topic_id) if topic_id is not None else safe_slug(title) or "unknown"

        # ---------------------------------------------------------------------
        # Categories derived from tags
        # ---------------------------------------------------------------------
        cats: List[str] = []
        tags = t.get("tags") or []
        if isinstance(tags, list):
            for tag in tags:
                if isinstance(tag, str) and tag.strip() and tag.strip() in tag_term_id:
                    cats.append(tag_term_id[tag.strip()])

        # ---------------------------------------------------------------------
        # Rating derived from like_count, scaled within this file
        # ---------------------------------------------------------------------
        like = int(t.get("like_count") or 0)
        rating_value = rescale_likes_to_rating(like, min_like, max_like)
        rating_id = urn("rating", slug, local_key)
        nodes.append(build_rating(rating_id, rating_value))

        # about_ids will accumulate entities inferred from the title (OS/runtime).
        about_ids: List[str] = []

        # ---------------------------------------------------------------------
        # OS heuristic node
        # ---------------------------------------------------------------------
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

        # ---------------------------------------------------------------------
        # Node.js runtime heuristic node
        # ---------------------------------------------------------------------
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

        # ---------------------------------------------------------------------
        # Node-RED runtime heuristic nodes (may be multiple)
        # ---------------------------------------------------------------------
        for ver in extract_nodered_versions_from_title(title):
            nodered_id = urn("runtime", slug, local_key, "nodered", safe_slug(ver))
            nodes.append(
                {
                    "@id": nodered_id,
                    "@type": [
                        z(
                            "https://w3id.org/nodered-static-program-analysis/user-application-ontology#NodeRed",
                            ZURL,
                        )
                    ],
                    z("https://schema.org/version", ZURL): [{"@value": ver}],
                }
            )
            about_ids.append(nodered_id)

        # ---------------------------------------------------------------------
        # Container hint (boolean on the DigitalDocument)
        # ---------------------------------------------------------------------
        is_containerised = title_has_container_hint(title)

        # ---------------------------------------------------------------------
        # DigitalDocument node for the topic
        # ---------------------------------------------------------------------
        #
        # ID preference:
        #   - Use the forum URL when available to ensure stable global identifiers.
        #   - Fall back to a URN-based identifier otherwise.
        #
        # The node references:
        #   - schema:category => DefinedTerms for tags
        #   - schema:contentRating => Rating node
        #   - schema:about => inferred OS/runtime nodes (when present)
        #   - nrua:isContainerised => boolean when container hints are found
        # ---------------------------------------------------------------------
        doc_id = url if url else urn("doc", slug, local_key)
        doc: Dict[str, Any] = {
            "@id": doc_id,
            "@type": [z("https://schema.org/DigitalDocument", ZURL)],
            z("https://schema.org/title", ZURL): [{"@value": title}],
            **(
                {z("https://schema.org/date", ZURL): [{"@value": last_posted_at}]}
                if last_posted_at
                else {}
            ),
            **({z("https://schema.org/url", ZURL): [{"@value": url}]} if url else {}),
            **(
                {z("https://schema.org/category", ZURL): [{"@id": c} for c in cats]}
                if cats
                else {}
            ),
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
            **(
                {z("https://schema.org/about", ZURL): [{"@id": a} for a in about_ids]}
                if about_ids
                else {}
            ),
        }
        nodes.append(doc)

    # Return a dataset array (list) so downstream loaders can apply list-level
    # filtering/processing (e.g., JSON filter operations) consistently.
    return [
        {
            "@context": {},  # intentionally empty: no compaction rules are provided
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

    The request payload format is:
      {"doc": <dataset>}

    Args:
        doc:
            The JSON-LD dataset object (typically a list containing one graph).
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
        jsonld = transform_file(in_path)  # returns a LIST (dataset)
        out_path.write_text(json.dumps(jsonld, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {out_path}")
        post_jsonld(jsonld, out_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

