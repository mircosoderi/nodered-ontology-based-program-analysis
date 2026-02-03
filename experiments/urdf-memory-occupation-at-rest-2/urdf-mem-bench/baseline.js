"use strict";

/**
 * Single-process container.
 * - Starts baseline (no urdf).
 * - Waits for /tmp/load-urdf trigger.
 * - When triggered, require("urdf") in THIS SAME PROCESS.
 * - Writes /tmp/urdf-loaded as ACK for deterministic sampling.
 * - Then stays alive doing nothing.
 */

const fs = require("fs");

const TRIGGER = "/tmp/load-urdf";
const ACK = "/tmp/urdf-loaded";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForFile(path) {
  while (true) {
    try {
      fs.accessSync(path, fs.constants.F_OK);
      return;
    } catch (_) {}
    await sleep(50);
  }
}

async function main() {
  console.log(`[baseline] started pid=${process.pid}`);
  console.log(`[baseline] waiting trigger file: ${TRIGGER}`);

  // Ensure a clean state (in case container is reused)
  try { fs.unlinkSync(TRIGGER); } catch (_) {}
  try { fs.unlinkSync(ACK); } catch (_) {}

  await waitForFile(TRIGGER);

  console.log("[baseline] trigger detected; requiring urdf...");
  require("urdf/src/urdf-module-strict.js");
  console.log("[baseline] urdf required; writing ACK...");

  fs.writeFileSync(ACK, "ok\n");

  console.log("[baseline] idle forever");
  setInterval(() => {}, 60_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

