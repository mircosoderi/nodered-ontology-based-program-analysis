# Memory Scaling with Growing Applications (No Reasoning)

## What this experiment is about

This experiment measures how memory usage evolves as a Node-RED application grows step-by-step **without reasoning support enabled**.

It compares:

- **imgA**: [nodered-urdf-virgin-2:4.1.3-22](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/experiment-oriented-images/nodered-urdf-virgin-2) (semantic runtime, improved memory usage baseline, reasoning inactive)
- **imgB**: [nodered/node-red:4.1.3-22](https://hub.docker.com/layers/nodered/node-red/4.1.3-22/images/sha256-1655a8ccebd6fe3465d1aab932599ad7ece2085c7c1e11135e0f0d323ce26d7f) (vanilla Node-RED)

The key question is:

> How does memory scale with application size when reasoning is not active, and how large is the baseline gap between semantic and vanilla Node-RED?

## Experimental design

- One tab-unit added per deploy step
- 60 deploy steps once regime is reached (after one minute startup), at intervals of 5 seconds
- first deploy 5k, last deploy 500k, growth in application size about 100x along the experiment
- Sampling performed before each deploy step
- 1 CPU core, 1 GiB memory limit

## How to run

```bash
cd experiments/resource-utilization-growing-flows-no-reasoning
bash test-runner.sh
```

Results appear under:

- `results/runX/`
  - `metrics_cold_*.csv`
  - `metrics_warm_*.csv`
  - `summary.txt`

## Results (mean over 3 runs)

### RAM scaling (COLD) — deterministic step alignment, mean across runs

| Step (after deploy) | RAM avg imgA (MiB) | RAM avg imgB (MiB) |
|---:|---:|---:|
| 0  | 63.58 | 46.57 |
| 1  | 66.04 | 48.02 |
| 10 | 79.95 | 53.41 |
| 20 | 86.88 | 56.18 |
| 40 | 97.61 | 60.72 |
| 59 | 109.50 | 57.25 |

### RAM scaling (WARM) — deterministic step alignment, mean across runs

| Step (after deploy) | RAM avg imgA (MiB) | RAM avg imgB (MiB) |
|---:|---:|---:|
| 0  | 59.66 | 48.45 |
| 1  | 62.03 | 52.91 |
| 10 | 75.34 | 57.09 |
| 20 | 83.92 | 59.34 |
| 40 | 94.77 | 59.28 |
| 59 | 103.50 | 66.46 |

### Overall RAM growth (step 0 → step 59) — deterministic alignment, mean across runs

| Scenario | Container | RAM @ step 0 (MiB) | RAM @ step 59 (MiB) | Increase (MiB) | Increase (%) |
|---|---|---:|---:|---:|---:|
| cold | imgA | 63.58 | 109.50 | 45.92 | 72.2% |
| cold | imgB | 46.57 | 57.25 | 10.68 | 22.9% |
| warm | imgA | 59.66 | 103.50 | 43.84 | 73.4% |
| warm | imgB | 48.45 | 66.46 | 18.01 | 37.2% |

## Interpretation

Across 60 deploy steps (~100× growth in application size):

- **Semantic Node-RED (imgA)** shows roughly ~70% memory increase.
- **Vanilla Node-RED (imgB)** shows roughly ~30% memory increase.

In absolute terms, the semantic Node-RED (ImgA) uses about +20 M than the vanilla Node-RED for small user applications, and +50 M for large applications.
 
This establishes:
- the fair scalability of memory usage in semantic Node-RED with respect to application size, which becomes anyway unsatisfactory when you consider how better the vanilla Node-RED scales 
- the significant memory gap in absolute terms between semantic and vanilla Node-RED

## This experiment in context

You may be interested in understanding more about the place that this experiment occupies in the project.

In that case, the [README file of the experiments folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/README.md) would be a good starting point.


