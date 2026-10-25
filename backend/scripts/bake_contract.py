"""Write the contract v1 documents to ../public/data and check the frontend invariants.

    uv run python scripts/bake_contract.py                      # preset scenario
    uv run python scripts/bake_contract.py --buildings path.json  # key to the frontend bake
"""

import argparse
import json
import sys
from pathlib import Path

from argon.contract.bake import bake
from argon.contract.check import violations
from argon.data.snapshot import load_snapshot

BACKEND = Path(__file__).resolve().parents[1]
OUT = BACKEND.parent / "public" / "data"

parser = argparse.ArgumentParser()
parser.add_argument("--buildings", type=Path, 
                    help="frontend buildings.json; default derives it from scene.json")
parser.add_argument("--draws", type=int, default=2000)
parser.add_argument("--magnitude", type=float, default=7.0)
parser.add_argument("--tide-ft-mllw", type=float, default=7.0)
parser.add_argument("--run-up-m", type=float, default=2.0)
args = parser.parse_args()

scene = json.loads((OUT / "scene.json").read_text())
hoods = json.loads((BACKEND / "data" / "neighborhoods.json").read_text())["neighborhoods"]
buildings = json.loads(args.buildings.read_text()) if args.buildings else None
docs = bake(scene, load_snapshot(), hoods, buildings, draws=args.draws, magnitude=args.magnitude,
            tide_ft_mllw=args.tide_ft_mllw, run_up_m=args.run_up_m)
problems = violations(docs)
if problems:
    sys.exit("Invariant violations:\n" + "\n".join(problems))
for name, doc in docs.items():
    if name == "buildings.json" and args.buildings:
        continue  # never overwrite the frontend's own file
    (OUT / name).write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False))
    print(f"{name}: {(OUT / name).stat().st_size:,} bytes")
