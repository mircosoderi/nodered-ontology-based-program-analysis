# Memory Scaling with Growing Applications (No Reasoning — Compression Strategy)

## What this experiment is about

This experiment repeats the [growing application without reasoning experiment](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-growing-flows-no-reasoning), but this time it uses the improved storage strategy (IRIs compression, not visible to users).

It compares:

- **imgA**: [nodered-urdf-virgin-3:4.1.3-22](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/experiment-oriented-images/nodered-urdf-virgin-3)
- **imgB**: [nodered/node-red:4.1.3-22](https://hub.docker.com/layers/nodered/node-red/4.1.3-22/images/sha256-1655a8ccebd6fe3465d1aab932599ad7ece2085c7c1e11135e0f0d323ce26d7f)

Goal:

> Quantify how the updated strategy affects memory scaling under application growth when reasoning is inactive.

## Experimental design

- One tab-unit added per deploy step
- 60 deploy steps started after one minute startup, at intervals of 5 seconds
- application size grows of about a 100x factor along the experiment
- Sampling before each deploy
- 1 CPU core
- 1 GiB memory limit

## How to run

```bash
cd experiments/resource-utilization-growing-flows-no-reasoning-2
bash test-runner.sh
```

Outputs:

- `results/runX/`
  - `metrics_cold_*.csv`
  - `metrics_warm_*.csv`
  - `summary.txt`

## Results 

### RAM scaling (COLD) — deterministic step alignment, mean across runs

| Step (after deploy) | RAM avg imgA (MiB) | RAM avg imgB (MiB) |
|---:|---:|---:|
| 0  | 56.16 | 46.54 |
| 1  | 58.34 | 48.07 |
| 10 | 67.51 | 53.14 |
| 20 | 73.02 | 55.79 |
| 40 | 78.42 | 59.41 |
| 59 | 91.29 | 67.22 |

### RAM scaling (WARM) — deterministic step alignment, mean across runs

| Step (after deploy) | RAM avg imgA (MiB) | RAM avg imgB (MiB) |
|---:|---:|---:|
| 0  | 52.26 | 48.32 |
| 1  | 54.41 | 52.98 |
| 10 | 67.82 | 56.89 |
| 20 | 75.96 | 59.18 |
| 40 | 80.21 | 59.05 |
| 59 | 87.39 | 64.92 |

### Overall RAM growth (step 0 → step 59) — deterministic alignment, mean across runs

| Scenario | Container | RAM @ step 0 (MiB) | RAM @ step 59 (MiB) | Increase (MiB) | Increase (%) |
|---|---|---:|---:|---:|---:|
| cold | imgA | 56.16 | 91.29 | 35.13 | 62.6% |
| cold | imgB | 46.54 | 67.22 | 20.68 | 44.4% |
| warm | imgA | 52.26 | 87.39 | 35.13 | 67.2% |
| warm | imgB | 48.32 | 64.92 | 16.60 | 34.4% |

### Overall RAM growth (step 0 → step 59), before of the storage improvement, reported for comparison

This table is copied from [experiment resource-utilization-growing-flows-no-reasoning](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-growing-flows-no-reasoning).

| Scenario | Container | RAM @ step 0 (MiB) | RAM @ step 59 (MiB) | Increase (MiB) | Increase (%) |
|---|---|---:|---:|---:|---:|
| cold | imgA | 63.58 | 109.50 | 45.92 | 72.2% |
| cold | imgB | 46.57 | 57.25 | 10.68 | 22.9% |
| warm | imgA | 59.66 | 103.50 | 43.84 | 73.4% |
| warm | imgB | 48.45 | 66.46 | 18.01 | 37.2% |

## Interpretation

Relative to the [original no-reasoning scaling experiment](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-growing-flows-no-reasoning), both scalability and absolute memory usage of the semantic Node-RED (ImgA) significantly improved, which confirms the effectiveness of the improved storage strategy.

## This experiment in context

You may be interested in understanding more about the place that this experiment occupies in the project.

In that case, the [README file of the experiments folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/README.md) would be a good starting point.

