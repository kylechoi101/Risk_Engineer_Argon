import pytest

from argon.agent.parse import parse_prompt
from argon.agent.validate import COST_RANGE_M, REDUCTION_RANGE, validate_fixes


def raw(**overrides):
    fix = {"id": "Soil Mix 1", "title": "Deep soil mixing", "category": "civil",
           "target_node": "seawall", "cost_m": 45, "reduction_factor": 0.45, "impact": "Less slump."}
    fix.update(overrides)
    return fix


def test_accepts_valid_fix_and_normalizes_id_and_category():
    accepted, rejected = validate_fixes([raw()], max_fixes=30)
    assert rejected == []
    fix = accepted[0]
    assert fix.id == "gx_soil_mix_1" and fix.category == "Civil" and fix.source == "gemini"


def test_clamps_costs_and_reductions_into_sane_ranges():
    accepted, _ = validate_fixes([raw(id="a", cost_m=0.01, reduction_factor=0.99),
                                  raw(id="b", cost_m=9999, reduction_factor=-1)], max_fixes=30)
    assert accepted[0].cost_m == COST_RANGE_M[0] and accepted[0].reduction_factor == REDUCTION_RANGE[1]
    assert accepted[1].cost_m == COST_RANGE_M[1] and accepted[1].reduction_factor == REDUCTION_RANGE[0]


@pytest.mark.parametrize("bad, reason", [
    (raw(target_node="moon_base"), "target_node"),
    (raw(category="Vibes"), "category"),
    (raw(cost_m="cheap"), "cost_m"),
    (raw(title=""), "title"),
    ("not an object", "object"),
])
def test_rejects_invalid_fixes_with_a_reason(bad, reason):
    accepted, rejected = validate_fixes([bad], max_fixes=30)
    assert accepted == [] and reason in rejected[0]["reason"]


def test_dedupes_ids_and_caps_count():
    accepted, rejected = validate_fixes([raw(id="x"), raw(id="x"), raw(id="y"), raw(id="z")],
                                        max_fixes=2)
    assert [f.id for f in accepted] == ["gx_x", "gx_y"]
    assert {r["reason"] for r in rejected} == {"duplicate id", "over max_fixes"}


def test_regex_parser_reads_magnitude_king_tide_and_surge():
    hazards = parse_prompt("Simulate a Magnitude 7.2 earthquake during a 7.5 ft king tide "
                           "with 2 ft storm surge")
    assert {"type": "earthquake", "magnitude": 7.2} in hazards
    assert {"type": "king_tide", "water_level_ft_mllw": 7.5} in hazards
    assert {"type": "storm_surge", "surge_ft": 2.0} in hazards


def test_regex_parser_defaults_king_tide_level_and_handles_m_prefix():
    hazards = parse_prompt("M6.8 quake at king tide")
    assert hazards == [{"type": "earthquake", "magnitude": 6.8},
                       {"type": "king_tide", "water_level_ft_mllw": 7.0}]
    assert parse_prompt("hello there") == []
