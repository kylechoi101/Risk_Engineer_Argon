"""One representative cascade, timed for the 3D replay."""

from collections.abc import Sequence

import numpy as np

from argon.engine.cascade import CaseRun, cvar99
from argon.engine.catalog import NODES, Node

FIRST_FAILURE_S = 1.0
STEP_S = 1.2


def representative_iteration(baseline: CaseRun) -> int:
    """The draw whose loss is nearest the baseline CVaR 0.99: a typical 1-in-100 disaster."""
    return int(np.argmin(np.abs(baseline.losses - cvar99(baseline.losses))))


def cascade_trace(
    run: CaseRun, iteration: int, baseline: CaseRun | None = None,
    nodes: Sequence[Node] = NODES,
) -> dict:
    failed = run.failed[iteration]
    index = {n.id: i for i, n in enumerate(nodes)}
    depth: dict[str, int] = {}
    events = []
    for i, node in enumerate(nodes):  # nodes are in dependency order
        upstream = [d for d in node.deps if failed[index[d]]]
        depth[node.id] = 1 + max(depth[d] for d in upstream) if upstream else 0
        events.append({
            "node_id": node.id,
            "t_s": round(FIRST_FAILURE_S + STEP_S * depth[node.id], 2),
            "failed": bool(failed[i]),
            "blocked": bool(baseline is not None and baseline.failed[iteration, i] and not failed[i]),
            "cause": None if not failed[i] else "cascade" if upstream else "hazard",
            "upstream": upstream,
        })
    return {"iteration": iteration, "loss_m": round(float(run.losses[iteration]), 2),
            "events": events}
