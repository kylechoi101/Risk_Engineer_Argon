from itertools import pairwise

import numpy as np
import pytest

from argon.engine.cascade import Scenario, cvar99, simulate_case
from argon.engine.catalog import CATALOG_FIXES, NODES, Fix
from argon.engine.scoring import greedy_bundle, score_fixes
from argon.engine.trace import cascade_trace, representative_iteration

SCENARIO = Scenario(magnitude=7.2, surge_m=0.35)


@pytest.fixture(scope="module")
def baseline():
    return simulate_case(SCENARIO)


def test_representative_draw_is_nearest_the_tail_mean(baseline):
    it = representative_iteration(baseline)
    gap = abs(baseline.losses[it] - cvar99(baseline.losses))
    assert gap == pytest.approx(np.abs(baseline.losses - cvar99(baseline.losses)).min())


def test_baseline_trace_explains_each_cascade(baseline):
    it = representative_iteration(baseline)
    trace = cascade_trace(baseline, it)
    assert [e["node_id"] for e in trace["events"]] == [n.id for n in NODES]
    deps = {n.id: n.deps for n in NODES}
    failed = {e["node_id"] for e in trace["events"] if e["failed"]}
    for e in trace["events"]:
        assert not e["blocked"]
        assert set(e["upstream"]) <= failed and set(e["upstream"]) <= set(deps[e["node_id"]])
        assert e["cause"] == ("cascade" if e["upstream"] else "hazard")
        assert e["t_s"] >= 1.0


def test_mitigated_trace_marks_blocked_failures(baseline):
    it = representative_iteration(baseline)
    mitigated = simulate_case(SCENARIO, CATALOG_FIXES)
    trace = cascade_trace(mitigated, it, baseline=baseline)
    blocked = [e for e in trace["events"] if e["blocked"]]
    assert blocked
    for e in blocked:
        assert baseline.failed[it, [n.id for n in NODES].index(e["node_id"])]
        assert not e["failed"]


def test_scoring_keeps_effective_fixes_and_drops_useless_ones():
    useless = Fix("gx_noop", "Paint the seawall", "Civil", "seawall", 5, 0.0)
    scored = score_fixes(SCENARIO, [*CATALOG_FIXES[:3], useless])
    by_id = {s["fix"].id: s for s in scored}
    assert by_id["fix_sw_1"]["kept"] and by_id["fix_sw_1"]["delta_cvar99_ci95_m"][0] > 0
    assert not by_id["gx_noop"]["kept"] and "CI" in by_id["gx_noop"]["reason"]
    kept = [s for s in scored if s["kept"]]
    assert [s["rank"] for s in kept] == list(range(1, len(kept) + 1))
    assert all(a["delta_cvar99_m"] >= b["delta_cvar99_m"] for a, b in pairwise(kept))
    sw1 = by_id["fix_sw_1"]
    assert sw1["roi"] == pytest.approx(sw1["expected_loss_saved_m"] / 45, abs=0.01)


def test_scoring_is_deterministic():
    assert score_fixes(SCENARIO, CATALOG_FIXES[:4]) == score_fixes(SCENARIO, CATALOG_FIXES[:4])


def test_greedy_bundle_respects_budget_and_beats_any_single_affordable_fix():
    ids, spent = greedy_bundle(SCENARIO, CATALOG_FIXES, budget_m=100)
    assert ids and spent <= 100
    by_id = {f.id: f for f in CATALOG_FIXES}
    bundle_cvar = cvar99(simulate_case(SCENARIO, [by_id[i] for i in ids]).losses)
    best_single = min(cvar99(simulate_case(SCENARIO, [f]).losses) for f in CATALOG_FIXES)
    assert bundle_cvar < best_single
