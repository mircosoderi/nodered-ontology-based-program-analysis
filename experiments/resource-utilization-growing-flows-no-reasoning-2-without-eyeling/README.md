
# Memory Scaling with Growing Applications (No Reasoning v2, Without Eyeling)

## Overview

This experiment evaluates memory scaling as the Node-RED application grows step-by-step, using:

- Updated deployment strategy (v2 runtime)
- No reasoning active
- Eyeling support removed

The objective is to isolate the memory footprint of the semantic runtime under growth conditions without N3 reasoning components.

## Experimental Design

- One tab added per deploy step
- 60 deploy steps started after startup (one minute), at intervals of 5 seconds
- Sampling during regime phase only
- Mean aggregation across runs 
- 1 CPU core, 1 GiB memory limit

## How to run:

```bash
cd experiments/resource-utilization-growing-flows-no-reasoning-2-no-eyeling
bash test-runner.sh
```

## RAM Scaling (COLD)

| Step (after deploy) | RAM avg imgA (MiB) | RAM avg imgB (MiB) |
|---:|---:|---:|
| 0 | 54.46 | 46.53 |
| 1 | 56.77 | 48.10 |
| 10 | 66.41 | 53.35 |
| 20 | 70.92 | 56.25 |
| 40 | 77.88 | 59.12 |
| 59 | 90.21 | 65.97 |

## RAM Scaling (WARM)

| Step (after deploy) | RAM avg imgA (MiB) | RAM avg imgB (MiB) |
|---:|---:|---:|
| 0 | 51.50 | 48.51 |
| 1 | 53.83 | 53.45 |
| 10 | 64.19 | 57.00 |
| 20 | 68.10 | 58.23 |
| 40 | 74.94 | 61.37 |
| 59 | 81.87 | 64.65 |

## Overall RAM Growth (Mean Across Runs)

| Scenario | Container | RAM @ step 0 (MiB) | RAM @ step 59 (MiB) | Increase (MiB) | Increase (%) |
|---|---|---:|---:|---:|---:|
| cold | imgA | 54.46 | 90.21 | 35.75 | 65.6% |
| cold | imgB | 46.53 | 65.97 | 19.44 | 41.8% |
| warm | imgA | 51.50 | 81.87 | 30.37 | 59.0% |
| warm | imgB | 48.51 | 64.65 | 16.15 | 33.3% |

## Comparison

Compared with the [experiment](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-growing-flows-no-reasoning-2) where the N3 reasoner was present and enabled, this experiments shows a neglectable reduction in memory and CPU usage. 

## This experiment in context

You may be interested in understanding more about the place that this experiment occupies in the project.

In that case, the [README file of the experiments folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/README.md) would be a good starting point.


