/**
 * Canonicalizes JSON for deterministic string comparison:
 * - Sort object keys
 * - If an array looks like a JSON-LD node list (items with @id), sort by @id
 * - If an object has @graph as an array, sort @graph similarly
 */
export function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    const mapped = value.map(canonicalizeJson);

    // If it's an array of node objects with @id, sort it.
    if (mapped.every(isNodeObjectWithId)) {
      return mapped.sort((a, b) => String(a["@id"]).localeCompare(String(b["@id"])));
    }

    return mapped;
  }

  if (value !== null && typeof value === "object") {
    const out = {};

    // Special handling: if @graph exists and is an array, canonicalize it with sorting.
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      if (k === "@graph" && Array.isArray(value[k])) {
        const canonGraph = value[k].map(canonicalizeJson);
        out[k] = canonGraph.every(isNodeObjectWithId)
          ? canonGraph.sort((a, b) => String(a["@id"]).localeCompare(String(b["@id"])))
          : canonGraph;
      } else {
        out[k] = canonicalizeJson(value[k]);
      }
    }
    return out;
  }

  return value;
}

function isNodeObjectWithId(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && "@id" in v;
}

export function canonicalStringify(value) {
  // After canonicalizeJson, JSON.stringify is deterministic enough.
  return JSON.stringify(value);
}

