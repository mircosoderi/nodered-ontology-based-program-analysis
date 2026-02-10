# Resource Utilization at Rest (v2 — Optimized uRDF Fork)

## What this experiment is about

This experiment re-runs the [resource-utilization-at-rest experiment](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-at-rest), but this time it compares:

- **imgA**: [nodered-urdf-virgin-2:4.1.3-22](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/experiment-oriented-images/nodered-urdf-virgin-2) (custom Node-RED image, updated to use the [forked uRDF](https://github.com/mircosoderi/uRDF.js))
- **imgB**: [nodered/node-red:4.1.3-22](https://hub.docker.com/layers/nodered/node-red/4.1.3-22/images/sha256-1655a8ccebd6fe3465d1aab932599ad7ece2085c7c1e11135e0f0d323ce26d7f) (stock upstream Node-RED)

The goal is to answer:

> *After optimizing uRDF (fork + reduced baseline footprint), what is the steady-state CPU and RAM overhead of the semantic Node-RED runtime compared to vanilla Node-RED, when doing nothing?*

This experiment is the Node-RED-level validation of the uRDF optimization work quantified in the [urdf-memory-occupation-at-rest-2 experiment](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/urdf-memory-occupation-at-rest-2).

## How the experiment works

### Measurement approach

The script measures resource usage from outside the containers using:

- `docker stats`

This is intentionally “minimally intrusive”:
- no in-container agents,
- no app instrumentation.

### Cold vs Warm scenarios

Each run measures both:

1. **COLD start**
   - containers start with **fresh /data volumes**
   - captures first-run initialization costs

2. **WARM start**
   - containers start again reusing the same volumes
   - captures steady operational conditions

### Phases

Within each scenario, samples are grouped into:

- **startup** (60 seconds at 1 Hz)
- **idle** (300 seconds at 0.2 Hz)

### Controlled constraints

Both containers are run with identical limits:

- CPU limit: **1 core**
- Memory limit: **1 GiB**

(Defined in `test-runner.sh`.)

## How to run it

### Prerequisites

- Docker installed
- Images available locally:
  - [nodered/node-red:4.1.3-22](https://hub.docker.com/layers/nodered/node-red/4.1.3-22/images/sha256-1655a8ccebd6fe3465d1aab932599ad7ece2085c7c1e11135e0f0d323ce26d7f)
  - [nodered-urdf-virgin-2:4.1.3-22](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/experiment-oriented-images/nodered-urdf-virgin-2) 

### Run

From the repository root:

```bash
cd experiments/resource-utilization-at-rest-2
bash test-runner.sh
```

### Outputs

A new run folder is created under:

- `results/runX/`

Each run contains:
- `metrics_cold_<timestamp>.csv`
- `metrics_warm_<timestamp>.csv`
- `summary.txt` (per-scenario, per-phase aggregates)

## Results 

### Authoritative raw data

- `metrics_cold_*.csv`
- `metrics_warm_*.csv`

### Meaningful aggregates for “at rest”

For the “at rest” question, the meaningful signals are:

1. **Idle RAM usage (avg and max)**
2. **Idle CPU usage (avg)**
3. **Startup CPU spikes (max)** (useful as a diagnostic, but inherently noisy)

The [results folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-at-rest-2/results) includes **3 repeated runs** (`run1`, `run2`, `run3`).  
Tables below report the **mean across runs**.

### Table 1 — Baseline resource usage (mean over 3 runs)

CPU is percent of the **1-core** limit.  
Memory is in **MiB**.

| Scenario | Phase | Container | CPU avg (%) | CPU max (%) | RAM avg (MiB) | RAM max (MiB) |
|---|---|---|---:|---:|---:|---:|
| cold | idle | imgA (custom v2) | 0.2807 | 4.0033 | 56.6165 | 57.1000 |
| cold | idle | imgB (stock) | 0.0882 | 2.6900 | 47.3362 | 47.8667 |
| cold | startup | imgA (custom v2) | 0.4675 | 17.1867 | 56.0038 | 63.5467 |
| cold | startup | imgB (stock) | 0.8584 | 43.7600 | 46.7144 | 53.9267 |
| warm | idle | imgA (custom v2) | 0.1954 | 2.7167 | 52.8600 | 53.3567 |
| warm | idle | imgB (stock) | 0.1447 | 4.1433 | 47.1761 | 47.7033 |
| warm | startup | imgA (custom v2) | 0.5314 | 25.7600 | 52.3372 | 60.0133 |
| warm | startup | imgB (stock) | 0.8978 | 43.2600 | 46.5877 | 53.8933 |

### Table 2 — “At rest” memory overhead of the custom image (v2)

Computed from **idle RAM avg** in Table 1:

| Scenario | Idle RAM avg imgA (MiB) | Idle RAM avg imgB (MiB) | Overhead (MiB) |
|---|---:|---:|---:|
| cold | 56.6165 | 47.3362 | **+9.2803** |
| warm | 52.8600 | 47.1761 | **+5.6839** |

### How these tables were produced

1. Each `results/runX/summary.txt` includes two CSV blocks (COLD and WARM) with:
   - `cpu_avg_pct`, `cpu_max_pct`
   - `mem_avg_bytes`, `mem_max_bytes`

2. For each run:
   - `mem_*_bytes` values were converted to MiB (divide by 1024²)

3. Values were then averaged across the three runs:
   - grouped by `(scenario, phase, container)`

No smoothing or filtering was applied beyond averaging across repeats.

## Interpretation

### 1) Idle CPU remains negligible
Both images show very low idle CPU usage (well below 1% of one core), consistent with “at rest” behavior.

### 2) Memory overhead is materially reduced vs the original baseline
The custom image v2 shows an idle RAM overhead of roughly:

- **+9.28 MiB** (cold idle)
- **+5.68 MiB** (warm idle)

This aligns with the project storyline: after the uRDF fork/optimizations, the semantic runtime’s baseline footprint becomes much closer to vanilla Node-RED.

## This experiment in context

You may be interested in understanding more about the place that this experiment occupies in the project.

In that case, the [README file of the experiments folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/README.md) would be a good starting point.

