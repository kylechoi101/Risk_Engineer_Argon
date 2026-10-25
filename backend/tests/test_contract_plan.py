import pytest

from argon.contract.plan import LIMITS, default_plan, validate_plan

COUNTS = {"softstory_wood_lowrise": 12, "lowrise_fill": 600, "midrise_fill": 289, "highrise_firm": 40}
FLOOD_ZONES = ["z1"]


def raw_fix(**overrides):
    fix = {"id": "Soft Story", "label": "Retrofit soft-story buildings", "kind": "building",
           "applies_to_archetypes": ["softstory_wood_lowrise"], "applies_to_nodes": [],
           "cost_usd_per_building": [100e3, 200e3], "cost_usd": [0, 0],
           "fragility_median_factor": 1.8, "flood_depth_factor": 1, "node_reduction_factor": 0,
           "rationale": "Adds strength at the open ground floor.", "group_label": "Open soft-story",
           "sources": [{"title": "DBI", "url": "https://sfdbi.org/soft-story-retrofit-program"}]}
    fix.update(overrides)
    return fix


def plan(fixes, archetypes=(), url_ok=lambda url: True):
    return validate_plan({"fixes": list(fixes), "archetypes": list(archetypes)}, COUNTS, FLOOD_ZONES,
                         url_ok=url_ok)


def test_building_fix_costs_scale_with_matching_buildings_and_keep_verified_sources():
    p = plan([raw_fix()])
    fix = p.fixes[0]
    assert fix["id"] == "gx_soft_story" and fix["bit"] == 0 and fix["source"] == "gemini"
    assert fix["cost_usd"] == [12 * 100e3, 12 * 200e3]
    assert fix["effect"] == {"fragility_median_factor": 1.8}
    assert fix["evidence"] == "sourced" and fix["sources"][0]["url"].startswith("https://sfdbi.org")


def test_unverified_or_off_allowlist_links_are_dropped_and_marked_inferred():
    off_list = raw_fix(sources=[{"title": "Blog", "url": "https://example.com/retrofit"}])
    assert plan([off_list]).fixes[0]["evidence"] == "inferred"
    dead = plan([raw_fix()], url_ok=lambda url: False).fixes[0]
    assert dead["sources"] == [] and dead["evidence"] == "inferred"


def test_effects_and_costs_are_clamped():
    p = plan([
        raw_fix(id="a", fragility_median_factor=9, cost_usd_per_building=[1, 1e9]),
        raw_fix(id="b", kind="flood", applies_to_archetypes=[], applies_to_nodes=["seawall"],
                flood_depth_factor=0.01, node_reduction_factor=5, cost_usd=[1, 1e12]),
    ])
    a, b = p.fixes
    assert a["effect"]["fragility_median_factor"] == LIMITS["fragility_median_factor"][1]
    assert b["effect"] == {"flood_depth_factor": LIMITS["flood_depth_factor"][0],
                           "node_reduction_factor": LIMITS["node_reduction_factor"][1]}
    assert b["applies_to_zones"] == FLOOD_ZONES and b["applies_to_nodes"] == ["seawall"]
    assert b["cost_usd"][1] == LIMITS["total_cost_usd"][1]


@pytest.mark.parametrize("bad, reason", [
    (raw_fix(kind="magic"), "kind"),
    (raw_fix(applies_to_archetypes=["castle"]), "archetype"),
    (raw_fix(kind="infrastructure", applies_to_archetypes=[], applies_to_nodes=["moon"]), "node"),
    (raw_fix(label=""), "label"),
])
def test_invalid_fixes_are_rejected_with_reasons(bad, reason):
    p = plan([bad, raw_fix(id="ok")])
    assert [f["id"] for f in p.fixes] == ["gx_ok"]
    assert reason in p.rejected[0]["reason"]


def test_caps_at_five_fixes_and_returns_none_when_nothing_survives():
    p = plan([raw_fix(id=f"f{i}") for i in range(7)])
    assert [f["bit"] for f in p.fixes] == [0, 1, 2, 3, 4]
    assert {r["reason"] for r in p.rejected} == {"over 5 fixes"}
    assert plan([raw_fix(kind="magic")]) is None


def test_archetype_fragility_overrides_must_be_increasing():
    good = {"id": "lowrise_fill", "median_pga_g": [0.1, 0.2, 0.4, 0.7], "beta": 2.0, "rationale": "Fill."}
    bad = {"id": "midrise_firm", "median_pga_g": [0.5, 0.3, 0.6, 0.9], "beta": 0.6, "rationale": ""}
    p = plan([raw_fix()], archetypes=[good, bad])
    assert p.archetypes["lowrise_fill"]["median_pga_g"] == [0.1, 0.2, 0.4, 0.7]
    assert p.archetypes["lowrise_fill"]["beta"] == LIMITS["beta"][1]
    assert "midrise_firm" not in p.archetypes


def test_default_plan_is_the_built_in_five():
    p = default_plan(COUNTS, FLOOD_ZONES)
    assert len(p.fixes) == 5 and p.source == "fallback" and p.archetypes == {}
