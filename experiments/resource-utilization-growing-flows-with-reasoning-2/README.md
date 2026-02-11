
# Experiment Logbook — Lightweight Semantic Reasoning Scalability

This document describes a coherent set of experiments conducted to understand how the lightweight semantic reasoning system behaves when the size of the Node-RED application increases.

## Setup

We started from:

- [5 Node-RED flows](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/resource-utilization-growing-flows-with-reasoning-2/nodered-default-flows.json)
- 5 rules ([readable](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/nodered-urdf/rules.jsonld), [flattened and compressed](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/resource-utilization-growing-flows-with-reasoning-2/rules.flattened.compressed.jsonld)):
  - 3 SPARQL-only
  - 2 SPARQL + N3

To test scalability, we created [replicated versions of the original flows](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-growing-flows-with-reasoning-2/results/20260208-130607/scaled_flows).

Scaling factors tested:

| Factor | Meaning |
|--------|---------|
| 1 | Original flows |
| 2 | Double the flows |
| 4 | 4× flows |
| 8 | 8× flows |
| 16 | 16× flows |

## Problem in initial tests: inference explosion

### What happened

In the first attempt, flows were duplicated without modifying their names.

One of the inference rules that we used in the experiment states:

If two resources have the same name, they are considered the same (sameAs).

When flows were replicated, names remained identical across replicas.

This created cross-replica equivalence relations and produced a combinatorial growth of inferred triples.

### Why this was wrong

We were not measuring scalability of reasoning.

We were measuring the side effects of name collisions.

### Fix

The scaling script was modified so that each replica prefixes:

- Flow label → [rK] original\_label
- Node name → [rK] original\_name

This restored semantic independence between replicas.

### Artifacts

[Initial flow scaling script](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/resource-utilization-growing-flows-with-reasoning-2/make_scaled_flows.py.old)
[Results obtained when using the initial flow scaling script](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-growing-flows-with-reasoning-2/results/20260208-122223)
[Improved flow scaling script](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/blob/main/experiments/resource-utilization-growing-flows-with-reasoning-2/make_scaled_flows.py)
[Results obtained when using the improved flow scaling script](https://github.com/mircosoderi/nodered-ontology-based-program-analysis/tree/main/experiments/resource-utilization-growing-flows-with-reasoning-2/results/20260208-130607)

## Experimental Procedure

For each scaling factor:

1. Generate scaled flows with prefixed names.
2. Deploy them via [Node-RED API](https://nodered.org/docs/api/admin/methods/post/flows/).
3. The deployment triggers the reasoning (deploy cycle).
4. Measure:
   - End-to-end reload time including reasoning (t\_reload\_ms)
   - Rule execution times (t\_rule\_ms)
   - Triple counts via the GET /urdf/size endpoint exposed by the runtime plugin:
     - Application graph size
     - Inferred graph size

## How App Data Scales

| Factor | size\_app |
|--------|----------|
| 1 | 662 |
| 2 | 1323 |
| 4 | 2645 |
| 8 | 5289 |
| 16 | 10577 |

Observation: The number of triples in the knowledge graph that represents the user application grows linearly with the size of the user application.

## How Inferred Graph Scales

| Factor | size\_inferred |
|--------|---------------|
| 1 | 142 |
| 2 | 284 |
| 4 | 568 |
| 8 | 1136 |
| 16 | 2272 |

| Factor | inferred/app |
|--------|--------------|
| 1 | 0.21 |
| 2 | 0.21 |
| 4 | 0.21 |
| 8 | 0.21 |
| 16 | 0.21 |

Observation: The number of the inferred triples grows linearly with the size of the user application, and the ratio between the number of the inferred triples and the number of triples that represent the user application remains constant as the size of the application grows.

This is expected, and it is the measurement that allowed to identify that there was something odd in the beginning (initial problem described above).

The linear growth of the graph of the inferred triples and the inferred/app ratio that remains constant confirms indeed that, as expected:
- Each replica contributes independently.
- No cross-replica explosion remains.
- Inference cost *can* scale proportionally.

## End-to-End Reasoning Time

| Factor | size\_app | t\_reload\_ms |
|--------|----------|-------------|
| 1 | 662 | 85.9 |
| 2 | 1323 | 94.7 |
| 4 | 2645 | 109.8 |
| 8 | 5289 | 135.2 |
| 16 | 10577 | 186.4 |

Observations:

- Time increases smoothly.
- No instability.
- Even at 10k+ triples, full reasoning < 200 ms.

If we compute the reasoning time divided by the number of triples in the representation of the user application, we obtain:

| Factor | ms per app triple |
|--------|-------------------|
| 1 | 0.130 |
| 2 | 0.072 |
| 4 | 0.042 |
| 8 | 0.026 |
| 16 | 0.018 |

Observation:

- Per-triple cost decreases as scale increases.
- Fixed overhead is amortized as the application grows in size.

## Rule-Level Breakdown

Dominant rule:

- anyresource-same-schema-name-sameAs (SPARQL-only)

Across scales:

- ~60% of rule time from the dominant rule.
- ~25–30% from SPARQL+N3 rules combined.
- Remaining rules minor.

## What This Experiment Demonstrates

- Controlled semantic scaling produces linear growth.
- Inference remains proportional when semantic isolation is enforced.
- Hybrid SPARQL + N3 reasoning *can* run inside Node-RED while remaining lightweight.
- End-to-end reasoning remains under 200 ms at tested scale.
- Cost structure remains stable across scaling levels.

## What This Experiment Does NOT Demonstrate

- Worst-case theoretical complexity.
- Performance beyond tested scale (~10k triples).
- Behavior under arbitrary rule sets.
- Global reasoning effects without namespace isolation.
