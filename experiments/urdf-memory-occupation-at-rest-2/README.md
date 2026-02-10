# uRDF Optimization via Forking: Memory Occupation at Rest (v2)

## What this experiment is about

This experiment repeats the [urdf-memory-occupation-at-rest experiment](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/urdf-memory-occupation-at-rest) after applying the uRDF optimization strategy described in the experiments overview (forking + reduced features).

The purpose is to answer:

> **After the uRDF fork/optimizations, how much additional RAM is consumed when uRDF is loaded in an otherwise idle Node.js process?**

This is a minimal micro-benchmark (not Node-RED) designed to quantify the **baseline memory delta attributable to uRDF loading**.

## What changed compared to the previous uRDF baseline experiment

This version uses the [forked uRDF repository](https://github.com/mircosoderi/uRDF.js) pinned to a specific commit:

- `urdf`: `git+https://github.com/mircosoderi/uRDF.js.git#2039e21c323ca4797344668eb0bea7c8c6b66f1a` ([link to commit](https://github.com/mircosoderi/uRDF.js/commit/2039e21c323ca4797344668eb0bea7c8c6b66f1a))

and loads:

- `require("urdf/src/urdf-module-strict.js")`

(i.e., the “strict” module entry used by the optimized uRDF approach).

## Experimental design

### Single-process “before vs after” in the same container

A single Node.js process is started with **no uRDF loaded**.  
uRDF is then loaded **inside the same process** so that the delta can be attributed to module load + initialization.

### Deterministic trigger + ACK

The Node process:

- waits for a trigger file: `/tmp/load-urdf`
- on trigger, loads uRDF in-process
- writes an ACK file: `/tmp/urdf-loaded`

This allows memory sampling **only after** uRDF has certainly been loaded.

## Software artifacts

Folder: [experiments/urdf-memory-occupation-at-rest-2](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/urdf-memory-occupation-at-rest-2)

- [bench.sh](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest-2/bench.sh)  
  Runs the full benchmark: build image, start container, sample baseline memory, trigger uRDF load, wait for ACK, sample memory again, compute delta, write CSV.

- [urdf-mem-bench/](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/urdf-memory-occupation-at-rest-2/urdf-mem-bench)
  - [baseline.js](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest-2/urdf-mem-bench/baseline.js) (trigger + ACK logic; loads `urdf-module-strict.js`)
  - [Dockerfile](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest-2/urdf-mem-bench/Dockerfile)
  - [package.json](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest-2/urdf-mem-bench/package.json)

- [mem_bench.csv](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest-2/mem_bench.csv)  
  The recorded result of one benchmark execution.

## How the result is produced (processing details)

[bench.sh](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest-2/bench.sh):

1. Builds a temporary image from [urdf-mem-bench/](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/urdf-memory-occupation-at-rest-2/urdf-mem-bench)
2. Starts the container and waits ~1s for Node startup
3. Samples baseline memory using:

   ```bash
   docker stats --no-stream --format "{{.MemUsage}}"
   ```

   It parses the “used” part of `used / limit` and converts units to bytes.

4. Triggers uRDF load by creating `/tmp/load-urdf` in the container.
5. Waits until `/tmp/urdf-loaded` exists (ACK from `baseline.js`).
6. Samples memory twice (0.5s apart) and keeps the larger sample.
7. Computes `delta_bytes` and writes the record to [mem_bench.csv](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest-2/mem_bench.csv).

## How to run it

From the repository root:

```bash
cd experiments/urdf-memory-occupation-at-rest-2
bash bench.sh
```

### Output

- [mem_bench.csv](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest-2/mem_bench.csv)

Columns:

- `epoch`
- `baseline_bytes`
- `after_bytes`
- `delta_bytes`

## Results 

The meaningful signal is the memory delta:

- `delta_bytes = after_bytes - baseline_bytes`

Because:
- the same Node process is used before and after,
- the only intended change is loading uRDF,
- sampling is gated by `/tmp/urdf-loaded` ACK.

This repository includes one recorded run in [mem_bench.csv](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/urdf-memory-occupation-at-rest-2/mem_bench.csv).

Values reported here below come from that file.

MiB values are computed as `bytes / 1024²`.

| Metric | Bytes | MiB |
|---|---:|---:|
| Baseline (before uRDF) | 6,910,115 | 6.590 |
| After `require("urdf-module-strict")` | 10,330,570 | 9.852 |
| **Delta (uRDF overhead)** | **3,420,455** | **3.262** |

## Interpretation

After applying the uRDF optimization strategy (fork + strict module that does not include jsonld and io imports), loading uRDF increases memory usage by only **~3.262 MiB** (≈ 3,420,455 bytes)

This is consistent with the experiments overview claim that the fork reduced baseline overhead to only a few MiB (as opposed to the ~22 MiB observed in the [original uRDF baseline experiment](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/urdf-memory-occupation-at-rest)).

## Notes / limitations

- This folder currently contains a **single recorded run**. For stronger confidence:
  - run `bench.sh` multiple times,
  - store multiple records,
  - compute mean/variance.

- `docker stats` reports cgroup memory usage; absolute values can shift with Docker/host versions, but the **within-run delta** remains the main signal.

## This experiment in context

You may be interested in understanding more about the place that this experiment occupies in the project.

In that case, the [README file of the experiments folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/README.md) would be a good starting point.
