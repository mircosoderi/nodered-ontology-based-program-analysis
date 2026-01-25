FROM python:3.12-slim

WORKDIR /app

COPY discourse-forum-to-jsonld.py /app/discourse-forum-to-jsonld.py

RUN mkdir -p /app/input /app/output

ENTRYPOINT ["python", "-u", "/app/discourse-forum-to-jsonld.py"]

