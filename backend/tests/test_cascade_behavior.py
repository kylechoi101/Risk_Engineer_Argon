import time

from argon.engine.cascade import Scenario, run_simulation
from argon.engine.catalog import CATALOG_FIXES

SCENARIO = Scenario(magnitude=7.2, surge_m=0.35)
ALL_IDS = [f.id for f in CATALOG_FIXES]


def test_full_portfolio_reduces_tail_risk():
    result = run_simulation(SCENARIO, CATALOG_FIXES, ALL_IDS)
    assert result["mitigated"]["cvar99_m"] < result["baseline"]["cvar99_m"]
    assert result["mitigated"]["var99_m"] < result["baseline"]["var99_m"]


def test_budget_ceiling_holds():
    result = run_simulation(SCENARIO, CATALOG_FIXES, ALL_IDS, budget_m=60)
    assert result["config"]["spent_m"] <= 60
    assert result["config"]["skipped_fix_ids"]


def test_rerun_with_fixes_is_under_two_seconds():
    start = time.perf_counter()
    run_simulation(Scenario(magnitude=7.2, surge_m=0.35, iterations=50000), CATALOG_FIXES, ALL_IDS)
    assert time.perf_counter() - start < 2.0
