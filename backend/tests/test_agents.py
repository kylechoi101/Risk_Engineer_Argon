import asyncio
import json
from types import SimpleNamespace

import pytest

from argon.agent.agents import GeminiAgent, RecordedAgent, make_agent, recording_key

CONTEXT = {"scenario": {"magnitude": 7.2, "water_level": {"ft_mllw": 7.0}},
           "baseline": {"var99_m": 1160.8, "cvar99_m": 1229.5, "expected_loss_m": 410.0},
           "fixes": [{"title": "Deep soil mixing", "target_node": "seawall"}]}
FIX = {"id": "a", "title": "T", "category": "Civil", "target_node": "seawall", "cost_m": 10,
       "reduction_factor": 0.3, "impact": "x"}


async def collect(agen):
    return "".join([chunk async for chunk in agen])


def test_recorded_agent_replays_matching_recording(tmp_path):
    (tmp_path / f"{recording_key(CONTEXT)}.json").write_text(
        json.dumps({"fixes": [FIX], "narrative": "Recorded words here."}))
    agent = RecordedAgent(tmp_path, delay_s=0)
    assert asyncio.run(agent.propose_fixes(CONTEXT, 30)) == [FIX]
    assert asyncio.run(collect(agent.narrate(CONTEXT))) == "Recorded words here."


def test_recorded_agent_without_recording_falls_back(tmp_path):
    agent = RecordedAgent(tmp_path, delay_s=0)
    assert asyncio.run(agent.propose_fixes(CONTEXT, 30)) is None
    text = asyncio.run(collect(agent.narrate(CONTEXT)))
    assert "M7.2" in text and "7.0 ft" in text
    assert asyncio.run(agent.parse_prompt("M6.5 quake")) == [{"type": "earthquake", "magnitude": 6.5}]


class FakeModels:
    def __init__(self):
        self.calls = []

    async def generate_content(self, *, model, contents, config):
        self.calls.append(("json", model))
        return SimpleNamespace(text=json.dumps({"fixes": [FIX]}))

    async def generate_content_stream(self, *, model, contents, config=None):
        self.calls.append(("stream", model))

        async def chunks():
            for part in ("Seawall ", "first."):
                yield SimpleNamespace(text=part)
        return chunks()


def test_gemini_agent_parses_json_streams_text_and_records(tmp_path):
    models = FakeModels()
    client = SimpleNamespace(aio=SimpleNamespace(models=models))
    agent = GeminiAgent(client, model="gemini-4-argon", record_dir=tmp_path)
    assert asyncio.run(agent.propose_fixes(CONTEXT, 30)) == [FIX]
    assert asyncio.run(collect(agent.narrate(CONTEXT))) == "Seawall first."
    saved = json.loads((tmp_path / f"{recording_key(CONTEXT)}.json").read_text())
    assert saved == {"fixes": [FIX], "narrative": "Seawall first."}
    assert models.calls == [("json", "gemini-4-argon"), ("stream", "gemini-4-argon")]


@pytest.mark.parametrize("env, expected", [
    ({}, "recorded"),
    ({"GEMINI_API_KEY": "k"}, "live"),
    ({"GEMINI_API_KEY": "k", "ARGON_AGENT": "recorded"}, "recorded"),
])
def test_make_agent_picks_mode_from_env(env, expected, tmp_path):
    assert make_agent(env, recordings=tmp_path).mode == expected


PLAN_CONTEXT = {"recording_key": "contract_m7.0_tide7.0ft_runup2.0m", "scenario": {"magnitude": 7.0},
                "archetypes": [], "flood_zones": [], "nodes": []}


def test_gemini_agent_plans_the_contract_and_records_it(tmp_path):
    models = FakeModels()
    agent = GeminiAgent(SimpleNamespace(aio=SimpleNamespace(models=models)), record_dir=tmp_path)
    plan = asyncio.run(agent.plan_contract(PLAN_CONTEXT))
    assert plan == {"fixes": [FIX]}
    saved = json.loads((tmp_path / "contract_m7.0_tide7.0ft_runup2.0m.json").read_text())
    assert saved == {"plan": {"fixes": [FIX]}}


def test_recorded_agent_replays_a_contract_plan_or_returns_none(tmp_path):
    agent = RecordedAgent(tmp_path, delay_s=0)
    assert asyncio.run(agent.plan_contract(PLAN_CONTEXT)) is None
    (tmp_path / "contract_m7.0_tide7.0ft_runup2.0m.json").write_text(json.dumps({"plan": {"fixes": []}}))
    assert asyncio.run(agent.plan_contract(PLAN_CONTEXT)) == {"fixes": []}
