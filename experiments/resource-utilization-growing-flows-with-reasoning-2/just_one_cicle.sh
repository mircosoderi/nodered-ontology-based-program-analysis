#!/usr/bin/env bash
set -euo pipefail

IMAGE=${IMAGE:-"nodered-urdf-virgin-3-instrumented:4.1.3-22"}
PORT=${PORT:-1880}
FLOWS=${FLOWS:-"nodered-default-flows.json"}
RULES=${RULES:-"rules.flattened.compressed.jsonld"}
TIMEOUT=${TIMEOUT:-30}
OUTROOT=${OUTROOT:-"results"}

RUN_ID=$(date +%Y%m%d-%H%M%S)
OUT="$OUTROOT/$RUN_ID"
mkdir -p "$OUT"

NAME="urdf_bench_$RUN_ID"
CID=$(docker run -d --rm --name "$NAME" -p ${PORT}:1880 -e URDF_METRICS=1 "$IMAGE")
echo "$CID" > "$OUT/container_id.txt"

cleanup() {
  docker logs "$CID" > "$OUT/docker.log" 2>&1 || true
  docker stop "$CID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

BASE="http://127.0.0.1:${PORT}"

# 1) wait for runtime
start=$(date +%s)
until curl -fsS "$BASE/urdf/health" >/dev/null; do
  now=$(date +%s)
  if [ $((now-start)) -ge "$TIMEOUT" ]; then
    echo "Timeout waiting for /urdf/health" >&2
    exit 1
  fi
  sleep 1 
done

# 2) load rules (use the *compressed* one since that's what you really load)
curl -fsS -X POST "$BASE/urdf/load" \
  -H "Content-Type: application/json" \
  --data-binary @"$RULES" \
  > "$OUT/load_rules.json"

# 3) deploy flows (forces flows:deployed trigger)
curl -fsS -X POST "$BASE/flows" \
  -H "Content-Type: application/json" \
  -H "Node-RED-Deployment-Type: full" \
  --data-binary @"$FLOWS" \
  > "$OUT/deploy_flows.json"

# 4) wait a bit for metrics to appear (simple, robust)
sleep 5 

# 5) extract stdout metrics
docker logs "$CID" 2>/dev/null | grep -E '^URDF_METRIC ' > "$OUT/metrics.jsonl" || true

echo "Saved metrics to: $OUT/metrics.jsonl"
echo "Saved full logs to: $OUT/docker.log"

