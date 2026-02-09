import jsonld from "jsonld";
import { canonicalizeJson, canonicalStringify } from "./canonicalize.js";

/**
 * Checks if `doc` is already flattened according to:
 *   canonicalize(doc) === canonicalize(await jsonld.flatten(doc))
 *
 * Returns:
 *  { isFlattened: boolean, reason: string, details?: object }
 */
export async function checkFlattenedJsonLdFile(doc) {
  // Quick shape sanity check (not the authority; flatten equivalence is).
  const isJsonObject = doc !== null && typeof doc === "object";
  if (!isJsonObject) {
    return {
      isFlattened: false,
      reason: "Top-level JSON value is not an object or array."
    };
  }

  let flattened;
  try {
    // jsonld.flatten returns a Promise; output is the flattened form. :contentReference[oaicite:2]{index=2}
    flattened = await jsonld.flatten(doc);
  } catch (e) {
    return {
      isFlattened: false,
      reason: "jsonld.flatten(doc) failed (input may not be valid JSON-LD).",
      details: { error: String(e?.message ?? e) }
    };
  }

  const canonOriginal = canonicalizeJson(doc);
  const canonFlattened = canonicalizeJson(flattened);

  const s1 = canonicalStringify(canonOriginal);
  const s2 = canonicalStringify(canonFlattened);

  if (s1 === s2) {
    return {
      isFlattened: true,
      reason: "jsonld.flatten(doc) is structurally identical to doc after canonicalization."
    };
  }

  // If you want extra diagnostics, we keep it light (no heavy deep-diff).
  return {
    isFlattened: false,
    reason: "jsonld.flatten(doc) produced a different structure than doc.",
    details: {
      diffHint:
        "Try running jsonld.flatten(doc) and comparing with your file; common differences are top-level @graph wrapping or node embedding being pulled up."
    }
  };
}

