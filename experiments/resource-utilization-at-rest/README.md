# Resource Utilization at Rest (Baseline Measurement)

## What this experiment is about

This experiment establishes a **baseline resource footprint** comparison between:

- **imgA**: [nodered-urdf-virgin:4.1.3-22](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/experiment-oriented-images/nodered-urdf-virgin) (custom Node-RED image that bundles the uRDF-based plugin stack)
- **imgB**: [nodered/node-red:4.1.3-22](https://hub.docker.com/layers/nodered/node-red/4.1.3-22/images/sha256-1655a8ccebd6fe3465d1aab932599ad7ece2085c7c1e11135e0f0d323ce26d7f) (stock upstream Node-RED image)

The goal is to answer:

> *What is the steady-state (“at rest”) CPU and RAM overhead of the custom image compared to stock Node-RED, when doing nothing?*

## How the experiment works

### Measurement approach

The script uses **Docker-native resource sampling** via:

- `docker stats` (host/cgroup perspective; no agents inside containers)

This is intentionally “minimally intrusive”:
- no in-container instrumentation
- no application-level profiling

### Two scenarios: Cold vs Warm

Each run measures both:

1. **COLD start**
   - containers start with **fresh /data volumes**
   - captures first-run initialization costs

2. **WARM start**
   - containers are started again reusing the same volumes
   - captures “normal startup” after initial setup

### Two phases sampled per scenario

Within each scenario, the script labels samples as:

- **startup**
  - 60 seconds sampled at **1 Hz** (1 sample per second)
- **idle**
  - 300 seconds sampled at **0.2 Hz** (1 sample per 5 seconds)

### Controlled constraints

To keep comparisons fair, both containers are run with identical limits:

- CPU limit: **1 core**
- Memory limit: **1 GiB**

(These are configured in [test-runner.sh](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/resource-utilization-at-rest/test-runner.sh).)

## How to run it

### Prerequisites

- Docker installed
- The two images available locally:
  - [nodered/node-red:4.1.3-22](https://hub.docker.com/layers/nodered/node-red/4.1.3-22/images/sha256-1655a8ccebd6fe3465d1aab932599ad7ece2085c7c1e11135e0f0d323ce26d7f)
  - [nodered-urdf-virgin:4.1.3-22](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/experiment-oriented-images/nodered-urdf-virgin)

### Run

From the repository root:

```bash
cd experiments/resource-utilization-at-rest
bash test-runner.sh
```

### Outputs

A new run folder is produced under:

- `results/runX/`

Each run contains:

- `metrics_cold_<timestamp>.csv` (raw samples)
- `metrics_warm_<timestamp>.csv` (raw samples)
- `summary.txt` (per-phase aggregated stats)

## Results

### Raw metrics (authoritative source)

The authoritative raw data is in:

- `metrics_cold_*.csv`
- `metrics_warm_*.csv`

Each row is one sample and includes:

- `cpu_pct`
- `mem_used_bytes`
- network counters (rx/tx)
- block I/O counters (read/write)
- `pids`

### Interpretable/meaningful aggregates

For a “baseline at rest” experiment, the meaningful metrics are:

1. **Idle RAM usage (avg and max)**
2. **Idle CPU usage (avg)**
3. **Startup CPU spikes (max)**

### Baseline resource usage (mean over 3 runs)

| Scenario | Phase   | Container | CPU avg (%) | CPU max (%) | RAM avg (MiB) | RAM max (MiB) |
|---|---|---|---:|---:|---:|---:|
| cold | idle    | imgA (custom) | 0.327 | 8.70 | 64.26 | 64.70 |
| cold | idle    | imgB (stock)  | 0.327 | 8.94 | 47.33 | 50.82 |
| cold | startup | imgA (custom) | 1.394 | 53.19 | 63.75 | 69.92 |
| cold | startup | imgB (stock)  | 1.612 | 77.62 | 46.70 | 53.88 |
| warm | idle    | imgA (custom) | 0.304 | 8.17 | 60.29 | 63.36 |
| warm | idle    | imgB (stock)  | 0.283 | 8.39 | 47.18 | 52.14 |
| warm | startup | imgA (custom) | 1.062 | 51.23 | 59.75 | 66.24 |
| warm | startup | imgB (stock)  | 1.720 | 82.38 | 46.45 | 53.75 |

## Interpretation

The custom Node-RED image shows **no meaningful idle CPU overhead**, but introduces a **~13–17 MiB idle RAM overhead** relative to stock Node-RED. This quantifies the baseline memory cost of bundling the semantic stack before any active reasoning or flow growth, and before that measures were taken to reduce the gap.

## This experiment in context

You may be interested in understanding more about the place that this experiment occupies in the project. 

In that case, the [README file of the experiments folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/README.md) would be a good starting point.

