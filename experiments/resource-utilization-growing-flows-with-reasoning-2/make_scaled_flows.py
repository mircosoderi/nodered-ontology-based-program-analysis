#!/usr/bin/env python3
"""make_scaled_flows_prefixed.py

Generate scaled Node-RED flows JSON by duplicating each 'tab' (flow) and its nodes,
rewriting IDs consistently, AND prefixing human-facing names to avoid cross-replica
inference explosions (e.g., same-name => sameAs rules).

Rules:
- IDs are rewritten for every duplicated object (exact-id mapping).
- For duplicates k>=2:
  - tab.label is prefixed with "[r{k}] "
  - node.name is prefixed with "[r{k}] "
  - (If a tab has 'name' field, it is prefixed too.)

Usage:
  python3 make_scaled_flows_prefixed.py --in nodered-default-flows.json --outdir ./scaled --factors 1,5,10,20
"""

import argparse
import json
import os
from copy import deepcopy
from typing import Any, Dict, List

def replace_ids(obj: Any, idmap: Dict[str, str]) -> Any:
    if isinstance(obj, str):
        return idmap.get(obj, obj)
    if isinstance(obj, list):
        return [replace_ids(x, idmap) for x in obj]
    if isinstance(obj, dict):
        return {k: replace_ids(v, idmap) for k, v in obj.items()}
    return obj

def prefix_names(batch_objs: List[dict], k: int) -> None:
    prefix = f"[r{k}] "
    for o in batch_objs:
        if not isinstance(o, dict):
            continue
        if o.get("type") == "tab":
            if isinstance(o.get("label"), str) and not o["label"].startswith(prefix):
                o["label"] = prefix + o["label"]
            if isinstance(o.get("name"), str) and not o["name"].startswith(prefix):
                o["name"] = prefix + o["name"]
        else:
            if isinstance(o.get("name"), str) and o["name"] and not o["name"].startswith(prefix):
                o["name"] = prefix + o["name"]

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--factors", required=True, help="Comma-separated, e.g. 1,5,10,20")
    args = ap.parse_args()

    with open(args.infile, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise SystemExit("Input flows must be a JSON array (Node-RED export format).")

    tabs = [o for o in data if isinstance(o, dict) and o.get("type") == "tab" and isinstance(o.get("id"), str)]
    tab_ids = [t["id"] for t in tabs]

    by_tab: Dict[str, List[dict]] = {tid: [] for tid in tab_ids}
    others: List[dict] = []
    for o in data:
        if not isinstance(o, dict):
            continue
        if o.get("type") == "tab":
            continue
        z = o.get("z")
        if isinstance(z, str) and z in by_tab:
            by_tab[z].append(o)
        else:
            others.append(o)

    os.makedirs(args.outdir, exist_ok=True)

    factors = [int(x.strip()) for x in args.factors.split(",") if x.strip()]
    base = os.path.splitext(os.path.basename(args.infile))[0]

    for factor in factors:
        if factor < 1:
            raise SystemExit("Factors must be >= 1")

        out: List[dict] = []
        out.extend(deepcopy(others))

        # Original once (no prefix)
        out.extend(deepcopy(tabs))
        for tid in tab_ids:
            out.extend(deepcopy(by_tab[tid]))

        for k in range(2, factor + 1):
            idmap: Dict[str, str] = {}
            batch_objs: List[dict] = []

            for tab in tabs:
                batch_objs.append(deepcopy(tab))
                batch_objs.extend(deepcopy(by_tab[tab["id"]]))

            for o in batch_objs:
                oid = o.get("id")
                if isinstance(oid, str):
                    idmap[oid] = f"{oid}_{k}"

            batch_objs = [replace_ids(o, idmap) for o in batch_objs]
            prefix_names(batch_objs, k)
            out.extend(batch_objs)

        outname = f"{base}.x{factor}.json"
        outpath = os.path.join(args.outdir, outname)
        with open(outpath, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print(outpath)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
