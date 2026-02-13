#!/usr/bin/env bash
set -euo pipefail

# -----------------------
# REQUIRED config
# -----------------------
IMAGE=${IMAGE:-"nodered-urdf-instrumented:4.1.3-22"}   # Node-RED image (instrumented)

# -----------------------
# Node-RED / Bench config
# -----------------------
PORT=${PORT:-1880}
TIMEOUT=${TIMEOUT:-600}                         # more generous (seeders + deploy)
OUTROOT=${OUTROOT:-"results"}
FACTORS=${FACTORS:-"1,2,4,8,16,32,48,64"}

# RULES=${RULES:-"rules.flattened.compressed.jsonld"}
FLOWS_SEED=${FLOWS_SEED:-"nodered-default-flows.json"}

CPUS=${CPUS:-"2"}                               # e.g. 0.5
MEM=${MEM:-"2g"}                                 # e.g. 256m

# -----------------------
# Seeding config (optional)
# -----------------------
RUN_SEEDERS=${RUN_SEEDERS:-1}                  # 1 to run your 3 importers, 0 to skip

# Images
IMG_GH=${IMG_GH:-"github-issues-to-jsonld"}
IMG_DISC=${IMG_DISC:-"discourse-forum-to-jsonld"}
IMG_FLOWS=${IMG_FLOWS:-"flows-json-to-jsonld"}

# Volumes (host paths). Adjust to your machine.
GH_IN=${GH_IN:-"/home/ubuntu/nodered-static-program-analysis/github-issues-to-jsonld/input"}
GH_OUT=${GH_OUT:-"/home/ubuntu/nodered-static-program-analysis/github-issues-to-jsonld/output"}

DISC_IN=${DISC_IN:-"/home/ubuntu/nodered-static-program-analysis/discourse-forum-to-jsonld/input"}
DISC_OUT=${DISC_OUT:-"/home/ubuntu/nodered-static-program-analysis/discourse-forum-to-jsonld/output"}

FLOWS_IN=${FLOWS_IN:-"/home/ubuntu/nodered-static-program-analysis/flows-json-to-jsonld/input"}
FLOWS_OUT=${FLOWS_OUT:-"/home/ubuntu/nodered-static-program-analysis/flows-json-to-jsonld/output"}
FLOWS_URL=${FLOWS_URL:-"https://github.com/node-red/cookbook-flows"}

# -----------------------
# Helpers
# -----------------------
need(){ command -v "$1" >/dev/null 2>&1 || { echo "Missing $1" >&2; exit 1; }; }
need docker; need curl; need python3; need grep

RUN_ID=$(date +%Y%m%d-%H%M%S)
OUTBASE="$OUTROOT/$RUN_ID-${CPU}CPU-${MEM}RAM"
mkdir -p "$OUTBASE"

SCALED_DIR="$OUTBASE/scaled_flows"
mkdir -p "$SCALED_DIR"

# Generate scaled flows using the previously provided script
python3 make_scaled_flows.py --in "$FLOWS_SEED" --outdir "$SCALED_DIR" --factors "$FACTORS" >/dev/null

# Dedicated docker network so seeders can reach Node-RED by name
NET="urdf_bench_net_${RUN_ID}"
docker network create "$NET" >/dev/null

cleanup_net() {
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup_net EXIT

IFS=',' read -r -a FACT_ARR <<< "$FACTORS"

for F in "${FACT_ARR[@]}"; do
  F=$(echo "$F" | xargs); [ -n "$F" ] || continue

  OUT="$OUTBASE/x$F"
  mkdir -p "$OUT"

  FLOWS="$SCALED_DIR/$(basename "${FLOWS_SEED%.*}").x${F}.json"

  NAME="nodered_${RUN_ID}_x${F}"

  ARGS=(-d --rm --name "$NAME" --network "$NET" -p "${PORT}:1880" -e URDF_METRICS=1)
  [ -n "$CPUS" ] && ARGS+=(--cpus "$CPUS")
  [ -n "$MEM" ] && ARGS+=(--memory "$MEM")

  CID=$(docker run "${ARGS[@]}" "$IMAGE")
  echo "$CID" > "$OUT/container_id.txt"

  cleanup_run(){
    docker logs "$CID" > "$OUT/docker.log" 2>&1 || true
    docker stop "$CID" >/dev/null 2>&1 || true
  }
  trap cleanup_run EXIT

  # Host access (for curl from the script)
  BASE_HOST="http://127.0.0.1:${PORT}"
  # Container-to-container access (for seeders)
  BASE_NET="http://${NAME}:1880"

  # Wait /urdf/health
  start=$(date +%s)
  until curl -fsS "$BASE_HOST/urdf/health" >/dev/null; do
    now=$(date +%s)
    [ $((now-start)) -ge "$TIMEOUT" ] && { echo "Timeout /urdf/health (x$F)" >&2; exit 1; }
    sleep 2 
  done

  # Load rules (your runtime accepts it without auth)
  # curl -fsS -X POST "$BASE_HOST/urdf/load" \
  #  -H "Content-Type: application/json" \
  #  --data-binary @"$RULES" > "$OUT/load_rules.json"

  # Seed example data (only once per run; if you prefer once total, we can move it out)
  if [ "$RUN_SEEDERS" = "1" ]; then
    echo "Seeding example datasets for x$F..."
    docker run --rm --network "$NET" \
      -v "${GH_IN}:/app/input:ro" \
      -v "${GH_OUT}:/app/output" \
      -e NODERED_URDF="${BASE_NET}/" \
      "$IMG_GH" > "$OUT/seed_github.log" 2>&1

    docker run --rm --network "$NET" \
      -v "${DISC_IN}:/app/input:ro" \
      -v "${DISC_OUT}:/app/output" \
      -e NODERED_URDF="${BASE_NET}/" \
      "$IMG_DISC" > "$OUT/seed_discourse.log" 2>&1

    docker run --rm --network "$NET" \
      -v "${FLOWS_IN}:/app/input:ro" \
      -v "${FLOWS_OUT}:/app/output" \
      -e NODERED_URDF="${BASE_NET}/" \
      -e FLOWS_URL="${FLOWS_URL}" \
      "$IMG_FLOWS" > "$OUT/seed_flowslib.log" 2>&1
  fi

  # Deploy flows via Node-RED /flows (forces lifecycle hooks)
  DEPLOY_TS_MS=$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
)
  curl -fsS -X POST "$BASE_HOST/flows" \
    -H "Content-Type: application/json" \
    -H "Node-RED-Deployment-Type: full" \
    --data-binary @"$FLOWS" > "$OUT/deploy_flows.json"

  # Wait for a cycle metric after deploy timestamp (from stdout)
  start=$(date +%s)
  while true; do
    docker logs "$CID" 2>/dev/null | grep -E '^URDF_METRIC ' | grep -F '"kind":"cycle"' > "$OUT/_cycles.tmp" || true
    if [ -s "$OUT/_cycles.tmp" ]; then
      last_ts=$(python3 - <<PY
import json
ts=0
for line in open("$OUT/_cycles.tmp","r",encoding="utf-8"):
    line=line.strip()
    if not line.startswith("URDF_METRIC "):
        continue
    j=json.loads(line[len("URDF_METRIC "):])
    ts=max(ts,int(j.get("ts") or 0))
print(ts)
PY
)
      if [ "$last_ts" -ge "$DEPLOY_TS_MS" ]; then
        break
      fi
    fi
    now=$(date +%s)
    [ $((now-start)) -ge "$TIMEOUT" ] && { echo "Timeout waiting cycle metric (x$F)" >&2; break; }
    sleep 0.2
  done
  rm -f "$OUT/_cycles.tmp" || true

  # Save metrics stream
  docker logs "$CID" 2>/dev/null | grep -E '^URDF_METRIC ' > "$OUT/metrics.jsonl" || true

  # --------
  # Ground-truth counts via HTTP API (your request)
  # --------
  curl -fsS "$BASE_HOST/urdf/size?gid=urn%3Anrua%3Aapp" > "$OUT/size_app.json" || true
  curl -fsS "$BASE_HOST/urdf/size?gid=urn%3Agraph%3Ainferred" > "$OUT/size_inferred.json" || true
  curl -fsS "$BASE_HOST/urdf/size?gid=urn%3Anrua%3Aenv" > "$OUT/size_env.json" || true
  curl -fsS "$BASE_HOST/urdf/size?gid=urn%3Anrua%3Arules" > "$OUT/size_rules.json" || true

  # Stop container
  docker stop "$CID" >/dev/null 2>&1 || true
  trap - EXIT

  echo "Run x$F done -> $OUT"
done

echo "All runs saved under: $OUTBASE"

