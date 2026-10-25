"""Turn untrusted Gemini fix proposals into engine Fix objects, or reject them with a reason."""

import re

from argon.engine.catalog import CATEGORIES, NODE_IDS, Fix

COST_RANGE_M = (1.0, 250.0)
REDUCTION_RANGE = (0.02, 0.60)

FIX_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "fixes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "category": {"type": "string", "enum": list(CATEGORIES)},
                    "target_node": {"type": "string", "enum": list(NODE_IDS)},
                    "cost_m": {"type": "number"},
                    "reduction_factor": {"type": "number"},
                    "impact": {"type": "string"},
                },
                "required": ["id", "title", "category", "target_node", "cost_m",
                             "reduction_factor", "impact"],
            },
        }
    },
    "required": ["fixes"],
}


def _clamp(value: float, bounds: tuple[float, float]) -> float:
    return max(bounds[0], min(bounds[1], value))


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:48]


def _one(item: object) -> Fix:
    if not isinstance(item, dict):
        raise ValueError("not an object")
    title = str(item.get("title") or "").strip()
    if not title:
        raise ValueError("missing title")
    categories = {c.lower(): c for c in CATEGORIES}
    category = categories.get(str(item.get("category", "")).strip().lower())
    if category is None:
        raise ValueError(f"category must be one of {', '.join(CATEGORIES)}")
    target = str(item.get("target_node", "")).strip()
    if target not in NODE_IDS:
        raise ValueError(f"unknown target_node {target!r}")
    try:
        cost = float(item["cost_m"])
        reduction = float(item["reduction_factor"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("cost_m and reduction_factor must be numbers") from exc
    slug = _slug(str(item.get("id") or title)) or _slug(title)
    return Fix(
        id=f"gx_{slug}", title=title[:120], category=category, target_node=target,
        cost_m=round(_clamp(cost, COST_RANGE_M), 2),
        reduction_factor=round(_clamp(reduction, REDUCTION_RANGE), 3),
        impact=str(item.get("impact") or "")[:400], source="gemini",
    )


def validate_fixes(items: list, max_fixes: int) -> tuple[list[Fix], list[dict]]:
    accepted: list[Fix] = []
    rejected: list[dict] = []
    for item in items:
        raw_id = item.get("id") if isinstance(item, dict) else None
        try:
            fix = _one(item)
        except ValueError as exc:
            rejected.append({"id": raw_id, "reason": str(exc)})
            continue
        if any(f.id == fix.id for f in accepted):
            rejected.append({"id": fix.id, "reason": "duplicate id"})
        elif len(accepted) >= max_fixes:
            rejected.append({"id": fix.id, "reason": "over max_fixes"})
        else:
            accepted.append(fix)
    return accepted, rejected
