# Memory Scaling with Growing Applications (With Reasoning)

## What this experiment is about

This experiment measures how resource usage evolves as a Node-RED application **grows step-by-step** while **reasoning support is enabled**.

It compares two semantic Node-RED runtime variants:

- **imgA**: `nodered-urdf-sparql-rules:4.1.3-22`
- **imgB**: `nodered-urdf-n3-rules:4.1.3-22`

The goal is to answer:

> **As the deployed flow set grows (tab-by-tab), how do CPU/RAM evolve, and how do SPARQL-rule vs N3-rule variants compare?**

---

## How the experiment works

### Measurement approach

Resource usage is sampled externally via `docker stats`.

### Cold vs Warm scenarios

Each run includes:
- **COLD**: fresh `/data` volumes
- **WARM**: reused `/data` volumes

### Startup + regime phases

- **startup**: 60 seconds of sampling @ 1 Hz (no deployments)
- **regime**: 300 seconds total; every 5 seconds:
  1. sample resource usage
  2. add one tab-unit to the flows payload
  3. deploy the full payload through the Node-RED Admin API
  4. sleep 5 seconds

Default configuration yields **60 deploy steps**.

### Controlled constraints

Both containers run with identical limits:
- CPU: **1 core**
- Memory: **1 GiB**

---

## Flow growth strategy

Seed flows:
- `seed-nodered-flows.json`

The regime loop adds **one full tab (tab object + nodes with that tab as `z`)** per step.
To prevent duplicated logic from executing, duplicated nodes are marked disabled:

- `DISABLE_DUPLICATED_NODES="true"` → sets `"d": true` and neutralizes inject autostart.

The deployment payload is maintained locally as:
- `current_flows_A.json`
- `current_flows_B.json`

and deployed with:

- `POST /flows` (Admin API v1, full payload each time)

---

## How to run it

```bash
cd experiments/resource-utilization-growing-flows-with-reasoning
bash test-runner.sh
```

Outputs are stored under:

- `results/runX/` (`metrics_*.csv`, `summary.txt`)

---

## What data is meaningful

This experiment provides two meaningful signals:

1. **RAM scaling vs growth step** (primary)
2. **Deployment latency vs growth step** (secondary)

Important detail:

- The script samples **before** each deploy step.
- Therefore, the *k-th regime sample* corresponds to the state **after deploy step (k-1)**.

So:
- **step 0** = baseline state (config only; before first added tab)
- **step 1** = after deploying step 1
- …
- **step 59** = after deploying step 59

There is no `docker stats` sample after deploying step 60 with the current script structure.

---

## Results (signal-only tables)

This folder contains **3 repeated runs** (`run1..run3`).  
Tables below report the **mean across runs**.

### Table 1 — RAM scaling during regime (COLD)

| Step (after deploy) | Flows payload bytes* | Payload (KiB) | RAM avg imgA (MiB) | RAM avg imgB (MiB) |
|---:|---:|---:|---:|---:|
| 0 | - | - | 64.36 | 64.90 |
| 1 | 4798 | 4.7 | 67.03 | 69.39 |
| 10 | 88835 | 86.8 | 85.36 | 95.78 |
| 20 | 189191 | 184.8 | 95.08 | 108.10 |
| 40 | 375125 | 366.3 | 106.80 | 135.17 |
| 59 | 544112 | 531.4 | 117.90 | 126.20 |

### Table 2 — RAM scaling during regime (WARM)

| Step (after deploy) | Flows payload bytes* | Payload (KiB) | RAM avg imgA (MiB) | RAM avg imgB (MiB) |
|---:|---:|---:|---:|---:|
| 0 | - | - | 60.62 | 60.78 |
| 1 | 4798 | 4.7 | 63.29 | 65.38 |
| 10 | 88835 | 86.8 | 80.65 | 94.30 |
| 20 | 189191 | 184.8 | 89.79 | 105.60 |
| 40 | 375125 | 366.3 | 103.27 | 139.90 |
| 59 | 544112 | 531.4 | 112.73 | 123.73 |

\* *“Flows payload bytes” refers to the JSON size posted to `/flows` for that deploy step, as logged in `summary.txt`. Step 0 has no payload log because it is sampled before the first deploy.*

---

### Table 3 — Overall RAM growth (step 0 → step 59)

| Scenario | Container | RAM avg @ step 0 (MiB) | RAM avg @ step 59 (MiB) | Increase (MiB) | Increase (%) |
|---|---|---:|---:|---:|---:|
| cold | imgA | 64.36 | 117.90 | 53.54 | 83.2% |
| cold | imgB | 64.90 | 126.20 | 61.30 | 94.5% |
| warm | imgA | 60.62 | 112.73 | 52.12 | 86.0% |
| warm | imgB | 60.78 | 123.73 | 62.96 | 103.6% |

---

### Table 4 — Deployment latency (representative run)

Deployment latency is logged in `summary.txt` as `latency_ms=...` per deploy step.

| Window | imgA median (ms) | imgA mean (ms) | imgA max (ms) | imgB median (ms) | imgB mean (ms) | imgB max (ms) |
|---|---:|---:|---:|---:|---:|---:|
| Steps 1–10 | 38.0 | 39.4 | 52 | 35.0 | 34.5 | 46 |
| Steps 51–60 | 90.5 | 107.9 | 166 | 110.0 | 109.7 | 129 |
| Steps 1–60 | 64.5 | 67.4 | 166 | 68.0 | 73.6 | 179 |

---

## How these tables were produced

### RAM scaling (Tables 1–3)

1. Read `metrics_cold_*.csv` and `metrics_warm_*.csv` from `results/run1..run3/`.
2. Filter `phase == "regime"`.
3. Assign step index per container by row order:
   - `step_after_deploy = cumcount(regime rows per container)`
4. Convert bytes → MiB: `mem_mib = mem_used_bytes / 1024²`.
5. Average across runs for each `(scenario, container, step_after_deploy)`.

### Payload + latency (Tables 1, 4)

1. Parse deploy log lines in `summary.txt`:

   - `DEPLOY OK: imgX_flows_step_<N> payload_bytes=<B> ... latency_ms=<L>`

2. Payload bytes are identical for both containers at a given step.

---

## Interpretation / story the data tells

- RAM increases steadily with application size in both runtime variants.
- In these runs, **imgB (N3-rules)** reaches higher RAM usage than **imgA (SPARQL-rules)** at larger sizes (e.g., step 40).
- Deployment latency increases as payload size increases (median roughly ~35–40 ms at steps 1–10, rising to ~90–110 ms at steps 51–60 in the representative run).

---

## Where this fits in the experiment sequence

This experiment establishes initial scaling results for **growing application size with reasoning support present**.

It motivates the subsequent experiments introducing a **semantic compression strategy** and re-running scaling to quantify improvements (the “-2” experiment folders).
