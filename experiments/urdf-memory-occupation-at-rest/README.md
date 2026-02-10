# Isolating Memory Overhead: uRDF Memory Occupation at Rest

## What this experiment is about

This experiment isolates the **baseline memory overhead introduced by loading uRDF** in a minimal Node.js process.

The core question is:

> **How much additional RAM is consumed when `require("urdf")` is executed, everything else kept constant?**

This is intentionally *not* a Node-RED experiment. It is a **minimal, single-process** micro-benchmark used to validate the hypothesis that **uRDF accounts for most of the memory overhead** observed in the Node-RED runtime image experiments.

## Experimental design

### Key idea: same process, before vs after

A single Node.js process is started **without uRDF**.  
Later, uRDF is loaded dynamically **inside the same process**, so the difference can be attributed to uRDF’s module load + initialization.

### Trigger mechanism

The Node process waits for the creation of:

- `/tmp/load-urdf`

When this file appears, it executes:

- `require("urdf")`

Then it writes an ACK file:

- `/tmp/urdf-loaded`

This ACK enables deterministic memory sampling after uRDF has actually been loaded.

## Software artifacts

### Runner script

- [bench.sh](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest/bench.sh)

Responsibilities:
- build a Docker image for the benchmark app,
- start the container,
- sample baseline memory usage,
- trigger uRDF load,
- wait for ACK,
- sample memory again (twice) and keep the larger sample,
- write results to `mem_bench.csv`,
- cleanup container + temporary image.

### Benchmark app

Folder: [urdf-mem-bench/](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/urdf-memory-occupation-at-rest/urdf-mem-bench)

- [baseline.js](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest/urdf-mem-bench/baseline.js): the single-process trigger/ACK logic
- [Dockerfile](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest/urdf-mem-bench/Dockerfile): Node 20 slim image, installs dependencies, runs `baseline.js`
- [package.json](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest/urdf-mem-bench/package.json): pins uRDF to a specific git commit

Pinned dependency (from `package.json`):

- `urdf`: `git+https://github.com/vcharpenay/uRDF.js.git#94d482b4027f17142f745ffda9fc5b938c4fe9bb` ([link to commit](https://github.com/vcharpenay/uRDF.js/commit/94d482b4027f17142f745ffda9fc5b938c4fe9bb))

## How to run it

From the repository root:

```bash
cd experiments/urdf-memory-occupation-at-rest
bash bench.sh
```

### Output

The script writes:

- `mem_bench.csv`

with columns:

- `epoch`
- `baseline_bytes`
- `after_bytes`
- `delta_bytes`

## Results 

The only meaningful signal here is:

- **delta_bytes** = `after_bytes - baseline_bytes`

Because:
- the Node process is the same,
- the only change is dynamically loading uRDF,
- the measurement is taken *after* ACK confirms the module was required.

This repository currently contains one recorded measurement in [mem_bench.csv](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest/mem_bench.csv).

The below values come directly from `mem_bench.csv`.  
MiB values are computed as `bytes / 1024²`.

| Metric | Bytes | MiB |
|---|---:|---:|
| Baseline (before uRDF) | 6,905,921 | 6.59 |
| After `require("urdf")` | 29,569,843 | 28.20 |
| **Delta (uRDF overhead)** | **22,663,922** | **21.61** |

## Interpretation

Loading uRDF in an otherwise idle Node.js process increases memory usage by:

- **~21.61 MiB** (≈ 22,663,922 bytes)

This supports the hypothesis stated in the experiments overview that **uRDF accounts for the majority of the baseline memory overhead** observed in the [resource-utilization-at-rest experiment](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-at-rest).

## Notes / limitations

- `docker stats` reports cgroup memory usage, which may vary slightly across hosts and Docker versions.
- This experiment currently records a **single run**; if you want stronger confidence, repeat runs and compute mean/variance.
- The dependency is pinned to a specific uRDF commit; different versions may shift the delta.

## This experiment in context

You may be interested in understanding more about the place that this experiment occupies in the project.

In that case, the [README file of the experiments folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/README.md) would be a good starting point.
