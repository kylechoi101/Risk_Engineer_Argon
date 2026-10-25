"""Score candidate fixes against the baseline and pick a budgeted bundle."""

from collections.abc import Sequence

import numpy as np

from argon.engine.cascade import Scenario, cvar99, simulate_case, tail_index
from argon.engine.catalog import NODES, Fix, Node

BOOTSTRAP_SAMPLES = 200


def _tail_means(sorted_rows: np.ndarray) -> np.ndarray:
    return sorted_rows[:, tail_index(sorted_rows.shape[1]) :].mean(axis=1)


def score_fixes(
    scenario: Scenario, fixes: Sequence[Fix], nodes: Sequence[Node] = NODES
) -> list[dict]:
    """Score each fix alone with common random numbers.

    A fix is kept when the lower end of a 95% paired-bootstrap interval on its CVaR 0.99
    reduction is above zero. Kept fixes come first, ranked by CVaR reduction.
    """
    s = scenario.clamped()
    base = simulate_case(s, (), nodes).losses
    n = len(base)
    resample = np.random.default_rng(s.seed).integers(0, n, size=(BOOTSTRAP_SAMPLES, n))
    base_boot = _tail_means(np.sort(base[resample], axis=1))
    base_sorted = np.sort(base)
    idx99 = tail_index(n)

    scored = []
    for fix in fixes:
        mit = simulate_case(s, [fix], nodes).losses
        mit_sorted = np.sort(mit)
        deltas = base_boot - _tail_means(np.sort(mit[resample], axis=1))
        low, high = np.percentile(deltas, [2.5, 97.5])
        saved = float(base.mean() - mit.mean())
        item = {
            "fix": fix,
            "rank": None,
            "delta_var99_m": round(float(base_sorted[idx99] - mit_sorted[idx99]), 2),
            "delta_cvar99_m": round(cvar99(base) - cvar99(mit), 2),
            "delta_cvar99_ci95_m": [round(float(low), 2), round(float(high), 2)],
            "expected_loss_saved_m": round(saved, 2),
            "roi": round(saved / fix.cost_m, 2) if fix.cost_m > 0 else None,
            "kept": bool(low > 0),
            "reason": None,
        }
        if not item["kept"]:
            item["reason"] = (f"CVaR reduction not distinguishable from zero "
                              f"(95% CI {item['delta_cvar99_ci95_m']})")
        scored.append(item)

    kept = sorted((x for x in scored if x["kept"]), key=lambda x: -x["delta_cvar99_m"])
    for rank, item in enumerate(kept, start=1):
        item["rank"] = rank
    return kept + [x for x in scored if not x["kept"]]


def greedy_bundle(
    scenario: Scenario, fixes: Sequence[Fix], budget_m: float, nodes: Sequence[Node] = NODES
) -> tuple[list[str], float]:
    """Repeatedly add the fix with the largest extra CVaR reduction per dollar that fits."""
    s = scenario.clamped()
    chosen: list[Fix] = []
    spent = 0.0
    current = cvar99(simulate_case(s, (), nodes).losses)
    remaining = list(fixes)
    while True:
        best, best_ratio, best_cvar = None, 0.0, current
        for fix in remaining:
            if spent + fix.cost_m > budget_m or fix.cost_m <= 0:
                continue
            value = cvar99(simulate_case(s, [*chosen, fix], nodes).losses)
            ratio = (current - value) / fix.cost_m
            if ratio > best_ratio:
                best, best_ratio, best_cvar = fix, ratio, value
        if best is None:
            return [f.id for f in chosen], round(spent, 2)
        chosen.append(best)
        remaining.remove(best)
        spent += best.cost_m
        current = best_cvar
