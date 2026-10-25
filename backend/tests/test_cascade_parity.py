"""The Python engine must reproduce src/simulation.js exactly for the same inputs."""

import json
from pathlib import Path

import pytest

from argon.engine.cascade import Scenario, run_simulation
from argon.engine.catalog import CATALOG_FIXES

GOLDEN = json.loads((Path(__file__).parent / "fixtures/js_golden.json").read_text())

METRIC_KEYS = {
    "expectedLossMillions": "expected_loss_m",
    "expectedFatalities": "expected_fatalities",
    "var99Millions": "var99_m",
    "cvar99Millions": "cvar99_m",
    "quantilesMillions": "quantiles_m",
    "nodeFailureProbs": "node_failure_probs",
}
REDUCTION_KEYS = {
    "expectedLossSavedMillions": "expected_loss_saved_m",
    "expectedLossReductionPct": "expected_loss_reduction_pct",
    "expectedFatalitiesSaved": "expected_fatalities_saved",
    "expectedFatalitiesReductionPct": "expected_fatalities_reduction_pct",
    "var99ReductionMillions": "var99_reduction_m",
    "cvar99ReductionMillions": "cvar99_reduction_m",
    "netBenefitMillions": "net_benefit_m",
    "benefitCostRatio": "benefit_cost_ratio",
}


def _scenario(options):
    context = options.get("context", {})
    return Scenario(
        magnitude=options["earthquakeMagnitude"],
        surge_m=options["coastalSurgeMeters"],
        iterations=options["iterations"],
        seed=options["seed"],
        seismic_scale=context.get("seismicExposureScale", 1.0),
        coastal_scale=context.get("coastalExposureScale", 1.0),
    )


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: c["name"])
def test_matches_js_engine(case):
    options, expected = case["options"], case["result"]
    result = run_simulation(
        _scenario(options),
        CATALOG_FIXES,
        selected_ids=options.get("selectedFixIds", []),
        budget_m=options.get("budgetMillions"),
    )
    for side in ("baseline", "mitigated"):
        got = result[side]
        for js_key, py_key in METRIC_KEYS.items():
            assert got[py_key] == expected[side][js_key], f"{side}.{py_key}"
        assert got["histogram"] == [
            {"bin_start": h["binStart"], "bin_end": h["binEnd"], "probability": h["probability"]}
            for h in expected[side]["histogram"]
        ]
    for js_key, py_key in REDUCTION_KEYS.items():
        assert result["reduction"][py_key] == expected["overallReduction"][js_key], py_key
    assert result["config"]["applied_fix_ids"] == expected["config"]["appliedFixIds"]
    assert result["config"]["skipped_fix_ids"] == expected["config"]["skippedFixIdsDueToBudget"]
    assert result["config"]["spent_m"] == expected["config"]["spentMillions"]
