"""Contract v1 section 6 invariants: the checks the frontend runs on load."""

import base64

import numpy as np


def _floats(b64: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64), dtype="<f4")


def violations(docs: dict) -> list[str]:
    found = []
    buildings = docs["buildings.json"]
    buildings = buildings["buildings"] if isinstance(buildings, dict) else buildings
    damage, summary, scenario = docs["buildings_damage.json"], docs["summary.json"], docs["scenario.json"]
    ids = sorted(b["id"] for b in buildings)
    n = len(ids)
    f = len(summary["fixes"])
    combos = [str(c) for c in range(2 ** f)]

    # 1. ids match, equal-length arrays
    if damage["building_ids"] != ids:
        found.append("1: building_ids differ from buildings.json ids")
    for key in ("archetype_idx", "zone_idx", "onset_s", "dominant_mode"):
        if len(damage[key]) != n:
            found.append(f"1: {key} has {len(damage[key])} entries, expected {n}")
    for c, o in damage["outcomes"].items():
        if len(o["state"]) != n or len(o["cost_usd_mid"]) != n:
            found.append(f"1: outcomes[{c}] arrays are not length {n}")
    # 2. valid ranges
    states = {c: np.array(o["state"]) for c, o in damage["outcomes"].items()}
    if any(((s < 0) | (s > 4)).any() for s in states.values()):
        found.append("2: a state is outside 0..4")
    if not all(0 <= z < len(summary["zones"]) for z in damage["zone_idx"]):
        found.append("2: zone_idx out of range")
    if not all(0 <= a < len(summary["archetypes"]) for a in damage["archetype_idx"]):
        found.append("2: archetype_idx out of range")
    # 3. a fix never makes a building worse
    base = states.get("0")
    for c, s in states.items():
        if base is not None and (s > base).any():
            found.append(f"3: combo {c} is worse than combo 0 for {(s > base).sum()} buildings")
    # 4. counts match state arrays
    for c, entry in summary["by_combo"].items():
        counts = entry["counts_by_state"]
        if sum(counts) != n or (c in states and counts != np.bincount(states[c], minlength=5).tolist()):
            found.append(f"4: counts_by_state for combo {c} does not match its states")
    # 5. combo keys
    if sorted(damage["outcomes"], key=int) != combos or sorted(summary["by_combo"], key=int) != combos:
        found.append("5: combo keys do not cover 0..2^F-1 in both files")
    # 6. fix ids and bits
    fix_ids = {x["id"] for x in summary["fixes"]}
    bits = [x["bit"] for x in summary["fixes"]]
    if len(set(bits)) != len(bits) or sorted(bits) != list(range(f)):
        found.append("6: fix bits are not unique 0..F-1")
    for g in summary["weak_point_groups"]:
        if g["fix_id"] not in fix_ids:
            found.append(f"6: weak point group {g['id']} names unknown fix {g['fix_id']}")
    # 7. grid sizes
    grid = scenario["wave"]["inundation_grid"]
    for key in ("arrival_s", "peak_depth_m", "recede_s"):
        if len(_floats(grid[key])) != grid["cols"] * grid["rows"]:
            found.append(f"7: grid {key} does not decode to cols*rows floats")
    # 8. one zone and one archetype per building (scalar indices guarantee "exactly one")
    if len(damage["zone_idx"]) != n or len(damage["archetype_idx"]) != n:
        found.append("8: a building lacks a zone or archetype")
    return found
