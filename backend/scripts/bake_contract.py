"""Write the contract v1 documents to ../public/data and check the frontend invariants.

    uv run python scripts/bake_contract.py    # keyed to public/data/buildings.json (frontend bake)
"""

import argparse
import asyncio
import json
import os
import sys
from functools import lru_cache
from pathlib import Path
from urllib.request import Request, urlopen

from dotenv import load_dotenv

from argon.agent.agents import RecordedAgent, make_agent
from argon.contract.bake import bake
from argon.contract.check import violations
from argon.data.snapshot import load_snapshot

BACKEND = Path(__file__).resolve().parents[1]
OUT = BACKEND.parent / "public" / "data"

parser = argparse.ArgumentParser()
parser.add_argument("--buildings", type=Path, default=OUT / "buildings.json",
                    help="frontend buildings.json to key the damage files to")
parser.add_argument("--draws", type=int, default=2000)
parser.add_argument("--magnitude", type=float, default=7.0)
parser.add_argument("--tide-ft-mllw", type=float, default=7.0)
parser.add_argument("--run-up-m", type=float, default=2.0)
parser.add_argument("--no-gemini", action="store_true", help="use recordings or built-in fixes only")
args = parser.parse_args()

hoods = json.loads((BACKEND / "data" / "neighborhoods.json").read_text())["neighborhoods"]
buildings = json.loads(args.buildings.read_text())
load_dotenv(BACKEND / ".env")
agent = make_agent(os.environ)
replay = RecordedAgent()


def planner(context: dict):
    """Live Gemini when a key is set (recorded if ARGON_RECORD=1), else a saved recording."""
    if agent.mode == "live" and not args.no_gemini:
        try:
            return "gemini", asyncio.run(agent.plan_contract(context))
        except Exception as exc:
            print(f"Gemini plan failed ({type(exc).__name__}: {exc}); trying a recording", file=sys.stderr)
    plan = asyncio.run(replay.plan_contract(context))
    return ("recorded", plan) if plan else None


@lru_cache(maxsize=64)
def url_ok(url: str) -> bool:
    """Keep a source link only if it answers HTTP 200 right now."""
    try:
        with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0 argon-bake"}), timeout=8) as r:
            return r.status == 200
    except Exception:
        return False


docs = bake(load_snapshot(), hoods, buildings, draws=args.draws, magnitude=args.magnitude,
            tide_ft_mllw=args.tide_ft_mllw, run_up_m=args.run_up_m, planner=planner, url_ok=url_ok)
plan = docs["summary.json"]["plan"]
print(f"fix plan: {plan['source']} ({plan['proposed']} proposed, {len(plan['rejected'])} rejected)")
problems = violations(docs)
if problems:
    sys.exit("Invariant violations:\n" + "\n".join(problems))
for name, doc in docs.items():
    if name == "buildings.json":
        continue  # the frontend bake owns this file; never overwrite it
    (OUT / name).write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False))
    print(f"{name}: {(OUT / name).stat().st_size:,} bytes")
