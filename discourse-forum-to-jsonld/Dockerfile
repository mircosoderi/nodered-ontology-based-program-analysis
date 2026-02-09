# Use the official Python 3.12 image based on Debian "slim".
# "slim" reduces image size by excluding many optional OS packages, while still
# providing a functional environment for running Python applications.
FROM python:3.12-slim

# Set the working directory inside the container.
# All subsequent relative paths in COPY/RUN/CMD/ENTRYPOINT are resolved from here.
WORKDIR /app

# Copy the application script into the container filesystem.
# The destination path is explicit to make the runtime entrypoint unambiguous.
COPY discourse-forum-to-jsonld.py /app/discourse-forum-to-jsonld.py

# Create expected runtime directories used by the script.
# - /app/input  : location where Discourse JSON files are read from
# - /app/output : location where JSON-LD files are written to
# These directories can later be overridden or backed by bind mounts / volumes.
RUN mkdir -p /app/input /app/output

# Define the container's main process.
# - "python" runs the interpreter.
# - "-u" forces unbuffered stdout/stderr so logs appear immediately in container logs.
# - The script path is absolute for clarity and robustness.
ENTRYPOINT ["python", "-u", "/app/discourse-forum-to-jsonld.py"]

