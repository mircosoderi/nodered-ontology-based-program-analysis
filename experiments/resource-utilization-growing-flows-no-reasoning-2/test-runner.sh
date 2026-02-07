#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Images under test
# =============================================================================
IMG_A="nodered-urdf-virgin-3:4.1.3-22"
IMG_B="nodered/node-red:4.1.3-22"

CPU_LIMIT="1.0"
MEM_LIMIT="1g"

NAME_A="imgA"
NAME_B="imgB"
HOST_PORT_A="1880"
HOST_PORT_B="1881"

VOL_A="nodered_data_A"
VOL_B="nodered_data_B"

SEED_FILE="./seed-nodered-flows.json"

# =============================================================================
# Timing
# =============================================================================
STARTUP_SECONDS=60   # 1 Hz sampling, no deploy
REGIME_SECONDS=300   # every 5s: sample + add one tab + deploy
DISABLE_DUPLICATED_NODES="true"
STARTUP_SETTLE_SECONDS=0

# Optional: cap number of regime steps (0 = use REGIME_SECONDS)
MAX_REGIME_STEPS=0

# =============================================================================
# Cleanup guard
# =============================================================================
cleanup() {
  docker rm -f "$NAME_A" "$NAME_B" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# =============================================================================
# Units conversion helpers for docker stats normalization
# =============================================================================
to_bytes() {
  awk '
  function u2b(v,u){
    if(u=="B")   return v;
    if(u=="KiB") return v*1024;
    if(u=="MiB") return v*1024*1024;
    if(u=="GiB") return v*1024*1024*1024;
    if(u=="TiB") return v*1024*1024*1024*1024;
    if(u=="kB")  return v*1000;
    if(u=="MB")  return v*1000*1000;
    if(u=="GB")  return v*1000*1000*1000;
    if(u=="TB")  return v*1000*1000*1000*1000;
    return v;
  }
  {
    match($0, /^([0-9.]+)([A-Za-z]+)$/, m);
    if(m[1]=="" || m[2]==""){ print 0; next }
    v=m[1]+0; u=m[2];
    printf "%.0f\n", u2b(v,u);
  }'
}

pair_to_bytes_csv() {
  local s="$1"
  local left right left_b right_b
  left=$(echo "$s" | awk -F' / ' '{print $1}')
  right=$(echo "$s" | awk -F' / ' '{print $2}')
  left_b=$(echo "$left" | to_bytes)
  right_b=$(echo "$right" | to_bytes)
  echo "${left_b},${right_b}"
}

# =============================================================================
# Docker stats sampling
# =============================================================================
sample_once() {
  local phase="$1"  # startup|regime
  local out="$2"
  local epoch
  epoch=$(date +%s)

  docker stats --no-stream \
    --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.NetIO}},{{.BlockIO}},{{.PIDs}}" \
    "$NAME_A" "$NAME_B" \
  | while IFS=',' read -r name cpu memusage netio blockio pids; do
      cpu_num=$(echo "$cpu" | sed 's/%//')
      mem_used=$(echo "$memusage" | awk -F' / ' '{print $1}')
      mem_lim=$(echo "$memusage"  | awk -F' / ' '{print $2}')
      mem_used_b=$(echo "$mem_used" | to_bytes)
      mem_lim_b=$(echo "$mem_lim"  | to_bytes)

      IFS=',' read -r net_rx_b net_tx_b <<< "$(pair_to_bytes_csv "$netio")"
      IFS=',' read -r blk_r_b  blk_w_b  <<< "$(pair_to_bytes_csv "$blockio")"

      echo "$epoch,$phase,$name,$cpu_num,$mem_used_b,$mem_lim_b,$net_rx_b,$net_tx_b,$blk_r_b,$blk_w_b,$pids" >> "$out"
    done
}

# =============================================================================
# Flow payload state (grows one TAB at a time)
# =============================================================================
# We maintain a local file representing "currently deployed flows array" so that:
# - each step adds one more tab worth of nodes
# - payload growth is slow and controlled
STATE_A="./current_flows_A.json"
STATE_B="./current_flows_B.json"

init_flow_state() {
  local state_file="$1"
  python3 - <<'PY' "$SEED_FILE" "$state_file"
import json,sys,pathlib,copy

seed_path=pathlib.Path(sys.argv[1])
state_path=pathlib.Path(sys.argv[2])

seed=json.loads(seed_path.read_text(encoding="utf-8"))
if not isinstance(seed,list):
  raise SystemExit("ERROR: seed must be a JSON array of Node-RED objects.")

tabs=[n for n in seed if isinstance(n,dict) and n.get("type")=="tab"]
tab_ids=set(t.get("id") for t in tabs if t.get("id"))

# config nodes = non-tab nodes not belonging to any tab (no z, or z not a tab)
config=[n for n in seed if isinstance(n,dict) and n.get("type")!="tab" and (("z" not in n) or (n.get("z") not in tab_ids))]

# initial deployed flows contain config only (robust: avoids unknown config refs remapping)
state_path.write_text(json.dumps(copy.deepcopy(config), ensure_ascii=False, separators=(",",":")), encoding="utf-8")
PY
}

# Add exactly one tab-unit (tab + its regular nodes) from the seed into the state file.
# Selection is cyclical: step 1 -> first tab, step 2 -> second tab, ...
# If seed has N tabs, step N+1 wraps to tab 1 again, but with fresh IDs.
add_one_tab_to_state() {
  local state_file="$1"
  local step="$2"
  local disable_dup="$3"

  python3 - <<'PY' "$SEED_FILE" "$state_file" "$step" "$disable_dup"
import json,sys,uuid,copy,pathlib

seed_path=pathlib.Path(sys.argv[1])
state_path=pathlib.Path(sys.argv[2])
step=int(sys.argv[3])
disable_dup=(sys.argv[4].lower()=="true")

seed=json.loads(seed_path.read_text(encoding="utf-8"))
state=json.loads(state_path.read_text(encoding="utf-8"))

if not isinstance(seed,list) or not isinstance(state,list):
  raise SystemExit("ERROR: seed and state must be JSON arrays.")

tabs=[n for n in seed if isinstance(n,dict) and n.get("type")=="tab"]
if not tabs:
  raise SystemExit("ERROR: seed contains no tabs (type=tab). This tab-at-a-time strategy needs tabs.")

tab_ids=[t.get("id") for t in tabs if t.get("id")]
if not tab_ids:
  raise SystemExit("ERROR: seed tabs missing id fields.")

selected_tab=tabs[(step-1) % len(tabs)]
src_tab_id=selected_tab["id"]

# Regular nodes for this tab: nodes with z == src_tab_id
regular=[n for n in seed if isinstance(n,dict) and n.get("type")!="tab" and n.get("z")==src_tab_id]

def new_id():
  return uuid.uuid4().hex

# New IDs for tab and nodes
tab_id_map={src_tab_id: new_id()}
node_id_map={}
for n in regular:
  if "id" in n and isinstance(n["id"],str):
    node_id_map[n["id"]]=new_id()

# Safety check: detect cross-tab wires (targets not in this tab’s node set)
src_node_ids=set(node_id_map.keys())
for n in regular:
  wires=n.get("wires")
  if isinstance(wires,list):
    for out_list in wires:
      if isinstance(out_list,list):
        for tid in out_list:
          if isinstance(tid,str) and tid not in src_node_ids:
            raise SystemExit(
              "ERROR: seed contains cross-tab wiring (node id %s referenced from tab %s). "
              "This script refuses to proceed because it would create inconsistent partial flows."
              % (tid, src_tab_id)
            )

# Build new tab
t2=copy.deepcopy(selected_tab)
t2["id"]=tab_id_map[src_tab_id]
# make label unique but stable
label=t2.get("label","")
if isinstance(label,str) and label.strip():
  t2["label"]=f"{label} [copy {step}]"
else:
  t2["label"]=f"flow [copy {step}]"
state.append(t2)

# Build new nodes
for n in regular:
  n2=copy.deepcopy(n)
  n2["id"]=node_id_map[n["id"]]
  n2["z"]=tab_id_map[src_tab_id]

  # remap wires within the tab
  wires=n2.get("wires")
  if isinstance(wires,list):
    new_wires=[]
    for out_list in wires:
      if isinstance(out_list,list):
        new_wires.append([node_id_map[tid] for tid in out_list])
      else:
        new_wires.append(out_list)
    n2["wires"]=new_wires

  # cosmetic uniqueness
  if "name" in n2 and isinstance(n2["name"],str) and n2["name"].strip():
    n2["name"]=f"{n2['name']} [copy {step}]"
  if isinstance(n2.get("x"),(int,float)):
    n2["x"]=n2["x"] + (step-1)*20
  if isinstance(n2.get("y"),(int,float)):
    n2["y"]=n2["y"] + (step-1)*20

  # minimize accidental runtime activity
  if disable_dup:
    n2["d"]=True
    if n2.get("type")=="inject":
      n2["once"]=False
      n2["onceDelay"]=0.1
      if "repeat" in n2:
        n2["repeat"]=""

  state.append(n2)

state_path.write_text(json.dumps(state, ensure_ascii=False, separators=(",",":")), encoding="utf-8")
PY
}

# =============================================================================
# Deploy flows (Admin API v1) reading from state file to avoid argv limits
# =============================================================================
deploy_state() {
  local base_url="$1"
  local state_file="$2"
  local label="$3"

  local http_code time_total ms size_bytes
  local tmp_resp
  tmp_resp=$(mktemp "/tmp/nr_resp_${label}_XXXXXX.txt")
  size_bytes=$(wc -c < "$state_file" | tr -d ' ')

  read -r http_code time_total < <(
    curl -sS -o "$tmp_resp" \
      -w "%{http_code} %{time_total}\n" \
      -H "Content-Type: application/json" \
      -H "Node-RED-API-Version: v1" \
      -H "Node-RED-Deployment-Type: flows" \
      -X POST "$base_url/flows" \
      --data-binary "@$state_file"
  )

  ms=$(python3 - <<PY "$time_total"
import sys
t=sys.argv[1].strip()
if not t: raise SystemExit(1)
print(int(float(t)*1000))
PY
) || {
    echo "ERROR: deploy produced no valid timing ($label) payload_bytes=$size_bytes" >&2
    head -c 2000 "$tmp_resp" >&2 || true
    rm -f "$tmp_resp" || true
    exit 1
  }

  if [[ "$http_code" != 2* && "$http_code" != "204" ]]; then
    echo "ERROR: deploy failed ($label) HTTP=$http_code latency_ms=$ms payload_bytes=$size_bytes" >&2
    echo "---- Response body (first 2000 chars) ----" >&2
    head -c 2000 "$tmp_resp" >&2 || true
    rm -f "$tmp_resp" || true
    exit 1
  fi

  rm -f "$tmp_resp" || true
  echo "DEPLOY OK: $label payload_bytes=$size_bytes http=$http_code latency_ms=$ms"
}

# =============================================================================
# Containers
# =============================================================================
start_containers() {
  docker rm -f "$NAME_A" "$NAME_B" >/dev/null 2>&1 || true

  docker run -d --rm --name "$NAME_A" \
    --cpus="$CPU_LIMIT" --memory="$MEM_LIMIT" \
    -p "${HOST_PORT_A}:1880" \
    -v "${VOL_A}:/data" \
    "$IMG_A" >/dev/null

  docker run -d --rm --name "$NAME_B" \
    --cpus="$CPU_LIMIT" --memory="$MEM_LIMIT" \
    -p "${HOST_PORT_B}:1880" \
    -v "${VOL_B}:/data" \
    "$IMG_B" >/dev/null
}

stop_containers() {
  docker rm -f "$NAME_A" "$NAME_B" >/dev/null 2>&1 || true
}

# =============================================================================
# Summary: avg/max for CPU & memory; deltas for counters; avg PIDs
# =============================================================================
summarize() {
  local csv="$1"
  awk -F',' '
  NR==1{next}
  {
    phase=$2; name=$3;
    cpu=$4+0; mem=$5+0;
    netrx=$7+0; nettx=$8+0;
    blkr=$9+0;  blkw=$10+0;
    pids=$11+0;

    key=name "|" phase;

    cpu_sum[key]+=cpu; cpu_n[key]++; if(cpu>cpu_max[key]) cpu_max[key]=cpu;
    mem_sum[key]+=mem; mem_n[key]++; if(mem>mem_max[key]) mem_max[key]=mem;
    pids_sum[key]+=pids; pids_n[key]++;

    if(!(key in seen_first)){
      netrx_first[key]=netrx; nettx_first[key]=nettx;
      blkr_first[key]=blkr;   blkw_first[key]=blkw;
      seen_first[key]=1;
    }
    netrx_last[key]=netrx; nettx_last[key]=nettx;
    blkr_last[key]=blkr;   blkw_last[key]=blkw;
  }
  END{
    printf "container,phase,cpu_avg_pct,cpu_max_pct,mem_avg_bytes,mem_max_bytes,net_rx_delta_bytes,net_tx_delta_bytes,blk_read_delta_bytes,blk_write_delta_bytes,pids_avg\n";
    for(k in cpu_sum){
      split(k,a,"|"); name=a[1]; phase=a[2];
      cpu_avg = cpu_sum[k]/cpu_n[k];
      mem_avg = mem_sum[k]/mem_n[k];
      pids_avg = pids_sum[k]/pids_n[k];

      netrx_delta = netrx_last[k]-netrx_first[k];
      nettx_delta = nettx_last[k]-nettx_first[k];
      blkr_delta  = blkr_last[k]-blkr_first[k];
      blkw_delta  = blkw_last[k]-blkw_first[k];

      printf "%s,%s,%.6f,%.6f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.2f\n",
        name, phase, cpu_avg, cpu_max[k], mem_avg, mem_max[k],
        netrx_delta, nettx_delta, blkr_delta, blkw_delta, pids_avg;
    }
  }' "$csv" | sort
}

# =============================================================================
# Run windows
# =============================================================================
run_startup_window() {
  local out="$1"
  for _ in $(seq 1 "$STARTUP_SECONDS"); do
    sample_once "startup" "$out"
    sleep 1
  done
}

run_regime_with_tab_growth() {
  local out="$1"
  local steps=$((REGIME_SECONDS/5))
  if (( MAX_REGIME_STEPS > 0 )); then
    steps="$MAX_REGIME_STEPS"
  fi

  # init local state payloads for each container
  init_flow_state "$STATE_A"
  init_flow_state "$STATE_B"

  local i
  for i in $(seq 1 "$steps"); do
    # 1) sample (state after previous deploy)
    sample_once "regime" "$out"

    # 2) add one tab worth of nodes
    add_one_tab_to_state "$STATE_A" "$i" "$DISABLE_DUPLICATED_NODES"
    add_one_tab_to_state "$STATE_B" "$i" "$DISABLE_DUPLICATED_NODES"

    # 3) deploy the full current state (required by Node-RED API semantics)
    deploy_state "http://localhost:${HOST_PORT_A}" "$STATE_A" "${NAME_A}_flows_step_${i}"
    deploy_state "http://localhost:${HOST_PORT_B}" "$STATE_B" "${NAME_B}_flows_step_${i}"

    sleep 5
  done
}

# =============================================================================
# Main
# =============================================================================
if [[ ! -f "$SEED_FILE" ]]; then
  echo "ERROR: seed file not found: $SEED_FILE" >&2
  exit 1
fi

# ---------------------------
# COLD run
# ---------------------------
docker volume rm "$VOL_A" "$VOL_B" >/dev/null 2>&1 || true
docker volume create "$VOL_A" >/dev/null
docker volume create "$VOL_B" >/dev/null

COLD_OUT="metrics_cold_$(date +%Y%m%d_%H%M%S).csv"
echo "epoch,phase,container,cpu_pct,mem_used_bytes,mem_limit_bytes,net_rx_bytes,net_tx_bytes,blk_read_bytes,blk_write_bytes,pids" > "$COLD_OUT"

start_containers
if (( STARTUP_SETTLE_SECONDS > 0 )); then sleep "$STARTUP_SETTLE_SECONDS"; fi
run_startup_window "$COLD_OUT"
run_regime_with_tab_growth "$COLD_OUT"
stop_containers

echo
echo "===== SUMMARY: COLD (fresh /data volumes) ====="
summarize "$COLD_OUT"
echo "RAW: $COLD_OUT"

# ---------------------------
# WARM run
# ---------------------------
WARM_OUT="metrics_warm_$(date +%Y%m%d_%H%M%S).csv"
echo "epoch,phase,container,cpu_pct,mem_used_bytes,mem_limit_bytes,net_rx_bytes,net_tx_bytes,blk_read_bytes,blk_write_bytes,pids" > "$WARM_OUT"

start_containers
if (( STARTUP_SETTLE_SECONDS > 0 )); then sleep "$STARTUP_SETTLE_SECONDS"; fi
run_startup_window "$WARM_OUT"
run_regime_with_tab_growth "$WARM_OUT"
stop_containers

echo
echo "===== SUMMARY: WARM (reused /data volumes) ====="
summarize "$WARM_OUT"
echo "RAW: $WARM_OUT"

# Cleanup local state files
rm -f "$STATE_A" "$STATE_B" >/dev/null 2>&1 || true

