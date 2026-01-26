FROM python:3.12-slim

WORKDIR /app

# Copy the converter script
COPY flows-json-to-jsonld.py /app/flows-json-to-jsonld.py

# Create default mount points (user will mount volumes here)
RUN mkdir -p /app/input /app/output

ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["python", "/app/flows-json-to-jsonld.py"]

