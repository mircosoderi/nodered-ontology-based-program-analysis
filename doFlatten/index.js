#!/usr/bin/env node
/**
 * JSON / JSON-LD flattener (CLI).
 *
 * Purpose
 * -------
 * Reads a JSON or JSON-LD file from disk, attempts to flatten it using the
 * jsonld library, and writes a new `.flattened.jsonld` file next to the input.
 *
 * Why flatten?
 * ------------
 * JSON-LD flattening normalizes graph structure into a predictable shape:
 *   - Consolidates nodes into a single @graph (with consistent identifiers)
 *   - Reduces nesting complexity for downstream processing / ingestion
 *
 * I/O Layout
 * ----------
 * Input:
 *   --file <path>   A JSON or JSON-LD file (must be valid JSON text).
 *
 * Output:
 *   <same_dir>/<same_basename>.flattened.jsonld
 *
 * Exit codes
 * ----------
 *   0  Success (or --help)
 *   1  jsonld.flatten failed (likely invalid JSON-LD semantics/structure)
 *   2  CLI usage error, read error, parse error, or write error
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import jsonld from "jsonld";

// -----------------------------------------------------------------------------
// CLI help text
// -----------------------------------------------------------------------------

/**
 * Print CLI usage instructions.
 *
 * The script is intentionally minimal: a single required `--file` argument,
 * plus a `--help` switch.
 */
function printUsage() {
  console.log(
    [
      "Usage:",
      "  node index.js --file <path-to-json-or-jsonld>",
      "",
      "Example:",
      "  node index.js --file ./data/input.jsonld",
      ""
    ].join("\n")
  );
}

// -----------------------------------------------------------------------------
// Argument parsing (simple + dependency-free)
// -----------------------------------------------------------------------------

/**
 * Parse argv for supported flags.
 *
 * Supported options:
 *   --file, -f   Input file path (required unless --help)
 *   --help, -h   Print usage and exit
 *
 * Notes:
 * - This parser is intentionally small and permissive.
 * - Unknown flags are ignored (could be tightened if desired).
 */
function parseArgs(argv) {
  const args = { file: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" || a === "-f") {
      args.file = argv[i + 1];
      i++;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    }
  }
  return args;
}

// -----------------------------------------------------------------------------
// Main program flow (async I/O + jsonld flattening)
// -----------------------------------------------------------------------------

(async () => {
  // Parse CLI flags first; fail fast on missing required input.
  const args = parseArgs(process.argv);

  if (args.help || !args.file) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  // Resolve the provided file path relative to the current working directory
  // to ensure consistent behavior regardless of where the script is invoked.
  const inputPath = path.resolve(process.cwd(), args.file);

  // ---------------------------------------------------------------------------
  // Step 1: Read the input file as UTF-8 text
  // ---------------------------------------------------------------------------
  let raw;
  try {
    raw = await fs.readFile(inputPath, "utf8");
  } catch (e) {
    console.error(`ERROR: Cannot read file: ${inputPath}`);
    console.error(e.message);
    process.exit(2);
  }

  // ---------------------------------------------------------------------------
  // Step 2: Parse as JSON (syntactic validation)
  // ---------------------------------------------------------------------------
  //
  // The file must be valid JSON text. JSON-LD is still JSON at the syntax level,
  // but may fail later if it is not valid JSON-LD structurally/semantically.
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    console.error(`ERROR: File is not valid JSON: ${inputPath}`);
    console.error(e.message);
    process.exit(2);
  }

  // ---------------------------------------------------------------------------
  // Step 3: Flatten using jsonld
  // ---------------------------------------------------------------------------
  //
  // This is the semantic step: jsonld.flatten may fail if:
  //   - required JSON-LD constructs are malformed
  //   - contexts/IRIs expand incorrectly
  //   - the document is plain JSON (not JSON-LD) and cannot be interpreted
  let flattened;
  try {
    flattened = await jsonld.flatten(doc);
  } catch (e) {
    console.error("ERROR: jsonld.flatten failed. Input may not be valid JSON-LD.");
    console.error(e.message);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Step 4: Compute output path next to the input
  // ---------------------------------------------------------------------------
  //
  // Output naming convention:
  //   <basename>.flattened.jsonld
  // Example:
  //   input.jsonld -> input.flattened.jsonld
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(dir, `${base}.flattened.jsonld`);

  // ---------------------------------------------------------------------------
  // Step 5: Write the flattened JSON-LD with stable formatting
  // ---------------------------------------------------------------------------
  //
  // Formatting:
  //   - 2-space indentation for readability and diffs
  //   - UTF-8 output encoding
  try {
    await fs.writeFile(
      outputPath,
      JSON.stringify(flattened, null, 2),
      "utf8"
    );
  } catch (e) {
    console.error(`ERROR: Failed to write output file: ${outputPath}`);
    console.error(e.message);
    process.exit(2);
  }

  // ---------------------------------------------------------------------------
  // Step 6: Report success (paths included for traceability)
  // ---------------------------------------------------------------------------
  console.log("✅ JSON-LD flattened successfully.");
  console.log(`Input : ${inputPath}`);
  console.log(`Output: ${outputPath}`);
})();

