FROM python:3.12-slim

# -----------------------------------------------------------------------------
# Container: Node-RED flow export -> JSON-LD converter
# -----------------------------------------------------------------------------
#
# Purpose
# -------
# Minimal runtime image that executes the converter script as the container
# entrypoint. Input/output are expected to be provided via bind mounts.
#
# Working Directory
# -----------------
# All paths are rooted under /app to keep volume mounts predictable:
#   - /app/input   (read-only recommended)
#   - /app/output  (writable)
# -----------------------------------------------------------------------------

WORKDIR /app

# -----------------------------------------------------------------------------
# Application payload
# -----------------------------------------------------------------------------
#
# The converter is a single-file script; we copy it directly into the image.
# -----------------------------------------------------------------------------

COPY flows-json-to-jsonld.py /app/flows-json-to-jsonld.py

# -----------------------------------------------------------------------------
# Default mount points
# -----------------------------------------------------------------------------
#
# These directories are created so that:
#   - the container can start even without mounts (though it will fail if no
#     input files are present), and
#   - users can reliably mount volumes at these well-known paths.
# -----------------------------------------------------------------------------

RUN mkdir -p /app/input /app/output

# -----------------------------------------------------------------------------
# Runtime behavior
# -----------------------------------------------------------------------------
#
# Ensure Python logs are flushed immediately so that container logs are visible
# in real time (useful for CI and orchestrators).
# -----------------------------------------------------------------------------

ENV PYTHONUNBUFFERED=1

# -----------------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------------
#
# The container runs the converter script directly.
# Configuration is provided through environment variables, notably:
#   - FLOWS_URL     (required by the script)
#   - NODERED_URDF  (optional; enables ZURL fetch + upload)
# -----------------------------------------------------------------------------

ENTRYPOINT ["python", "/app/flows-json-to-jsonld.py"]

