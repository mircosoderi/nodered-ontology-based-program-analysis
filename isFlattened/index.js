#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { checkFlattenedJsonLdFile } from "./lib/checkFlattened.js";

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

(async () => {
  const args = parseArgs(process.argv);

  if (args.help || !args.file) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const filePath = path.resolve(process.cwd(), args.file);

  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (e) {
    console.error(`ERROR: Cannot read file: ${filePath}`);
    console.error(String(e?.message ?? e));
    process.exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`ERROR: File is not valid JSON: ${filePath}`);
    console.error(String(e?.message ?? e));
    process.exit(2);
  }

  const result = await checkFlattenedJsonLdFile(parsed);

  if (result.isFlattened) {
    console.log("✅ The document IS already flattened (per jsonld.flatten equivalence check).");
    process.exit(0);
  } else {
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
  }
})();

