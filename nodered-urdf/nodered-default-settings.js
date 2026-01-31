const fs = require("fs");

/**
 * Resolve the credential encryption secret used by Node-RED.
 *
 * Node-RED uses this secret to encrypt credentials stored in flows.
 * If the secret changes, previously encrypted credentials become unreadable.
 *
 * Resolution strategy (in order of priority):
 *   1. An explicit environment variable provided by the operator
 *   2. A secret persisted in the Node-RED data volume
 *   3. A hardcoded fallback value (functional but unsafe for production)
 *
 * This layered approach ensures:
 *   - deterministic behavior in production environments,
 *   - persistence across container restarts,
 *   - a usable default for development and prototyping.
 */
function getCredentialSecret() {
  if (process.env.NODE_RED_CREDENTIAL_SECRET) {
    return process.env.NODE_RED_CREDENTIAL_SECRET;
  }

  try {
    const s = fs.readFileSync("/data/.node-red-credential-secret", "utf8").trim();
    if (s) return s;
  } catch (e) {
    /* intentionally ignored */
  }

  return "INSECURE_DEFAULT_CHANGE_ME";
}

/**
 * Node-RED runtime configuration.
 *
 * This file is copied into the persistent /data directory on first startup
 * and can be edited by operators without rebuilding the Docker image.
 *
 * Only a minimal set of settings is defined here:
 *   - project support in the editor
 *   - credential encryption configuration
 *
 * All other defaults are inherited from the base Node-RED image.
 */
module.exports = {
  editorTheme: {
    projects: {
      enabled: true
    }
  },

  credentialSecret: getCredentialSecret()
};

