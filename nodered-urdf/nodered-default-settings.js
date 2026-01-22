const fs = require("fs");

function getCredentialSecret() {
  // 1) Best: operator-provided secret
  if (process.env.NODE_RED_CREDENTIAL_SECRET) {
    return process.env.NODE_RED_CREDENTIAL_SECRET;
  }

  // 2) Fallback: secret persisted in /data (volume)
  try {
    const s = fs.readFileSync("/data/.node-red-credential-secret", "utf8").trim();
    if (s) return s;
  } catch (e) {
    // ignore
  }

  // 3) Last resort: still works, but would change if container recreated without /data
  return "INSECURE_DEFAULT_CHANGE_ME";
}

module.exports = {
  editorTheme: {
    projects: {
      enabled: true
    }
  },
  credentialSecret: getCredentialSecret()
};

