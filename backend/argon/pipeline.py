"""Run one analysis as a sequence of (event, payload) pairs, and re-run saved runs.

The stages follow docs/api.md. Agent and data failures degrade to fallbacks and are reported
as `error` events with fallback_used=true; anything else ends the stream with an error.
"""

import asyncio
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass, field

from argon.agent.agents import Agent, RecordedAgent
from argon.agent.parse import parse_prompt
from argon.agent.validate import validate_fixes
from argon.data.geo import METERS_PER_MILE
from argon.data.provider import LayerProvider, datums
from argon.engine.buildings import building_summary, damage_probabilities
from argon.engine.cascade import Scenario, run_simulation, simulate_case, summarize
from argon.engine.catalog import CATALOG_FIXES, NODES, Fix
from argon.engine.exposure import exposure_scales, water_level
from argon.engine.scoring import greedy_bundle, score_fixes
from argon.engine.trace import cascade_trace, representative_iteration
from argon.schemas import RunRequest
from argon.store import RunStore

Event = tuple[str, dict]
LAYERS = ("footprints", "tall_buildings", "soft_story", "seismic_zones")
HAZARD_LIMITS = {"magnitude": (5.5, 8.0), "water_level_ft_mllw": (0, 15), "surge_ft": (0, 13)}


@dataclass
class Deps:
    agent: Agent
    store: RunStore
    layers: LayerProvider
    fallback: Agent = field(default_factory=RecordedAgent)  # used when the agent fails


class StageError(Exception):
    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage


def _error(stage: str, message: str, fallback_used: bool) -> Event:
    return "error", {"stage": stage, "message": message, "fallback_used": fallback_used}


def network() -> dict:
    return {
        "nodes": [{"id": n.id, "name": n.name, "lat": n.lat, "lon": n.lon} for n in NODES],
        "edges": [{"from": up, "to": n.id, "weight": w} for n in NODES for up, w in n.deps.items()],
    }


def _merge_hazards(explicit: list[dict], parsed: list[dict]) -> list[dict]:
    """Explicit hazards win over parsed ones of the same type; parsed values are clamped."""
    merged = {h["type"]: h for h in parsed if h.get("type") in ("earthquake", "king_tide",
                                                                 "storm_surge")}
    for hazard in merged.values():
        for key, (low, high) in HAZARD_LIMITS.items():
            if key in hazard:
                hazard[key] = max(low, min(high, float(hazard[key])))
    merged.update({h["type"]: h for h in explicit})
    return [merged[t] for t in ("earthquake", "king_tide", "storm_surge") if t in merged]


def _scenario(request: RunRequest, hazards: list[dict]) -> dict:
    by_type = {h["type"]: h for h in hazards}
    tide = by_type.get("king_tide", {}).get("water_level_ft_mllw")
    surge = by_type.get("storm_surge", {}).get("surge_ft", 0.0)
    level = water_level(datums(), tide_ft_mllw=tide, surge_ft=surge)
    return {
        "center": request.center.model_dump(),
        "radius_mi": request.radius_mi,
        "hazards": hazards,
        "magnitude": by_type["earthquake"]["magnitude"],
        "water_level": {"ft_mllw": level["ft_mllw"], "m_navd88": round(level["m_navd88"], 3),
                        "m_above_mhhw": round(level["m_above_mhhw"], 3)},
        "seed": request.seed,
        "iterations": request.iterations,
        "budget_m": request.budget_m,
    }


def _sim_scenario(record: dict) -> Scenario:
    s, e = record["scenario"], record["exposure"]
    return Scenario(magnitude=s["magnitude"], surge_m=max(0.0, s["water_level"]["m_above_mhhw"]),
                    iterations=s["iterations"], seed=s["seed"],
                    seismic_scale=e["seismic_scale"], coastal_scale=e["coastal_scale"])


def _buildings(layers: dict, scenario: dict, seawall_fail_p: float) -> dict:
    p = damage_probabilities(layers["buildings"], scenario["magnitude"],
                             scenario["water_level"]["m_navd88"], seawall_fail_p)
    return building_summary(p)


def simulate_selection(record: dict, layers: dict, selected_ids: list[str],
                       budget_m: float | None) -> dict:
    """Shared by sim.mitigated and /api/simulate: result, buildings and replayed trace."""
    scenario = _sim_scenario(record)
    fixes = [Fix(**f["fix"]) for f in record["fixes"]]
    result = run_simulation(scenario, fixes, selected_ids, budget_m)
    applied = [f for f in fixes if f.id in set(result["config"]["applied_fix_ids"])]
    baseline_run = simulate_case(scenario)
    mitigated_run = simulate_case(scenario, applied)
    seawall_p = result["mitigated"]["node_failure_probs"]["seawall"]
    return {
        "result": result,
        "buildings": _buildings(layers, record["scenario"], seawall_p),
        "trace": cascade_trace(mitigated_run, record["iteration"], baseline=baseline_run),
    }


async def _propose(deps: Deps, context: dict, max_fixes: int) -> AsyncIterator[Event]:
    """Yield an optional error event, then ('_fixes', {...}) with the chosen fix list."""
    agent = deps.agent
    try:
        raw = await agent.propose_fixes(context, max_fixes)
        source = "gemini" if agent.mode == "live" else "recorded"
    except Exception as exc:
        yield _error("agent.fixes", f"Gemini fix proposal failed: {exc}", True)
        raw, source = await deps.fallback.propose_fixes(context, max_fixes), "recorded"
    raw = raw or []
    accepted, rejected = validate_fixes(raw, max_fixes)
    if not accepted:
        accepted, source = list(CATALOG_FIXES[:max_fixes]), "fallback"
    yield "_fixes", {"fixes": accepted, "summary": {
        "source": source, "proposed": len(raw), "accepted": len(accepted), "rejected": rejected}}


async def _narrate(deps: Deps, context: dict) -> AsyncIterator[Event]:
    try:
        async for chunk in deps.agent.narrate(context):
            yield "agent.text", {"delta": chunk}
        return
    except Exception as exc:
        yield _error("agent.text", f"Gemini narrative failed: {exc}", True)
    async for chunk in deps.fallback.narrate(context):
        yield "agent.text", {"delta": chunk}


async def run_analysis(request: RunRequest, deps: Deps) -> AsyncIterator[Event]:
    timings: dict[str, float] = {}
    clock = time.perf_counter()

    def lap(stage: str) -> None:
        nonlocal clock
        now = time.perf_counter()
        timings[stage] = round((now - clock) * 1000, 1)
        clock = now

    stage = "scenario"
    try:
        explicit = [h.model_dump() for h in request.hazards]
        parsed, prompt_parse = [], "none"
        if request.prompt:
            try:
                parsed = await deps.agent.parse_prompt(request.prompt)
                prompt_parse = "gemini" if deps.agent.mode == "live" else "regex"
            except Exception as exc:
                yield _error("scenario", f"Gemini prompt parsing failed: {exc}", True)
                parsed, prompt_parse = parse_prompt(request.prompt), "regex"
        hazards = _merge_hazards(explicit, parsed)
        if not any(h["type"] == "earthquake" for h in hazards):
            raise StageError("scenario", "No earthquake found in the prompt or hazards. Add one, "
                                         "such as {\"type\": \"earthquake\", \"magnitude\": 7.2}.")
        scenario = _scenario(request, hazards)
        run_id = f"r_{uuid.uuid4().hex[:12]}"
        yield "run.started", {"run_id": run_id, "scenario": scenario, "prompt_parse": prompt_parse}
        lap("scenario")

        stage = "data"
        layers, source, warning = await asyncio.to_thread(
            deps.layers, request.radius_mi * METERS_PER_MILE)
        if warning:
            yield _error("data", warning, True)
        for name in LAYERS:
            collection = layers[name]
            yield "data.layer", {"layer": name, "source": source,
                                 "count": len(collection["features"]), "geojson": collection}
        lap("data")

        stage = "exposure"
        water_navd88 = scenario["water_level"]["m_navd88"]
        low_ground = int((layers["buildings"].ground_m <= water_navd88).sum())
        seismic, coastal = exposure_scales(layers["counts"], low_ground)
        exposure = {**layers["counts"], "low_ground_count": low_ground,
                    "seismic_scale": round(seismic, 4), "coastal_scale": round(coastal, 4)}
        yield "exposure", exposure
        lap("exposure")

        stage = "baseline"
        record = {"scenario": scenario, "exposure": exposure, "data_source": source}
        sim = _sim_scenario(record)
        baseline_run = simulate_case(sim)
        metrics = summarize(baseline_run)
        record["iteration"] = representative_iteration(baseline_run)
        yield "sim.baseline", {
            "metrics": metrics,
            "buildings": _buildings(layers, scenario, metrics["node_failure_probs"]["seawall"]),
            "network": network(),
            "trace": cascade_trace(baseline_run, record["iteration"]),
        }
        lap("baseline")

        stage = "agent.fixes"
        context = {"scenario": scenario, "exposure": exposure,
                   "baseline": {k: metrics[k] for k in ("expected_loss_m", "expected_fatalities",
                                                        "var99_m", "cvar99_m",
                                                        "node_failure_probs")}}
        fixes: list[Fix] = []
        async for name, payload in _propose(deps, context, request.max_fixes):
            if name == "_fixes":
                fixes = payload["fixes"]
                yield "agent.fixes", payload["summary"]
            else:
                yield name, payload
        lap("agent.fixes")

        stage = "agent.text"
        context["fixes"] = [{"title": f.title, "category": f.category,
                             "target_node": f.target_node, "cost_m": f.cost_m} for f in fixes]
        async for event in _narrate(deps, context):
            yield event
        lap("agent.text")

        stage = "scoring"
        scored = await asyncio.to_thread(score_fixes, sim, fixes)
        kept = [s for s in scored if s["kept"]]
        record["fixes"] = [{**s, "fix": asdict(s["fix"])} for s in kept]
        for item in record["fixes"]:
            yield "fix.ranked", {k: item[k] for k in (
                "rank", "fix", "delta_var99_m", "delta_cvar99_m", "delta_cvar99_ci95_m",
                "expected_loss_saved_m", "roi")}
        dropped = [{"id": s["fix"].id, "reason": s["reason"]} for s in scored if not s["kept"]]
        lap("scoring")

        stage = "bundle"
        ids, spent = await asyncio.to_thread(
            greedy_bundle, sim, [s["fix"] for s in kept], request.budget_m)
        record["bundle"] = {"fix_ids": ids, "spent_m": spent, "budget_m": request.budget_m}
        selection = simulate_selection(record, layers, ids, request.budget_m)
        yield "sim.mitigated", {"bundle": record["bundle"], **selection}
        lap("bundle")

        stage = "store"
        deps.store.save(run_id, record)
        lap("store")
        yield "run.completed", {"run_id": run_id, "dropped_fixes": dropped, "timings_ms": timings}
    except StageError as exc:
        yield _error(exc.stage, str(exc), False)
    except Exception as exc:
        yield _error(stage, f"{type(exc).__name__}: {exc}", False)


def simulate_saved_run(deps: Deps, run_id: str, selected_ids: list[str],
                       budget_m: float | None) -> dict | None:
    record = deps.store.get(run_id)
    if record is None:
        return None
    layers, _, _ = deps.layers(record["scenario"]["radius_mi"] * METERS_PER_MILE)
    start = time.perf_counter()
    selection = simulate_selection(record, layers, selected_ids, budget_m)
    return {"run_id": run_id, **selection,
            "runtime_ms": round((time.perf_counter() - start) * 1000, 1)}
