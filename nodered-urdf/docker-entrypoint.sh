#!/bin/sh
set -eu

# --- Paths / constants ---
USER_DIR="/data"

PLUGIN_SRC="/opt/node-red-urdf-plugin"
PLUGIN_NAME="node-red-urdf-plugin"
DEST_DIR="$USER_DIR/node_modules/$PLUGIN_NAME"

DEFAULT_SETTINGS="/opt/nodered-default-settings.js"
SETTINGS_FILE="$USER_DIR/settings.js"

SECRET_FILE="$USER_DIR/.node-red-credential-secret"

# --- Ensure base dirs exist ---
mkdir -p "$USER_DIR/node_modules"

# --- Credential secret handling ---
# Preferred: user provides NODE_RED_CREDENTIAL_SECRET.
# Fallback: generate a secret once and persist it in /data so it survives restarts.
if [ -z "${NODE_RED_CREDENTIAL_SECRET:-}" ] && [ ! -f "$SECRET_FILE" ]; then
  echo "[entrypoint] Generating credential secret at $SECRET_FILE ..."
  # 32 bytes -> 64 hex chars
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE" || true
fi

# --- Settings initialization ---
# If /data/settings.js doesn't exist (fresh volume), create it from our template.
if [ ! -f "$SETTINGS_FILE" ]; then
  echo "[entrypoint] Creating default settings.js in $SETTINGS_FILE ..."
  cp "$DEFAULT_SETTINGS" "$SETTINGS_FILE"
fi

# --- Install plugin into /data (volume) if missing ---
if [ ! -d "$DEST_DIR" ]; then
  echo "[entrypoint] Installing $PLUGIN_NAME into $DEST_DIR (from prebuilt $PLUGIN_SRC)..."
  cp -r "$PLUGIN_SRC" "$DEST_DIR"
else
  echo "[entrypoint] $PLUGIN_NAME already present in $DEST_DIR"
fi

# --- Start Node-RED using the base image entrypoint ---
echo "[entrypoint] Starting Node-RED via base image entrypoint..."
cd /usr/src/node-red
exec ./entrypoint.sh

