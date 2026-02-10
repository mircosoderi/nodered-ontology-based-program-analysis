# Decomposing uRDF Memory Usage (At Rest)

## What this experiment is about

This experiment decomposes the **baseline memory overhead** introduced by uRDF by loading uRDF’s “baseline-heavy” components **one by one** in an otherwise minimal Node.js process.

The goal is to answer:

> **Which uRDF dependencies / initialization steps account for most of the memory increase observed when uRDF is loaded?**

This experiment is meant to complement the [urdf-memory-occupation-at-rest experiment](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/urdf-memory-occupation-at-rest) by attributing the memory delta to specific components.

## Experimental design

### Single-process, incremental loading

A single Node.js process is started in a container. Memory is measured:

1. **Before loading any uRDF-related modules** (baseline)
2. After each incremental “trigger” that loads one additional component

The process keeps references to loaded modules/objects so that allocations remain reachable and are not immediately garbage-collected.

### Triggers (t1–t5)

The triggers correspond to the lines noted as “baseline-heavy” in uRDF’s module initialization:

- **t1** → `require("jsonld")` (+ `processor = jsonld.promises`)
- **t2** → `require("sparqljs")`
- **t3** → `require("urdf/src/io.js")`
- **t4** → `new sparqljs.Parser()`
- **t5** → `require("urdf/src/urdf.js") + new urdf.Store()`

These are implemented in [baseline-harness.js](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/decompose-urdf-memory-occupation-at-rest/baseline-harness.js) and exposed through a tiny HTTP server:

- `GET /health`
- `GET /trigger?t=t1|t2|t3|t4|t5`

## Software artifacts

Folder: [experiments/decompose-urdf-memory-occupation-at-rest](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/decompose-urdf-memory-occupation-at-rest)

- [measure-baseline.sh](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/decompose-urdf-memory-occupation-at-rest/measure-baseline.sh)  
  Builds the image, runs the container, triggers each step, and samples memory using `docker stats`.

- [baseline-harness.js](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/decompose-urdf-memory-occupation-at-rest/baseline-harness.js)  
  Node.js HTTP harness that performs the incremental loading steps and keeps references in memory.

- [Dockerfile](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/decompose-urdf-memory-occupation-at-rest/Dockerfile), [package.json](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/decompose-urdf-memory-occupation-at-rest/package.json)  
  Define the minimal Node environment and dependencies used for the benchmark.

- [measure-baseline.sh.out.txt](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/decompose-urdf-memory-occupation-at-rest/measure-baseline.sh.out.txt)  
  A captured example output from a full run, including the final result table.

## How to run it

From the repository root:

```bash
cd experiments/decompose-urdf-memory-occupation-at-rest
bash measure-baseline.sh | tee measure-baseline.local.out.txt
```

### What you should see

- The script builds a local image (`urdf-baseline-measure:local`)
- Runs a container (`urdf_baseline_measure`)
- Waits until `/health` is available
- Triggers `t1..t5` sequentially
- Prints a result table in MiB
- Cleans up the container

## Results 

This experiment is designed to produce one primary artifact:

- The **per-step memory deltas** relative to baseline

The meaningful outputs are:

1. **baseline MiB** (container memory usage before any trigger)
2. **Mem MiB after each trigger**
3. **Delta MiB** = `Mem(step) - Mem(previous step)` (as printed by the script)

The “story” lives entirely in the *step-to-step deltas*.

The repository includes one captured run in [measure-baseline.sh.out.txt](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/decompose-urdf-memory-occupation-at-rest/measure-baseline.sh.out.txt).
The numbers below are taken directly from that file.

All units are **MiB**.

| Step | Operation | Mem (MiB) | Delta (MiB) |
|---:|---|---:|---:|
| baseline | (no uRDF components loaded) | 7.043 | — |
| t1 | `require("jsonld")` (+ `jsonld.promises`) | 23.980 | **+16.937** |
| t2 | `require("sparqljs")` | 24.250 | +0.270 |
| t3 | `require("urdf/src/io.js")` | 27.770 | **+3.520** |
| t4 | `new sparqljs.Parser()` | 27.780 | +0.010 |
| t5 | `require("urdf/src/urdf.js") + new urdf.Store()` | 27.820 | +0.040 |

## How the numbers are produced (processing details)

[measure-baseline.sh](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/decompose-urdf-memory-occupation-at-rest/baseline-harness.js) samples container memory like this:

1. Calls:

   ```bash
   docker stats --no-stream --format "{{.MemUsage}}" urdf_baseline_measure
   ```

2. Extracts the **used** part of the `used / limit` string
3. Converts units (B, KiB, MiB, GiB) to **MiB** via the `to_mib()` helper
4. Computes deltas step-by-step as shown in the printed table

The script triggers steps via HTTP:

```bash
curl "http://127.0.0.1:3000/trigger?t=t1"
```

…and repeats for `t2..t5`.

## Interpretation

### 1) `jsonld` dominates the baseline overhead
The largest single memory jump is:

- **+16.937 MiB** at **t1** (`jsonld` + `jsonld.promises`)

This indicates that JSON-LD processing support is the main contributor to uRDF’s baseline memory footprint (in this measured setup).

### 2) `io` is the second meaningful contributor
The next material increase is:

- **+3.520 MiB** at **t3** (uRDF `io.js`)

### 3) SPARQL parser instantiation and store creation are negligible at rest
The remaining steps add essentially nothing in this measurement:

- `sparqljs` require: +0.270 MiB
- `new Parser()`: +0.010 MiB
- `new Store()`: +0.040 MiB

## This experiment in context

You may be interested in understanding more about the place that this experiment occupies in the project.

In that case, the [README file of the experiments folder](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/README.md) would be a good starting point.

