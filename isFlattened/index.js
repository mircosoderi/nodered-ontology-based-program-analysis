#!/usr/bin/env node
/**
 * JSON / JSON-LD "flattened" checker CLI.
 *
 * Purpose
 * -------
 * Loads a JSON or JSON-LD file from disk and checks whether it is already
 * flattened according to an equivalence check against jsonld.flatten output
 * (as implemented by ./lib/checkFlattened.js).
 *
 * Usage
 * -----
 *   node index.js --file <path>
 *   node index.js -f <path>
 *
 * Exit Codes
 * ----------
 *   0  -> document is flattened
 *   1  -> document is not flattened (valid JSON, check completed)
 *   2  -> usage error or file/JSON parsing error
 *
 * Output Convention
 * -----------------
 * Human-oriented console output is printed:
 *   - ✅ for flattened
 *   - ❌ for not flattened
 *   - "Reason" and optional "Hint" details when not flattened
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { checkFlattenedJsonLdFile } from "./lib/checkFlattened.js";

// ----------------------------------------------------------------------------
// CLI: usage text
// ----------------------------------------------------------------------------

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node index.js --file <path-to-json-or-jsonld>",
      "",
      "Examples:",
      "  node index.js --file ./data/doc.jsonld",
      "  node index.js --file ./data/flattened.json",
      ""
    ].join("\n")
  );
}

// ----------------------------------------------------------------------------
// CLI: argument parsing
// ----------------------------------------------------------------------------

/**
 * Parse argv into a minimal options object.
 *
 * Accepted flags:
 *   --file | -f   Path to a JSON/JSON-LD file
 *   --help | -h   Print usage and exit(0)
 *
 * Notes
 * -----
 * - Unknown flags are ignored (no hard failure) to keep parsing minimal.
 * - If --file is provided without a following value, args.file remains null.
 *
 * Args:
 *   argv: process.argv array
 *
 * Returns:
 *   { file: string|null, help?: boolean }
 */
function parseArgs(argv) {
  const args = { file: null };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--file" || a === "-f") {
      args.file = argv[i + 1];
      i++;
      continue;
    }

    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
  }

  return args;
}

// ----------------------------------------------------------------------------
// Main program flow
// ----------------------------------------------------------------------------

(async () => {
  const args = parseArgs(process.argv);

  // Usage guard: missing file or explicit help.
  if (args.help || !args.file) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  // Resolve to an absolute path based on the current working directory.
  const filePath = path.resolve(process.cwd(), args.file);

  // --------------------------------------------------------------------------
  // Load file content
  // --------------------------------------------------------------------------
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (e) {
    console.error(`ERROR: Cannot read file: ${filePath}`);
    console.error(String(e?.message ?? e));
    process.exit(2);
  }

  // --------------------------------------------------------------------------
  // Parse JSON
  // --------------------------------------------------------------------------
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`ERROR: File is not valid JSON: ${filePath}`);
    console.error(String(e?.message ?? e));
    process.exit(2);
  }

  // --------------------------------------------------------------------------
  // Flattened-equivalence check (domain logic delegated to library)
  // --------------------------------------------------------------------------
  const result = await checkFlattenedJsonLdFile(parsed);

  // --------------------------------------------------------------------------
  // Report and exit
  // --------------------------------------------------------------------------
  if (result.isFlattened) {
    console.log("✅ The document IS already flattened (per jsonld.flatten equivalence check).");
    process.exit(0);
  }

  console.log("❌ The document is NOT flattened.");
  console.log("");
  console.log("Reason:");
  console.log(`- ${result.reason}`);

  if (result.details?.diffHint) {
    console.log("");
    console.log("Hint:");
    console.log(`- ${result.details.diffHint}`);
  }

  process.exit(1);
})();

