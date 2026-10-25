"""Refresh backend/data/snapshot.json from DataSF and NOAA.

    uv run python scripts/build_snapshot.py           # fetch fresh sources
    uv run python scripts/build_snapshot.py --cached  # rebuild from data/raw/
"""

import argparse
import datetime
import json
from pathlib import Path

from argon.data.snapshot import SNAPSHOT_PATH, build_snapshot
from argon.data.sources import fetch_raw

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"

parser = argparse.ArgumentParser()
parser.add_argument("--cached", action="store_true", help="reuse data/raw/ instead of fetching")
args = parser.parse_args()

if args.cached:
    raw = {p.stem: json.loads(p.read_text()) for p in RAW.glob("*.json")}
else:
    raw = fetch_raw()
    RAW.mkdir(parents=True, exist_ok=True)
    for name, payload in raw.items():
        (RAW / f"{name}.json").write_text(json.dumps(payload))

snapshot = build_snapshot(raw, collected=datetime.date.today().isoformat())
SNAPSHOT_PATH.write_text(json.dumps(snapshot, separators=(",", ":")))
print(f"{len(snapshot['footprints'])} footprints, {len(snapshot['tall_buildings'])} tall, "
      f"{len(snapshot['soft_story'])} soft-story, {len(snapshot['zones'])} zones -> "
      f"{SNAPSHOT_PATH.stat().st_size:,} bytes")
