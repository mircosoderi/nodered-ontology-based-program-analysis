FROM python:3.12-slim

WORKDIR /app

# Copy the script into the container
COPY github-issues-to-jsonld.py /app/github-issues-to-jsonld.py

# Create expected folders (will be overridden by volumes when mounted)
RUN mkdir -p /app/input /app/output

# Run the script and exit
ENTRYPOINT ["python", "/app/github-issues-to-jsonld.py"]

