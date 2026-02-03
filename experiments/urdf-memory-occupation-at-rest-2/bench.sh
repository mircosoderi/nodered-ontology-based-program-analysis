#!/usr/bin/env bash
set -euo pipefail

IMAGE="urdf-mem-bench:tmp"
NAME="urdf-mem-bench-container"
OUT="./mem_bench.csv"

# -------- parsing helpers (docker stats style) --------

to_bytes() {
  # Converts strings like "12.34MiB", "999KiB", "1.2GiB" to integer bytes.
  python3 - <<'PY' "$1"
import re, sys
s=sys.argv[1].strip()
m=re.match(r'^([0-9]*\.?[0-9]+)\s*([A-Za-z]+)$', s)
if not m:
    print(0); sys.exit(0)
v=float(m.group(1)); u=m.group(2)
mul={
 "B":1,
 "KiB":1024, "MiB":1024**2, "GiB":1024**3, "TiB":1024**4,
 "kB":1000, "MB":1000**2, "GB":1000**3, "TB":1000**4,
}.get(u, 1)
print(int(v*mul))
PY
}

mem_used_bytes_from_stats() {
  local name="$1"
  local memusage mem_used
  memusage="$(docker stats --no-stream --format "{{.MemUsage}}" "$name")" # "used / limit"
  mem_used="$(awk -F' / ' '{print $1}' <<< "$memusage")"
  to_bytes "$mem_used"
}

cleanup() {
  set +e
  docker rm -f "$NAME" >/dev/null 2>&1
  docker rmi -f "$IMAGE" >/dev/null 2>&1
}
trap cleanup EXIT

# -------- benchmark steps --------

echo "Building image..."
docker build -t "$IMAGE" ./urdf-mem-bench >/dev/null

echo "Starting container (baseline, no urdf)..."
docker run -d --name "$NAME" "$IMAGE" >/dev/null

# Let Node finish startup
sleep 1

baseline="$(mem_used_bytes_from_stats "$NAME")"
echo "Baseline MemUsed: $baseline bytes"

echo "Triggering urdf load (same Node process)..."
docker exec "$NAME" sh -c 'rm -f /tmp/urdf-loaded /tmp/load-urdf; touch /tmp/load-urdf'

# Wait deterministically for ACK (max 15s)
echo "Waiting for ACK..."
for _ in {1..300}; do
  if docker exec "$NAME" sh -c 'test -f /tmp/urdf-loaded'; then
    break
  fi
  sleep 0.05
done

# Steady-state check: take two samples 0.5s apart and use the larger one
# (avoids sampling mid-transition; still minimal complexity)
sleep 0.5
after1="$(mem_used_bytes_from_stats "$NAME")"
sleep 0.5
after2="$(mem_used_bytes_from_stats "$NAME")"
after="$after1"
if [ "$after2" -gt "$after1" ]; then after="$after2"; fi

echo "After require('urdf') MemUsed: $after bytes"

delta=$(( after - baseline ))

echo
echo "================ RESULT ================"
echo "baseline_bytes=$baseline"
echo "after_bytes=$after"
echo "delta_bytes=$delta"
echo "urdf delta (docker stats MemUsage) = $delta bytes"
echo "========================================"
echo

epoch="$(date +%s)"
echo "epoch,baseline_bytes,after_bytes,delta_bytes" > "$OUT"
echo "$epoch,$baseline,$after,$delta" >> "$OUT"
echo "Wrote $OUT"

