"""Build the contract v1 documents (plus v1.1 additions) for one scenario.

Pure except for the clock used in pipeline_events and generated_at. Same inputs and seed give
the same documents, apart from generated_at and the elapsed times in pipeline_events.
"""

import base64
import math
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime

import numpy as np

from argon.contract.model import (
    ARCHETYPE_IDS,
    ARCHETYPES,
    FLOOD_STATE_DEPTHS_M,
    LOSS_RATIOS,
    REPLACEMENT_USD_PER_M2,
    SOURCES,
    classify,
    envelope,
    height_class,
    median_pga_g,
)
from argon.contract.plan import default_plan, validate_plan
from argon.data.geo import ORIGIN, in_multipolygon, m_per_deg_lon
from argon.engine.cascade import Scenario, cvar99, simulate_case
from argon.engine.catalog import NODES, Fix
from argon.engine.exposure import water_level
from argon.engine.trace import cascade_trace

SCHEMA = "1.0"
GRID = {"cell_m": 25.0, "cols": 129, "rows": 129}
DURATION_S = 25.0
WAVE_ARRIVAL_S = 40.0
RUN_UP_SPEED_M_S = 2.5
RUN_UP_DECAY_M_PER_M = 0.0015  # water level drops 1.5 m per km inland
WET_M = 0.05
_M_PER_DEG_LAT = 111_132.0


def _b64(values: np.ndarray) -> str:
    return base64.b64encode(np.asarray(values, dtype="<f4").tobytes()).decode()


def _lonlat(east: float, north: float) -> list[float]:
    return [round(ORIGIN[1] + east / m_per_deg_lon(), 6), round(ORIGIN[0] + north / _M_PER_DEG_LAT, 6)]


def _enu(lat: float, lon: float) -> list[float]:
    return [round((lon - ORIGIN[1]) * m_per_deg_lon(), 1), round((lat - ORIGIN[0]) * _M_PER_DEG_LAT, 1)]


def normalize_buildings(raw: dict | list) -> list[dict]:
    """Accept the frontend bake ({buildings: [...]} with `centroid`) or contract v1 records."""
    items = raw["buildings"] if isinstance(raw, dict) else raw
    out = []
    for b in items:
        east, north = b.get("centroid_enu_m") or b["centroid"]
        height = float(b.get("height_m") or 12.0)
        out.append({**b, "centroid_enu_m": [float(east), float(north)],
                    "lonlat": b.get("lonlat") or _lonlat(east, north), "height_m": height,
                    "stories": b.get("stories") or max(1, round(height / 3.6))})
    return out


def _nearest(points: np.ndarray, targets: np.ndarray, max_m: float) -> np.ndarray:
    """Index of the nearest point to each target within max_m, else -1."""
    out = np.full(len(targets), -1)
    for i, t in enumerate(targets):
        d = np.hypot(points[:, 0] - t[0], points[:, 1] - t[1])
        j = int(np.argmin(d))
        if d[j] <= max_m:
            out[i] = j
    return out


def _zones(buildings: list[dict], neighborhoods: list[dict]) -> tuple[list[dict], np.ndarray]:
    names = []
    centers = []
    for n in neighborhoods:
        ring = n["coordinates"][0][0]
        centers.append((sum(p[1] for p in ring) / len(ring), sum(p[0] for p in ring) / len(ring)))
        names.append(n["name"])
    assigned = []
    for b in buildings:
        lon, lat = b["lonlat"]
        hit = next((n["name"] for n in neighborhoods if in_multipolygon(lon, lat, n["coordinates"])), None)
        if hit is None:  # outside every polygon (piers, fill): nearest neighborhood
            d = [math.hypot(lat - c[0], (lon - c[1]) * 0.79) for c in centers]
            hit = names[int(np.argmin(d))]
        assigned.append(hit)
    used = sorted(set(assigned))
    zones = [{"id": f"z{i}", "label": name} for i, name in enumerate(used)]
    return zones, np.array([used.index(a) for a in assigned])


def _wave_grid(xy: np.ndarray, ground: np.ndarray, level_navd88: float) -> dict:
    cell, cols, rows = GRID["cell_m"], GRID["cols"], GRID["rows"]
    origin = [-cell * cols / 2, -cell * rows / 2]
    cx = origin[0] + (np.arange(cols) + 0.5) * cell
    cy = origin[1] + (np.arange(rows) + 0.5) * cell
    gx, gy = np.meshgrid(cx, cy)  # [row, col]
    centers = np.column_stack([gx.ravel(), gy.ravel()])

    # Ground per cell: inverse-distance weighting of the 6 nearest footprint ground elevations.
    near_d = np.empty(len(centers))
    cell_ground = np.empty(len(centers))
    for start in range(0, len(centers), 2048):
        block = centers[start:start + 2048]
        d = np.hypot(block[:, None, 0] - xy[None, :, 0], block[:, None, 1] - xy[None, :, 1])
        idx = np.argpartition(d, 6, axis=1)[:, :6]
        dd = np.take_along_axis(d, idx, axis=1)
        w = 1.0 / np.maximum(dd, 5.0) ** 2
        cell_ground[start:start + 2048] = (w * ground[idx]).sum(axis=1) / w.sum(axis=1)
        near_d[start:start + 2048] = dd.min(axis=1)
    near_d = near_d.reshape(rows, cols)
    cell_ground = cell_ground.reshape(rows, cols)

    # Bay: cells far from any footprint and connected to the north or east edge.
    open_cells = near_d > 150
    water = np.zeros((rows, cols), dtype=bool)
    queue = deque()
    for r in range(rows):
        for c in range(cols):
            if open_cells[r, c] and (r == rows - 1 or c == cols - 1):
                water[r, c] = True
                queue.append((r, c))
    while queue:
        r, c = queue.popleft()
        for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if 0 <= nr < rows and 0 <= nc < cols and open_cells[nr, nc] and not water[nr, nc]:
                water[nr, nc] = True
                queue.append((nr, nc))

    # Run-up: flood land connected to the bay while the decaying water level exceeds ground.
    dist = np.full((rows, cols), -1.0)
    queue = deque()
    for r, c in zip(*np.nonzero(water), strict=True):
        dist[r, c] = 0.0
        queue.append((r, c))
    depth = np.zeros((rows, cols))
    while queue:
        r, c = queue.popleft()
        for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if 0 <= nr < rows and 0 <= nc < cols and dist[nr, nc] < 0 and not water[nr, nc]:
                d_m = dist[r, c] + cell
                h = level_navd88 - RUN_UP_DECAY_M_PER_M * d_m - cell_ground[nr, nc]
                if h > WET_M:
                    dist[nr, nc] = d_m
                    depth[nr, nc] = h
                    queue.append((nr, nc))
    wet = (~water) & (depth > WET_M)
    arrival = np.where(wet, WAVE_ARRIVAL_S + dist / RUN_UP_SPEED_M_S, -1.0)
    recede = np.where(wet, arrival + 120.0 + 180.0 * depth, -1.0)
    peak = np.where(wet, depth, 0.0)
    return {
        "origin": origin, "peak": peak, "arrival": arrival, "water": water,
        "doc": {
            "origin_enu_m": origin, "cell_m": cell, "cols": cols, "rows": rows,
            "encoding": "base64-float32-le",
            "layout": "index = row*cols + col; col increases east; row increases north",
            "arrival_s": _b64(arrival.ravel()), "peak_depth_m": _b64(peak.ravel()),
            "recede_s": _b64(recede.ravel()),
            "water_mask": _b64(water.ravel().astype(float)),  # v1.1: 1 = open bay water
        },
    }


def _cell_of(xy: np.ndarray, origin: list[float]) -> tuple[np.ndarray, np.ndarray]:
    cell = GRID["cell_m"]
    col = np.clip(((xy[:, 0] - origin[0]) // cell).astype(int), 0, GRID["cols"] - 1)
    row = np.clip(((xy[:, 1] - origin[1]) // cell).astype(int), 0, GRID["rows"] - 1)
    return row, col


def _pct(values: np.ndarray) -> dict:
    p10, p50, p90 = np.percentile(values, [10, 50, 90])
    return {"p10": round(float(p10), 0), "p50": round(float(p50), 0), "p90": round(float(p90), 0)}


def bake(snapshot: dict, neighborhoods: list[dict], buildings_input: dict | list,
         *, seed: int = 20261025, draws: int = 2000, magnitude: float = 7.0,
         tide_ft_mllw: float = 7.0, run_up_m: float = 2.0,
         planner: Callable[[dict], tuple[str, dict] | None] | None = None,
         url_ok: Callable[[str], bool] = lambda url: True) -> dict[str, object]:
    """`planner(context)` asks Argon (Gemini) for the fix plan and returns (source, raw plan).

    Its reply is validated by argon.contract.plan; on any failure the built-in plan is used.
    """
    t0 = time.perf_counter()
    events: list[dict] = []

    def log(node: str, status: str, message: str) -> None:
        events.append({"t_s": round(time.perf_counter() - t0, 3), "node": node, "status": status,
                       "message": message})

    for node in ("gov_data", "hazard_model", "monte_carlo", "failure_analysis", "fix_planning"):
        log(node, "queued", f"Queued {node.replace('_', ' ')}")
    stamp = datetime.now(UTC).isoformat(timespec="seconds")

    # --- gov_data: buildings, hazard areas, inventories, neighborhoods
    log("gov_data", "running", "Loading buildings and allowlisted government layers")
    buildings = normalize_buildings(buildings_input)
    n = len(buildings)
    xy = np.array([b["centroid_enu_m"] for b in buildings], dtype=float)
    ground = np.array([b["ground_elevation_m"] for b in buildings], dtype=float)
    stories = np.array([b["stories"] for b in buildings])
    in_hazard = np.array([any(in_multipolygon(b["lonlat"][0], b["lonlat"][1], z["coordinates"])
                              for z in snapshot["zones"]) for b in buildings])
    soft_open = np.zeros(n, dtype=bool)
    soft_points = [s for s in snapshot["soft_story"] if s["open"]]
    if soft_points:
        hit = _nearest(xy, np.array([_enu(s["lat"], s["lon"]) for s in soft_points]), 25.0)
        soft_open[hit[hit >= 0]] = True
    archetype_idx = np.array([classify(int(s), bool(h), bool(o))
                              for s, h, o in zip(stories, in_hazard, soft_open, strict=True)])
    zones, zone_idx = _zones(buildings, neighborhoods)
    area = np.array([b["footprint_area_m2"] for b in buildings], dtype=float)
    value = area * stories * np.array([REPLACEMENT_USD_PER_M2[height_class(int(s))] for s in stories])
    log("gov_data", "done", f"Loaded {n:,} buildings; {int(in_hazard.sum()):,} in DataSF seismic hazard "
                            f"areas, {int(soft_open.sum())} open soft-story, {len(zones)} neighborhoods")

    # --- hazard_model: shaking envelope and the composite wave
    log("hazard_model", "running", "Building shaking envelope and wave inundation grid")
    level = water_level(snapshot["datums"], tide_ft_mllw=tide_ft_mllw)
    level_navd88 = level["m_navd88"] + run_up_m
    grid = _wave_grid(xy, ground, level_navd88)
    row, col = _cell_of(xy, grid["origin"])
    depth = grid["peak"][row, col]
    arrival_at = grid["arrival"][row, col]
    wet_cells = int((grid["peak"] > 0).sum())
    log("hazard_model", "done", f"M{magnitude:.1f} shaking for {DURATION_S:.0f} s; wave at "
                                f"{level_navd88:.2f} m NAVD88 wets {wet_cells:,} grid cells and "
                                f"{int((depth > WET_M).sum()):,} buildings")

    # --- fix_planning: Argon (Gemini) proposes fixes and fragility; code validates them
    log("fix_planning", "running", "Asking Argon (Gemini) for fixes and archetype fragility"
        if planner else "Selecting built-in fixes")
    counts = {a: int((archetype_idx == i).sum()) for i, a in enumerate(ARCHETYPE_IDS)}
    flood_zones = sorted({zones[z]["id"] for z in zone_idx[depth > WET_M]})
    surge_m = max(0.0, level_navd88 - snapshot["datums"]["mhhw_navd88_m"])
    plan, note = None, "no planner configured"
    if planner is not None:
        baseline_nodes = simulate_case(Scenario(magnitude, surge_m, iterations=draws, seed=seed))
        context = {
            "recording_key": f"contract_m{magnitude:.1f}_tide{tide_ft_mllw:.1f}ft_runup{run_up_m:.1f}m",
            "scenario": {"magnitude": magnitude, "duration_s": DURATION_S,
                         "king_tide_ft_mllw": tide_ft_mllw, "tsunami_run_up_m": run_up_m,
                         "water_level_m_navd88": round(level_navd88, 2),
                         "buildings_wet": int((depth > WET_M).sum()), "buildings": n},
            "archetypes": [{"id": a[0], "label": a[1], "count": counts[a[0]],
                            "default_median_pga_g": a[5], "default_beta": a[6]} for a in ARCHETYPES],
            "flood_zones": [zones[int(z[1:])]["label"] for z in flood_zones],
            "nodes": [{"id": nd.id, "name": nd.name, "depends_on": nd.deps,
                       "baseline_failure_prob": round(float(baseline_nodes.failed[:, i].mean()), 3)}
                      for i, nd in enumerate(NODES)],
        }
        try:
            reply = planner(context)
            if reply:
                plan = validate_plan(reply[1], counts, flood_zones, url_ok)
                if plan:
                    plan.source = reply[0]
                else:
                    note = "no proposed fix passed validation"
            else:
                note = "no Gemini reply or recording"
        except Exception as exc:  # the demo must bake even when Gemini is unreachable
            note = f"{type(exc).__name__}: {exc}"
    if plan is None:
        plan = default_plan(counts, flood_zones)
    fix_list = plan.fixes
    f_count = len(fix_list)
    sourced = sum(f["evidence"] == "sourced" for f in fix_list)
    if plan.source == "fallback":
        log("fix_planning", "done", f"Using {f_count} built-in fixes ({note}); {sourced} with "
                                    f"government sources")
    else:
        verb = "Gemini proposed" if plan.source == "gemini" else "Replayed recorded Gemini plan:"
        log("fix_planning", "done", f"{verb} {plan.proposed} fixes; kept {f_count} fixes after "
                                    f"validation, {sourced} with verified government sources; "
                                    f"fragility set for {len(plan.archetypes)} archetypes")

    # --- monte_carlo: shared draws for every combo
    log("monte_carlo", "running", f"Running {draws:,} Monte Carlo draws for {2 ** f_count} fix combinations")
    rng = np.random.default_rng(seed)
    event_z = rng.standard_normal(draws)  # inter-event shaking variability, shared by buildings
    capacity_z = rng.standard_normal((draws, n))  # one draw per building per realization (CRN)
    pga = median_pga_g(magnitude, xy[:, 0], in_hazard)[None, :] * np.exp(0.3 * event_z)[:, None]
    fragility = {a[0]: plan.archetypes.get(a[0], {"median_pga_g": a[5], "beta": a[6]})
                 for a in ARCHETYPES}
    medians = np.array([fragility[a]["median_pga_g"] for a in ARCHETYPE_IDS])[archetype_idx]  # (n, 4)
    betas = np.array([fragility[a]["beta"] for a in ARCHETYPE_IDS])[archetype_idx]
    node_fixes = {f["bit"]: [Fix(f"{f['id']}:{nid}", f["label"], "Civil", nid, 0,
                                 f["effect"]["node_reduction_factor"]) for nid in f["applies_to_nodes"]]
                  for f in fix_list if f["applies_to_nodes"] and "node_reduction_factor" in f["effect"]}
    zone_ids = np.array([z["id"] for z in zones])[zone_idx]

    combos = {}
    for combo in range(2 ** f_count):
        chosen = [f for f in fix_list if combo >> f["bit"] & 1]
        factor = np.ones(n)
        flood_factor = np.ones(n)
        for f in chosen:
            if f["applies_to_archetypes"]:
                mask = np.isin(np.array(ARCHETYPE_IDS)[archetype_idx], f["applies_to_archetypes"])
                factor[mask] *= f["effect"].get("fragility_median_factor", 1.0)
            if f["applies_to_zones"] and "flood_depth_factor" in f["effect"]:
                flood_factor[np.isin(zone_ids, f["applies_to_zones"])] *= f["effect"]["flood_depth_factor"]
        shake = np.zeros((draws, n), dtype=np.int8)
        for k in range(4):
            x = np.log(pga / (medians[:, k] * factor)[None, :]) / betas[None, :]
            shake += (capacity_z < x).astype(np.int8)
        flood = np.searchsorted(FLOOD_STATE_DEPTHS_M, depth * flood_factor, side="right").astype(np.int8)
        state = np.maximum(shake, flood[None, :])
        building_loss = (LOSS_RATIOS[state] * value[None, :]).sum(axis=1)
        node_run = simulate_case(Scenario(magnitude, surge_m, iterations=draws, seed=seed),
                                 [fx for b, fxs in node_fixes.items() if combo >> b & 1 for fx in fxs])
        combos[combo] = {"state": state, "shake": shake, "flood": flood, "loss": building_loss,
                         "node_run": node_run, "infra_loss": node_run.losses * 1e6}
    log("monte_carlo", "done", f"Ran {draws:,} Monte Carlo draws × {2 ** f_count} combinations "
                               f"for {n:,} buildings and {len(NODES)} infrastructure nodes")

    # --- failure_analysis: representative draws, summaries, weak points, hotspots
    log("failure_analysis", "running", "Summarizing damage states, weak points and hotspots")
    base = combos[0]
    total0 = base["loss"] + base["infra_loss"]
    p50_draw = int(np.argmin(np.abs(total0 - np.percentile(total0, 50))))
    tail_draw = int(np.argmin(np.abs(total0 - cvar99(total0))))
    # The network trace replays the infrastructure model's own typical and 1-in-100 draws.
    infra0 = base["infra_loss"]
    net_draws = {"p50": int(np.argmin(np.abs(infra0 - np.percentile(infra0, 50)))),
                 "tail": int(np.argmin(np.abs(infra0 - cvar99(infra0))))}
    s0 = base["state"][p50_draw]
    ratio = pga[p50_draw] / medians[:, 0]
    shaking_onset = np.clip(3.0 + 12.0 / np.maximum(ratio, 1e-6), 3.0, DURATION_S)
    flood_first = base["flood"] >= base["shake"][p50_draw]
    dominant = np.where(s0 == 0, "none", np.where(flood_first & (base["flood"] > 0), "flood", "shaking"))
    onset = np.where(s0 == 0, -1.0, np.where(dominant == "flood", arrival_at + 2.0, shaking_onset))

    def _landmark(center: np.ndarray) -> str:
        best = min(NODES, key=lambda nd: math.dist(nodes_enu[nd.id], center))
        return best.name.replace("Illustrative ", "")

    def outcomes(draw: int) -> dict:
        return {str(c): {"state": v["state"][draw].astype(int).tolist(),
                         "cost_usd_mid": np.round(LOSS_RATIOS[v["state"][draw]] * value).astype(int).tolist()}
                for c, v in combos.items()}

    nodes_enu = {nd.id: _enu(nd.lat, nd.lon) for nd in NODES}
    node_row, node_col = _cell_of(np.array(list(nodes_enu.values())), grid["origin"])
    node_arrival = {nid: float(grid["arrival"][r, c]) for nid, r, c in
                    zip(nodes_enu, node_row, node_col, strict=True)}

    def timed_trace(combo: int, draw: int) -> dict:
        trace = cascade_trace(combos[combo]["node_run"], draw, baseline=base["node_run"])
        surge_led = {nd.id: nd.base_surge > nd.base_eq for nd in NODES}
        for e in trace["events"]:
            start = node_arrival[e["node_id"]] if surge_led[e["node_id"]] and node_arrival[e["node_id"]] > 0 \
                else 8.0
            depth_steps = round((e["t_s"] - 1.0) / 1.2)
            e["t_s"] = round(start + 6.0 * depth_steps, 1)
        trace["loss_usd"] = round(trace.pop("loss_m") * 1e6)
        return trace

    by_combo = {}
    for c, v in combos.items():
        state_p50 = v["state"][p50_draw]
        total = v["loss"] + v["infra_loss"]
        by_combo[str(c)] = {
            "counts_by_state": np.bincount(state_p50, minlength=5).tolist(),
            "total_loss_usd": _pct(v["loss"]),
            "est_collapse_count": _pct((v["state"] == 4).sum(axis=1)),
            "by_zone_counts_by_state": [np.bincount(state_p50[zone_idx == z], minlength=5).tolist()
                                        for z in range(len(zones))],
            "risk": {  # v1.1: buildings + infrastructure, the pitch's tail metrics
                "expected_loss_usd": round(float(total.mean())),
                "var99_usd": round(float(np.sort(total)[min(draws - 1, math.floor(draws * 0.99))])),
                "cvar99_usd": round(cvar99(total)),
                "building_expected_loss_usd": round(float(v["loss"].mean())),
                "infrastructure_expected_loss_usd": round(float(v["infra_loss"].mean())),
                "node_failure_probs": {nd.id: round(float(v["node_run"].failed[:, i].mean()), 4)
                                       for i, nd in enumerate(NODES)},
            },
            "cascade_trace": {k: timed_trace(c, d) for k, d in net_draws.items()},
        }

    mean_loss = (LOSS_RATIOS[base["state"]] * value[None, :]).mean(axis=0)
    collapse = (base["state"] == 4).mean(axis=0)
    # One weak-point group per fix that protects buildings: flood fixes cover the wet low
    # ground, building fixes cover their archetypes. Infrastructure fixes have no group.
    groups = []
    archetype_names = np.array(ARCHETYPE_IDS)[archetype_idx]
    for f in fix_list:
        if "flood_depth_factor" in f["effect"]:
            mask = depth > WET_M
        elif f["applies_to_archetypes"]:
            mask = np.isin(archetype_names, f["applies_to_archetypes"])
        else:
            continue
        gid = "g_" + f["id"].removeprefix("fix_").removeprefix("gx_")
        groups.append((gid, f.get("group_label") or f["label"], mask, f["id"]))
    fix_by_id = {f["id"]: f for f in fix_list}
    raw_scores = []
    weak = []
    for gid, label, mask, fix_id in groups:
        if not mask.any():
            continue
        group_loss = (LOSS_RATIOS[base["state"][:, mask]] * value[None, mask]).sum(axis=1)
        raw_scores.append(float(np.percentile(group_loss, 50)) * (1 + float(collapse[mask].mean())))
        fix = fix_by_id[fix_id]
        weak.append({
            "id": gid, "label": label,
            "archetype_ids": sorted({ARCHETYPE_IDS[i] for i in archetype_idx[mask]}),
            "building_count": int(mask.sum()),
            "expected_loss_usd": [round(float(np.percentile(group_loss, 10))),
                                  round(float(np.percentile(group_loss, 90)))],
            "fix_id": fix_id, "fix_cost_usd": fix["cost_usd"], "rationale": fix["rationale"],
            "evidence": fix["evidence"], "sources": fix["sources"],
            "hover_building_ids": np.nonzero(mask)[0].tolist(),
        })
    top = max(raw_scores) or 1.0
    for g, score in zip(weak, raw_scores, strict=True):
        g["priority_score"] = round(score / top, 3)
        g["priority"] = "high" if g["priority_score"] >= 0.66 else "medium" if g["priority_score"] >= 0.33 \
            else "low"
    weak.sort(key=lambda g: -g["priority_score"])

    hotspots = []
    order = np.argsort(-mean_loss)
    taken = np.zeros(n, dtype=bool)
    for i in order:
        if len(hotspots) == 6 or mean_loss[i] <= 0:
            break
        if taken[i]:
            continue
        near = np.hypot(xy[:, 0] - xy[i, 0], xy[:, 1] - xy[i, 1]) <= 180
        if near.sum() < 10 or any(np.hypot(*(np.array(h["center_enu_m"]) - xy[i])) < 360 for h in hotspots):
            continue
        w = mean_loss[near]
        center = (xy[near] * w[:, None]).sum(axis=0) / w.sum()
        flood_share = float((mean_loss[near] * (depth[near] > WET_M)).sum() / w.sum())
        mode = "flood" if flood_share > 0.5 else "shaking"
        hotspots.append({"id": f"h{len(hotspots) + 1}",
                         "label": f"{'Flooding' if mode == 'flood' else 'Shaking damage'} near "
                                  f"{_landmark(center)}",
                         "center_enu_m": [round(float(center[0]), 1), round(float(center[1]), 1)],
                         "radius_m": 180, "dominant_mode": mode,
                         "building_ids": np.nonzero(near)[0].tolist(), "_severity": float(w.sum())})
        taken |= near
    hotspots.sort(key=lambda h: -h.pop("_severity"))
    seen: dict[str, int] = {}
    for h in hotspots:  # make repeated landmark labels unique: "..., 2", "..., 3"
        seen[h["label"]] = seen.get(h["label"], 0) + 1
        if seen[h["label"]] > 1:
            h["label"] = f"{h['label']} ({seen[h['label']]})"
    if len(hotspots) < 3:
        raise ValueError(f"only {len(hotspots)} hotspots; contract needs 3 to 8")
    log("failure_analysis", "done", f"Found {len(weak)} weak-point groups and {len(hotspots)} hotspots; "
                                    f"baseline CVaR 0.99 ${by_combo['0']['risk']['cvar99_usd'] / 1e9:.2f}B")

    header = {"schema_version": SCHEMA, "seed": seed, "generated_at": stamp}
    scenario = {
        **header, "scenario_id": "preset_v1", "label": "Composite demonstration scenario",
        "disclaimer": "Composite demonstration scenario grounded in public government data. Not a "
                      "forecast. Wave depth and arrival are screening heuristics.",
        "earthquake": {"magnitude": magnitude, "duration_s": DURATION_S,
                       "envelope": envelope(DURATION_S, magnitude), "dominant_freq_hz": 1.2},
        "wave": {"arrival_s": WAVE_ARRIVAL_S,
                 "water_level_m_navd88": round(level_navd88, 3),
                 "king_tide_ft_mllw": tide_ft_mllw, "tsunami_run_up_m": run_up_m,
                 "inundation_grid": grid["doc"]},
        "sources": [SOURCES[k] for k in ("tsunami", "tides", "footprints", "seismic_zones", "waterfront")],
    }
    damage = {
        **header, "building_ids": [b["id"] for b in buildings],
        "archetype_idx": archetype_idx.tolist(), "zone_idx": zone_idx.tolist(),
        "onset_s": np.round(onset, 1).tolist(), "dominant_mode": dominant.tolist(),
        "representative_draws": {"p50": p50_draw, "tail": tail_draw, "network": net_draws},  # v1.1
        "outcomes": outcomes(p50_draw),
        "outcomes_tail": outcomes(tail_draw),  # v1.1: the 1-in-100 realization
    }
    summary = {
        **header, "price_year": 2026, "zones": zones,
        "archetypes": [{"id": a[0], "label": a[1],
                        "rationale": plan.archetypes.get(a[0], {}).get("rationale") or
                        "Default archetype by height class, mapped hazard area and "
                        "soft-story status; year built and material are not in the data.",
                        "evidence": "inferred", "sources": [SOURCES["seismic_zones"]],
                        "fragility": {"median_pga_g": fragility[a[0]]["median_pga_g"],  # v1.1
                                      "beta": fragility[a[0]]["beta"],
                                      "set_by": "gemini" if a[0] in plan.archetypes else "built-in"}}
                       for a in ARCHETYPES],
        "plan": {"source": plan.source, "proposed": plan.proposed,  # v1.1: where the fixes came from
                 "rejected": plan.rejected},
        "fixes": fix_list, "by_combo": by_combo, "weak_point_groups": weak, "hotspots": hotspots,
        "network": {  # v1.1: the natech cascade graph
            "nodes": [{"id": nd.id, "name": nd.name, "centroid_enu_m": nodes_enu[nd.id]} for nd in NODES],
            "edges": [{"from": up, "to": nd.id, "weight": w} for nd in NODES for up, w in nd.deps.items()],
        },
    }
    return {"buildings.json": buildings_input, "scenario.json": scenario,
            "buildings_damage.json": damage, "summary.json": summary, "pipeline_events.json": events}
