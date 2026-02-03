#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="urdf-baseline-measure:local"
CONTAINER_NAME="urdf_baseline_measure"
PORT=3000
URL="http://127.0.0.1:${PORT}"

to_mib() {
  local val="$1"
  if [[ "$val" =~ ^([0-9]+(\.[0-9]+)?)(KiB|MiB|GiB|B)$ ]]; then
    local num="${BASH_REMATCH[1]}"
    local unit="${BASH_REMATCH[3]}"
    case "$unit" in
      B)   awk "BEGIN{printf \"%.3f\", ${num}/1024/1024}" ;;
      KiB) awk "BEGIN{printf \"%.3f\", ${num}/1024}" ;;
      MiB) awk "BEGIN{printf \"%.3f\", ${num}}" ;;
      GiB) awk "BEGIN{printf \"%.3f\", ${num}*1024}" ;;
    esac
  else
    echo "0.000"
  fi
}

mem_usage_mib() {
  local raw used
  raw="$(docker stats --no-stream --format "{{.MemUsage}}" "${CONTAINER_NAME}")"
  used="$(awk '{print $1}' <<< "${raw}")"
  to_mib "${used}"
}

wait_health() {
  for _ in {1..50}; do
    if curl -fsS "${URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  echo "ERROR: container did not become healthy at ${URL}/health" >&2
  return 1
}

trigger() {
  local t="$1"
  echo "---- trigger response (${t}) ----"
  curl -sS "${URL}/trigger?t=${t}" || true
  echo
  echo "--------------------------------"
}

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Building image: ${IMAGE_NAME}"
docker build -t "${IMAGE_NAME}" .

echo "==> Running container: ${CONTAINER_NAME}"
cleanup
docker run -d --name "${CONTAINER_NAME}" -p "127.0.0.1:${PORT}:3000" "${IMAGE_NAME}" >/dev/null

echo "==> Waiting for health endpoint..."
wait_health

# Let Node settle
sleep 1

declare -A mem
declare -A delta

mem["baseline"]="$(mem_usage_mib)"
echo "Baseline: ${mem["baseline"]} MiB"

TRIGGERS=("t1" "t2" "t3" "t4" "t5")
LABELS=(
  "t1 require('jsonld')"
  "t2 require('sparqljs')"
  "t3 require('urdf/src/io.js')"
  "t4 new sparqljs.Parser()"
  "t5 require('urdf/src/urdf.js') + new urdf.Store()"
)

prev="${mem["baseline"]}"

for i in "${!TRIGGERS[@]}"; do
  t="${TRIGGERS[$i]}"
  label="${LABELS[$i]}"

  echo "==> Triggering ${label}"
  trigger "${t}"

  # Give RSS time to reflect module load/init
  sleep 1

  cur="$(mem_usage_mib)"
  mem["${t}"]="${cur}"
  d="$(awk "BEGIN{printf \"%.3f\", ${cur} - ${prev}}")"
  delta["${t}"]="${d}"
  prev="${cur}"
done

echo
echo "==================== RESULTS (MiB) ===================="
printf "%-32s %12s %12s\n" "Step" "Mem" "Delta"
printf "%-32s %12s %12s\n" "baseline" "${mem["baseline"]}" "—"
for i in "${!TRIGGERS[@]}"; do
  t="${TRIGGERS[$i]}"
  label="${LABELS[$i]}"
  printf "%-32s %12s %12s\n" "${label}" "${mem["${t}"]}" "${delta["${t}"]}"
done
echo "======================================================="
echo
echo "==> Done. Container will be terminated."

