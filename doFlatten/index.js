#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import jsonld from "jsonld";

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

  const inputPath = path.resolve(process.cwd(), args.file);

  let raw;
  try {
    raw = await fs.readFile(inputPath, "utf8");
  } catch (e) {
    console.error(`ERROR: Cannot read file: ${inputPath}`);
    console.error(e.message);
    process.exit(2);
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    console.error(`ERROR: File is not valid JSON: ${inputPath}`);
    console.error(e.message);
    process.exit(2);
  }

  let flattened;
  try {
    flattened = await jsonld.flatten(doc);
  } catch (e) {
    console.error("ERROR: jsonld.flatten failed. Input may not be valid JSON-LD.");
    console.error(e.message);
    process.exit(1);
  }

  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(dir, `${base}.flattened.jsonld`);

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

  console.log("✅ JSON-LD flattened successfully.");
  console.log(`Input : ${inputPath}`);
  console.log(`Output: ${outputPath}`);
})();

