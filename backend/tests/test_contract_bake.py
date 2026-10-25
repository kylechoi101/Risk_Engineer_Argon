import json
from pathlib import Path

import numpy as np
import pytest

from argon.contract.bake import bake
from argon.contract.check import violations
from argon.data.snapshot import load_snapshot

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_BUILDINGS = json.loads((ROOT / "public/data/buildings.json").read_text())
HOODS = json.loads((ROOT / "backend/data/neighborhoods.json").read_text())["neighborhoods"]


def small_district():
    """Every 8th building of the frontend bake, renumbered 0..N-1 like a real bake."""
    picked = FRONTEND_BUILDINGS["buildings"][::8]
    return {**FRONTEND_BUILDINGS, "building_count": len(picked),
            "buildings": [{**b, "id": i} for i, b in enumerate(picked)]}


@pytest.fixture(scope="module")
def docs():
    return bake(load_snapshot(), HOODS, small_district(), draws=200)


def test_bake_passes_every_frontend_invariant(docs):
    assert violations(docs) == []


def test_bake_is_deterministic_apart_from_timestamps():
    def strip(d):
        d = json.loads(json.dumps(d))
        for doc in d.values():
            if isinstance(doc, dict):
                doc.pop("generated_at", None)
        d.pop("pipeline_events.json")
        return d
    a = bake(load_snapshot(), HOODS, small_district(), draws=100)
    b = bake(load_snapshot(), HOODS, small_district(), draws=100)
    assert strip(a) == strip(b)


def test_fixes_lower_tail_risk_and_pipeline_events_are_complete(docs):
    combos = docs["summary.json"]["by_combo"]
    everything = str(2 ** len(docs["summary.json"]["fixes"]) - 1)
    assert combos[everything]["risk"]["cvar99_usd"] < combos["0"]["risk"]["cvar99_usd"]
    events = docs["pipeline_events.json"]
    assert [e["t_s"] for e in events] == sorted(e["t_s"] for e in events)
    done = {e["node"] for e in events if e["status"] == "done"}
    assert done == {"gov_data", "hazard_model", "monte_carlo", "failure_analysis", "fix_planning"}


def test_checker_catches_a_fix_that_makes_things_worse(docs):
    broken = json.loads(json.dumps(docs))
    state = broken["buildings_damage.json"]["outcomes"]["1"]["state"]
    state[0] = 4
    broken["buildings_damage.json"]["outcomes"]["0"]["state"][0] = 0
    assert any(v.startswith("3:") for v in violations(broken))
    assert np.array(state).max() == 4


def test_reads_the_frontend_bake_shape_and_never_rewrites_it(docs):
    district = small_district()
    assert docs["buildings.json"] == district  # passed through untouched, only used for checks
    assert docs["buildings_damage.json"]["building_ids"] == [b["id"] for b in district["buildings"]]
