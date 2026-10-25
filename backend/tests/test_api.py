import json

import pytest
from fastapi.testclient import TestClient

from argon.agent.agents import RecordedAgent
from argon.api import create_app
from argon.data.provider import snapshot_provider
from argon.pipeline import Deps
from argon.store import RunStore

BODY = {"center": {"lat": 37.7955, "lon": -122.3937, "label": "Ferry Building"},
        "radius_mi": 0.5, "iterations": 1000,
        "scenario": {"magnitude": 7.2, "king_tide_ft": 7.0}}


@pytest.fixture
def client(tmp_path):
    recorded = RecordedAgent(tmp_path / "rec", delay_s=0)
    deps = Deps(agent=recorded, store=RunStore(tmp_path / "db"), layers=snapshot_provider,
                fallback=recorded)
    return TestClient(create_app(deps, cors_origins=["http://localhost:3000"]))


def parse_sse(text):
    frames = []
    for block in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines())
        frames.append((int(fields["id"]), fields["event"], json.loads(fields["data"])))
    return frames


def stream(client, body=BODY):
    with client.stream("POST", "/api/runs", json=body) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        return parse_sse(response.read().decode())


def test_run_streams_numbered_sse_frames(client):
    frames = stream(client)
    assert [f[0] for f in frames] == list(range(1, len(frames) + 1))
    assert frames[0][1] == "run.started" and frames[-1][1] == "run.completed"


def test_simulate_reruns_a_saved_run_quickly(client):
    frames = dict((name, data) for _, name, data in stream(client))
    run_id = frames["run.completed"]["run_id"]
    fix_ids = [f["fix"]["id"] for _, n, f in stream(client) if n == "fix.ranked"][:2]
    response = client.post("/api/simulate", json={"run_id": run_id, "selected_fix_ids": fix_ids})
    assert response.status_code == 200
    body = response.json()
    assert body["result"]["config"]["applied_fix_ids"] == fix_ids
    assert body["runtime_ms"] < 2000
    assert client.post("/api/simulate", json={"run_id": "r_missing"}).status_code == 404


def test_get_run_and_health(client):
    run_id = stream(client)[-1][2]["run_id"]
    saved = client.get(f"/api/runs/{run_id}").json()
    assert saved["scenario"]["magnitude"] == 7.2 and saved["bundle"]["fix_ids"]
    assert client.get("/api/runs/r_missing").status_code == 404
    assert client.get("/api/health").json() == {"status": "ok", "agent": "recorded",
                                                "data": "snapshot"}


def test_invalid_request_is_rejected_before_streaming(client):
    response = client.post("/api/runs", json={"hazards": [{"type": "king_tide",
                                                           "water_level_ft_mllw": 7}]})
    assert response.status_code == 422


def test_cors_allows_the_frontend(client):
    response = client.options("/api/runs", headers={"Origin": "http://localhost:3000",
                                                    "Access-Control-Request-Method": "POST"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
