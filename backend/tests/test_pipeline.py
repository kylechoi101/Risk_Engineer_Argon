import asyncio

import pytest

from argon.agent.agents import RecordedAgent
from argon.data.provider import snapshot_provider
from argon.pipeline import Deps, run_analysis, simulate_saved_run
from argon.schemas import RunRequest
from argon.store import RunStore

REQUEST = {"radius_mi": 0.5, "iterations": 1000,
           "hazards": [{"type": "earthquake", "magnitude": 7.2},
                       {"type": "king_tide", "water_level_ft_mllw": 7.0}]}


class BrokenAgent(RecordedAgent):
    mode = "live"

    async def parse_prompt(self, prompt):
        raise TimeoutError("gemini timed out")

    async def propose_fixes(self, context, max_fixes):
        raise TimeoutError("gemini timed out")


def run(body, deps):
    async def go():
        return [event async for event in run_analysis(RunRequest.model_validate(body), deps)]
    return asyncio.run(go())


@pytest.fixture
def deps(tmp_path):
    recorded = RecordedAgent(tmp_path / "rec", delay_s=0)
    return Deps(agent=recorded, store=RunStore(tmp_path / "db"), layers=snapshot_provider,
                fallback=recorded)


def names(events):
    out = []
    for name, _ in events:
        if not out or out[-1] != name or name not in ("data.layer", "agent.text", "fix.ranked"):
            out.append(name)
    return out


def test_streams_every_stage_in_order(deps):
    events = run(REQUEST, deps)
    assert names(events) == ["run.started", "data.layer", "exposure", "sim.baseline", "agent.fixes",
                             "agent.text", "fix.ranked", "sim.mitigated", "run.completed"]
    data = dict(events)
    assert [d["layer"] for n, d in events if n == "data.layer"] == [
        "footprints", "tall_buildings", "soft_story", "seismic_zones"]
    water = data["run.started"]["scenario"]["water_level"]
    assert water["m_above_mhhw"] == pytest.approx(0.354, abs=0.001)
    assert data["agent.fixes"]["source"] == "fallback"
    footprints = next(d for n, d in events if n == "data.layer" and d["layer"] == "footprints")
    assert len(data["sim.baseline"]["buildings"]["damage_p"]) == footprints["count"]
    bundle = data["sim.mitigated"]["bundle"]
    assert bundle["fix_ids"] and bundle["spent_m"] <= 150
    assert data["sim.mitigated"]["result"]["mitigated"]["cvar99_m"] < \
        data["sim.baseline"]["metrics"]["cvar99_m"]
    assert any(e["blocked"] for e in data["sim.mitigated"]["trace"]["events"])


def test_saved_run_reproduces_the_streamed_bundle(deps):
    events = run(REQUEST, deps)
    data = dict(events)
    run_id, bundle = data["run.completed"]["run_id"], data["sim.mitigated"]["bundle"]
    again = simulate_saved_run(deps, run_id, bundle["fix_ids"], bundle["budget_m"])
    assert again["result"] == data["sim.mitigated"]["result"]
    assert again["buildings"] == data["sim.mitigated"]["buildings"]
    assert simulate_saved_run(deps, "r_nope", [], None) is None


def test_live_agent_failures_fall_back_and_finish(deps, tmp_path):
    deps.agent = BrokenAgent(tmp_path / "rec", delay_s=0)
    events = run({**REQUEST, "prompt": "M7.2 quake"}, deps)
    errors = [d for n, d in events if n == "error"]
    assert {e["stage"] for e in errors} == {"scenario", "agent.fixes"}
    assert all(e["fallback_used"] for e in errors)
    data = dict(events)
    assert data["run.started"]["prompt_parse"] == "regex"
    assert events[-1][0] == "run.completed"


def test_explicit_hazards_override_parsed_ones(deps):
    body = {"radius_mi": 0.25, "iterations": 500, "prompt": "M6.8 quake with an 8 ft king tide",
            "hazards": [{"type": "earthquake", "magnitude": 7.2}]}
    scenario = dict(run(body, deps))["run.started"]["scenario"]
    assert scenario["magnitude"] == 7.2 and scenario["water_level"]["ft_mllw"] == 8.0


def test_prompt_without_earthquake_ends_with_error(deps):
    events = run({"radius_mi": 0.25, "prompt": "just a king tide"}, deps)
    assert [n for n, _ in events] == ["error"]
    assert events[0][1]["stage"] == "scenario" and not events[0][1]["fallback_used"]
