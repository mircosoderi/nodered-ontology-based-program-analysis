FROM python:3.12-slim

# =============================================================================
# Container purpose
# -----------------------------------------------------------------------------
# This image packages a single Python script and runs it as the container entrypoint.
#
# Expected runtime pattern:
#   - Mount input JSON exports into:  /app/input
#   - Mount an output directory into: /app/output
# The script will read *.json from /app/input and write *.jsonld into /app/output.
# =============================================================================

WORKDIR /app

# -----------------------------------------------------------------------------
# Application payload
# -----------------------------------------------------------------------------
# Copy only the exporter script into the image.
# (Input/Output data is expected to be provided via bind mounts or volumes.)
COPY github-issues-to-jsonld.py /app/github-issues-to-jsonld.py

# -----------------------------------------------------------------------------
# Runtime directories
# -----------------------------------------------------------------------------
# Create default folders so the container can run even without mounted volumes.
# When volumes are mounted, these paths will be replaced by the mounted content.
RUN mkdir -p /app/input /app/output

# -----------------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------------
# Execute the exporter as the container's main process.
# Any additional CLI args passed to `docker run` will be forwarded to python.
ENTRYPOINT ["python", "/app/github-issues-to-jsonld.py"]

