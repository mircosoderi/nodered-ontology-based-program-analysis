# Ablation: Cost of Supporting N3 Reasoning (Measured at Rest)

## What this experiment is about

This experiment quantifies the **baseline (“at rest”) resource cost of including N3 reasoning support** in the semantic Node-RED runtime, after that the semantic runtime itself has been optimized to reduce the gap with vanilla Node-RED in resource utilization at rest.

It compares:

- **imgA (custom v2, no eyeling)**: [nodered-urdf-virgin-2-without-eyeling:4.1.3-22](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/experiment-oriented-images/nodered-urdf-virgin-2-without-eyeling)
- **imgB (stock)**: [nodered/node-red:4.1.3-22](https://hub.docker.com/layers/nodered/node-red/4.1.3-22/images/sha256-1655a8ccebd6fe3465d1aab932599ad7ece2085c7c1e11135e0f0d323ce26d7f)

The guiding question is:

> *If we remove the Eyeling-related reasoning support from the custom runtime, how much memory (and CPU) do we save at rest?*

This experiment is the ablation variant of the [experiment resource-utilization-at-rest-2](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-at-rest-2).

## How the experiment works

### Measurement approach

Resource usage is sampled externally using:

- `docker stats`

This is intentionally minimally intrusive (no agents inside containers).

### Cold vs Warm scenarios

Each run includes:

1. **COLD**
   - fresh `/data` volumes
2. **WARM**
   - reused `/data` volumes

### Phases

For each scenario:

- **startup**: 60 seconds @ 1 Hz
- **idle**: 300 seconds @ 0.2 Hz

### Controlled constraints

Both containers run with identical limits:

- CPU: **1 core**
- Memory: **1 GiB**

(As defined in [test-runner.sh](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/resource-utilization-at-rest-2-without-eyeling/test-runner.sh))

## How to run it

From the repository root:

```bash
cd experiments/resource-utilization-at-rest-2-without-eyeling
bash test-runner.sh
```

### Outputs

Each execution creates:

- `results/runX/`

containing:

- `metrics_cold_<timestamp>.csv`
- `metrics_warm_<timestamp>.csv`
- `summary.txt`

## Results 

For “measured at rest” ablation, the meaningful signals are:

1. **Idle RAM usage (avg)** (primary)
2. **Idle CPU usage (avg)** (secondary)
3. **Startup spikes** (diagnostic only)

The authoritative per-run aggregates are in each `summary.txt`.

This folder contains **3 repeated runs** (`run1..run3`).  

Tables below report the **mean across runs**.

### Table 1 — Resource usage (mean over 3 runs)

CPU is percent of the **1-core** limit.  
Memory is in **MiB**.

| Scenario | Phase | Container | CPU avg (%) | CPU max (%) | RAM avg (MiB) | RAM max (MiB) |
|---|---|---|---:|---:|---:|---:|
| cold | idle | imgA (custom v2, no eyeling) | 0.132 | 3.990 | 55.014 | 55.497 |
| cold | idle | imgB (stock) | 0.055 | 2.473 | 47.246 | 50.037 |
| cold | startup | imgA (custom v2, no eyeling) | 0.886 | 40.943 | 54.634 | 62.480 |
| cold | startup | imgB (stock) | 1.010 | 50.600 | 46.669 | 53.767 |
| warm | idle | imgA (custom v2, no eyeling) | 0.132 | 3.943 | 51.923 | 52.467 |
| warm | idle | imgB (stock) | 0.086 | 3.873 | 47.195 | 47.743 |
| warm | startup | imgA (custom v2, no eyeling) | 0.144 | 5.427 | 51.462 | 59.283 |
| warm | startup | imgB (stock) | 1.275 | 64.937 | 46.605 | 53.813 |

### Table 2 — “At rest” memory overhead vs stock (no eyeling)

Computed from **idle RAM avg** in Table 1.

| Scenario | Idle RAM avg imgA (MiB) | Idle RAM avg imgB (MiB) | Overhead (MiB) |
|---|---:|---:|---:|
| cold | 55.014 | 47.246 | **+7.768** |
| warm | 51.923 | 47.195 | **+4.728** |

### Table 3 — At-rest memory cost attributable to eyeling support (derived)

This table isolates the *incremental* memory cost of eyeling by comparing:

- **custom v2 WITH eyeling** (from [experiments/resource-utilization-at-rest-2/](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-at-rest-2))
vs
- **custom v2 WITHOUT eyeling** (this experiment)

Computed as: `idle_ram_avg(with_eyeling) - idle_ram_avg(without_eyeling)`.

| Scenario | Idle RAM avg (with eyeling) | Idle RAM avg (without eyeling) | Eyeling cost (MiB) |
|---|---:|---:|---:|
| cold | 56.617 | 55.014 | **+1.603** |
| warm | 52.860 | 51.923 | **+0.937** |

## How these tables were produced

1. Each `results/runX/summary.txt` includes one CSV block for COLD and one for WARM with:
   - `cpu_avg_pct`, `cpu_max_pct`
   - `mem_avg_bytes`, `mem_max_bytes`

2. For each run:
   - memory bytes were converted to MiB (`bytes / 1024²`)

3. Values were averaged across the three runs and grouped by:
   - `(scenario, phase, container)`

Table 3 is derived by subtracting the **idle RAM avg** of this experiment from the corresponding value in the companion experiment [resource-utilization-at-rest-2](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-at-rest-2).

## Interpretation 

### 1) Removing eyeling reduces baseline RAM overhead, but only slightly
Compared to stock Node-RED, the custom runtime **without eyeling** still shows an idle overhead of:

- **+7.768 MiB** (cold idle)
- **+4.728 MiB** (warm idle)

When comparing custom v2 with vs without eyeling, the incremental at-rest RAM cost of eyeling support is:

- **~1.603 MiB** (cold)
- **~0.937 MiB** (warm)

### 2) CPU remains negligible at rest
Idle CPU usage stays well below 1% of a single core in both images.

## This experiment in context

You may be interested in understanding more about the place that this experiment occupies in the project.

In that case, the [README file of the experiments folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/README.md) would be a good starting point.

