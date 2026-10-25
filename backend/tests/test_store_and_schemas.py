import pytest
from pydantic import ValidationError

from argon.schemas import RunRequest
from argon.store import RunStore


def test_store_round_trips_runs_and_misses_cleanly(tmp_path):
    store = RunStore(tmp_path / "runs.db")
    store.save("r_1", {"scenario": {"magnitude": 7.2}, "fixes": [{"id": "a"}]})
    assert store.get("r_1") == {"scenario": {"magnitude": 7.2}, "fixes": [{"id": "a"}]}
    assert store.get("r_missing") is None


def test_legacy_scenario_shorthand_becomes_hazards():
    req = RunRequest.model_validate({"scenario": {"magnitude": 7.2, "king_tide_ft": 7.0}})
    assert [h.model_dump() for h in req.hazards] == [
        {"type": "earthquake", "magnitude": 7.2},
        {"type": "king_tide", "water_level_ft_mllw": 7.0},
    ]
    assert req.radius_mi == 1.0 and req.budget_m == 150 and req.center.label == "Ferry Building"


@pytest.mark.parametrize("body", [
    {"hazards": [{"type": "earthquake", "magnitude": 9.5}]},
    {"hazards": [{"type": "earthquake", "magnitude": 7}, {"type": "earthquake", "magnitude": 6}]},
    {"hazards": [{"type": "king_tide", "water_level_ft_mllw": 7}]},
    {"hazards": [{"type": "earthquake", "magnitude": 7}], "radius_mi": 3},
    {"hazards": [{"type": "earthquake", "magnitude": 7}], "center": {"lat": 37.76, "lon": -122.42}},
    {"hazards": [{"type": "tsunami"}]},
])
def test_rejects_invalid_requests(body):
    with pytest.raises(ValidationError):
        RunRequest.model_validate(body)


def test_prompt_alone_is_enough_to_start():
    assert RunRequest.model_validate({"prompt": "M7.2 during a king tide"}).hazards == []
