"""Monte Carlo natech cascade model, a vectorized port of src/simulation.js.

Each iteration consumes 2 + 2 * len(nodes) + 1 uniform draws in the same order as the JS
engine, so the baseline and mitigated cases share common random numbers and the outputs match
the browser engine exactly. Everything here is pure: no I/O, no clock, no global state.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache

import numpy as np

from argon.engine.catalog import NODES, Fix, Node
from argon.engine.prng import uniforms

QUANTILES = (0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99)
HISTOGRAM_BINS = 25
NATECH_FIRE_LOSS_M = 165


@dataclass(frozen=True)
class Scenario:
    magnitude: float
    surge_m: float  # coastal water level above MHHW, meters
    iterations: int = 4096
    seed: int = 42
    seismic_scale: float = 1.0
    coastal_scale: float = 1.0

    def clamped(self) -> "Scenario":
        return Scenario(
            magnitude=max(5.5, min(8.0, float(self.magnitude))),
            surge_m=max(0.0, min(4.0, float(self.surge_m))),
            iterations=max(100, min(50000, math.floor(self.iterations))),
            seed=int(self.seed),
            # Public map layers provide bounded exposure modifiers, not calibrated fragility.
            seismic_scale=max(0.8, min(1.25, float(self.seismic_scale or 1))),
            coastal_scale=max(0.75, min(1.35, float(self.coastal_scale or 1))),
        )


@dataclass(frozen=True)
class CaseRun:
    losses: np.ndarray  # (iterations,) USD millions
    fatalities: np.ndarray  # (iterations,)
    failed: np.ndarray  # (iterations, nodes) bool


def js_round(value: float, digits: int) -> float:
    """Number(value.toFixed(digits)): round the exact binary value half-up."""
    quantum = Decimal(1).scaleb(-digits)
    return float(Decimal(float(value)).quantize(quantum, rounding=ROUND_HALF_UP))


@lru_cache(maxsize=16)
def draws_for(seed: int, iterations: int, node_count: int) -> np.ndarray:
    per_iteration = 2 + 2 * node_count + 1
    draws = uniforms(seed, iterations * per_iteration).reshape(iterations, per_iteration)
    draws.setflags(write=False)
    return draws


def node_modifiers(fixes: Sequence[Fix], nodes: Sequence[Node] = NODES):
    """Per-node vulnerability and consequence multipliers, with cross-category synergy."""
    vuln = np.ones(len(nodes))
    for i, node in enumerate(nodes):
        targeted = [f for f in fixes if f.target_node == node.id]
        multiplier = 1.0
        categories = set()
        for fix in targeted:
            multiplier *= 1.0 - fix.reduction_factor
            categories.add(fix.category)
        if len(categories) >= 2:
            multiplier *= 0.90  # multi-disciplinary defense
        if len(categories) == 3:
            multiplier *= 0.92  # full Civil + Hardware + Software triad
        vuln[i] = multiplier
    consequence = 1.0 - (1.0 - vuln) * 0.35
    return vuln, consequence


def simulate_case(
    scenario: Scenario, fixes: Sequence[Fix] = (), nodes: Sequence[Node] = NODES
) -> CaseRun:
    s = scenario.clamped()
    draws = draws_for(s.seed, s.iterations, len(nodes))
    vuln, consequence = node_modifiers(fixes, nodes)
    index = {n.id: i for i, n in enumerate(nodes)}

    eq_intensity = math.pow(10, 0.58 * (s.magnitude - 5.5)) / math.pow(10, 0.58 * 2.5)
    surge_intensity = math.pow(s.surge_m / 4.0, 1.35)
    eq_common = 0.8 + 0.4 * draws[:, 0]
    surge_common = 0.85 + 0.3 * draws[:, 1]

    n = s.iterations
    failed = np.zeros((n, len(nodes)), dtype=bool)
    losses = np.zeros(n)
    fatalities = np.zeros(n)
    for i, node in enumerate(nodes):
        u_fail = draws[:, 2 + 2 * i]
        u_sev = 0.6 + 0.8 * draws[:, 3 + 2 * i]
        eq_term = np.minimum(0.95, node.base_eq * eq_intensity * eq_common * s.seismic_scale)
        surge_term = np.minimum(
            0.95, node.base_surge * surge_intensity * surge_common * s.coastal_scale
        )
        raw_hazard = 1.0 - (1.0 - eq_term) * (1.0 - surge_term)

        cascade = np.zeros(n)
        for j in range(i):
            weight = node.deps.get(nodes[j].id)
            if weight:
                cascade = cascade + np.where(failed[:, j], weight * (0.65 + 0.35 * vuln[i]), 0.0)

        prob = np.minimum(0.99, 1.0 - (1.0 - raw_hazard * vuln[i]) * np.exp(-cascade))
        hit = u_fail < prob
        failed[:, i] = hit
        losses = losses + np.where(hit, node.direct_cost * u_sev * consequence[i], 0.0)
        fatalities = fatalities + np.where(hit, node.direct_fatality * u_sev * consequence[i], 0.0)

    # Compounding natech escalation: fuel fire with no firefighting water, worse if roads are cut.
    fuel, pump, roads = index["fuel_terminal"], index["water_pump"], index["evac_roads"]
    u_natech = 0.75 + 0.5 * draws[:, 2 + 2 * len(nodes)]
    natech_mod = (consequence[fuel] + consequence[roads]) * 0.5
    fire = failed[:, fuel] & failed[:, pump]
    losses = losses + np.where(fire, NATECH_FIRE_LOSS_M * u_natech * natech_mod, 0.0)
    trapped = np.where(failed[:, roads], 28.0, 9.0)
    fatalities = fatalities + np.where(fire, trapped * u_natech * natech_mod, 0.0)
    return CaseRun(losses, fatalities, failed)


def tail_index(n: int) -> int:
    return min(n - 1, math.floor(n * 0.99))


def cvar99(losses: np.ndarray) -> float:
    ordered = np.sort(losses)
    tail = ordered[tail_index(len(ordered)) :]
    return float(np.cumsum(tail)[-1] / len(tail))


def summarize(run: CaseRun, nodes: Sequence[Node] = NODES) -> dict:
    ordered = np.sort(run.losses)
    n = len(ordered)
    idx99 = tail_index(n)
    var99 = ordered[idx99]
    tail = ordered[idx99:]
    cvar = np.cumsum(tail)[-1] / len(tail) if len(tail) else var99

    max_value = max(float(ordered[-1]), 1.0)
    step = max_value / HISTOGRAM_BINS
    counts = np.bincount(
        np.minimum(HISTOGRAM_BINS - 1, np.floor(ordered / step).astype(int)),
        minlength=HISTOGRAM_BINS,
    )
    histogram = []
    for i, count in enumerate(counts):
        probability = 0.0
        for _ in range(int(count)):  # sequential sum keeps parity with the JS engine
            probability += 1 / n
        histogram.append({
            "bin_start": js_round(i * step, 1),
            "bin_end": js_round((i + 1) * step, 1),
            "probability": js_round(probability, 4),
        })

    fail_counts = run.failed.sum(axis=0)
    return {
        "expected_loss_m": js_round(np.cumsum(ordered)[-1] / n, 2),
        "expected_fatalities": js_round(np.cumsum(run.fatalities)[-1] / n, 2),
        "var99_m": js_round(var99, 2),
        "cvar99_m": js_round(cvar, 2),
        "quantiles_m": {
            f"p{round(q * 100)}": js_round(ordered[min(n - 1, math.floor(n * q))], 2)
            for q in QUANTILES
        },
        "node_failure_probs": {
            node.id: js_round(fail_counts[i] / n, 4) for i, node in enumerate(nodes)
        },
        "histogram": histogram,
    }


def select_within_budget(
    fixes: Sequence[Fix], selected_ids: Sequence[str], budget_m: float | None
) -> tuple[list[Fix], list[str], float]:
    """Take selected fixes in order, skipping any that would exceed the budget."""
    by_id = {f.id: f for f in fixes}
    ceiling = math.inf if budget_m is None else float(budget_m)
    applied, skipped, spent = [], [], 0.0
    for fix_id in dict.fromkeys(selected_ids):
        fix = by_id.get(fix_id)
        if fix is None:
            continue
        if spent + fix.cost_m <= ceiling:
            applied.append(fix)
            spent += fix.cost_m
        else:
            skipped.append(fix.id)
    return applied, skipped, spent


def reduction(baseline: dict, mitigated: dict, spent_m: float) -> dict:
    loss_diff = baseline["expected_loss_m"] - mitigated["expected_loss_m"]
    fat_diff = baseline["expected_fatalities"] - mitigated["expected_fatalities"]
    base_loss, base_fat = baseline["expected_loss_m"], baseline["expected_fatalities"]
    return {
        "expected_loss_saved_m": js_round(loss_diff, 2),
        "expected_loss_reduction_pct": js_round(loss_diff / base_loss * 100, 2) if base_loss else 0,
        "expected_fatalities_saved": js_round(fat_diff, 2),
        "expected_fatalities_reduction_pct": (
            js_round(fat_diff / base_fat * 100, 2) if base_fat else 0
        ),
        "var99_reduction_m": js_round(baseline["var99_m"] - mitigated["var99_m"], 2),
        "cvar99_reduction_m": js_round(baseline["cvar99_m"] - mitigated["cvar99_m"], 2),
        "net_benefit_m": js_round(loss_diff - spent_m, 2),
        "benefit_cost_ratio": js_round(loss_diff / spent_m, 2) if spent_m > 0 else None,
    }


def run_simulation(
    scenario: Scenario,
    fixes: Sequence[Fix],
    selected_ids: Sequence[str] = (),
    budget_m: float | None = None,
    nodes: Sequence[Node] = NODES,
) -> dict:
    s = scenario.clamped()
    applied, skipped, spent = select_within_budget(fixes, selected_ids, budget_m)
    baseline = summarize(simulate_case(s, (), nodes), nodes)
    mitigated = summarize(simulate_case(s, applied, nodes), nodes)
    return {
        "config": {
            "magnitude": s.magnitude,
            "surge_m": s.surge_m,
            "iterations": s.iterations,
            "seed": s.seed,
            "budget_m": budget_m,
            "spent_m": js_round(spent, 2),
            "applied_fix_ids": [f.id for f in applied],
            "skipped_fix_ids": skipped,
            "seismic_scale": s.seismic_scale,
            "coastal_scale": s.coastal_scale,
        },
        "baseline": baseline,
        "mitigated": mitigated,
        "reduction": reduction(baseline, mitigated, spent),
    }
