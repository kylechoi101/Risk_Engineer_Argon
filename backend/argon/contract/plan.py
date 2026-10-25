"""Validate Gemini's contract plan (fixes + archetype fragility) or fall back to built-ins.

Gemini proposes; code decides. Every number is clamped, every reference is checked against the
known archetypes and network nodes, and a source link survives only if its domain is on the
allowlist and it resolves.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urlparse

from argon.contract.model import ALLOWED_DOMAINS, ARCHETYPE_IDS
from argon.contract.model import fixes as builtin_fixes
from argon.engine.catalog import NODE_IDS

MAX_FIXES = 5  # contract v1: 2^5 = 32 precomputed combos
KINDS = ("building", "flood", "infrastructure")
LIMITS = {
    "fragility_median_factor": (1.05, 2.5),
    "flood_depth_factor": (0.2, 0.95),
    "node_reduction_factor": (0.05, 0.6),
    "per_building_cost_usd": (5e3, 3e6),
    "total_cost_usd": (1e6, 5e9),
    "median_pga_g": (0.05, 2.5),
    "beta": (0.3, 0.9),
}

PLAN_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "fixes": {"type": "array", "items": {"type": "object", "properties": {
            "id": {"type": "string"}, "label": {"type": "string"},
            "kind": {"type": "string", "enum": list(KINDS)},
            "applies_to_archetypes": {"type": "array", "items": {"type": "string",
                                                                  "enum": list(ARCHETYPE_IDS)}},
            "applies_to_nodes": {"type": "array", "items": {"type": "string", "enum": list(NODE_IDS)}},
            "cost_usd_per_building": {"type": "array", "items": {"type": "number"}},
            "cost_usd": {"type": "array", "items": {"type": "number"}},
            "fragility_median_factor": {"type": "number"},
            "flood_depth_factor": {"type": "number"},
            "node_reduction_factor": {"type": "number"},
            "rationale": {"type": "string"}, "group_label": {"type": "string"},
            "sources": {"type": "array", "items": {"type": "object", "properties": {
                "title": {"type": "string"}, "url": {"type": "string"}}}},
        }, "required": ["id", "label", "kind", "rationale"]}},
        "archetypes": {"type": "array", "items": {"type": "object", "properties": {
            "id": {"type": "string", "enum": list(ARCHETYPE_IDS)},
            "median_pga_g": {"type": "array", "items": {"type": "number"}},
            "beta": {"type": "number"}, "rationale": {"type": "string"},
        }, "required": ["id", "median_pga_g", "beta"]}},
    },
    "required": ["fixes", "archetypes"],
}


@dataclass
class Plan:
    fixes: list[dict]
    archetypes: dict[str, dict] = field(default_factory=dict)
    source: str = "fallback"
    proposed: int = 0
    rejected: list[dict] = field(default_factory=list)


def _clamp(value, key: str) -> float:
    low, high = LIMITS[key]
    return round(max(low, min(high, float(value))), 4)


def _range(values, key: str) -> list[float]:
    lo, hi = sorted(_clamp(v, key) for v in (list(values) + [0, 0])[:2])
    return [lo, hi]


def _sources(items, url_ok: Callable[[str], bool]) -> list[dict]:
    kept = []
    for s in items or []:
        url = str((s or {}).get("url", ""))
        host = urlparse(url).hostname or ""
        allowed = url.startswith("https://") and any(
            host == d or host.endswith("." + d) for d in ALLOWED_DOMAINS)
        if allowed and url_ok(url):
            kept.append({"title": str(s.get("title") or host)[:120], "url": url})
    return kept[:3]


def _fix(raw: dict, counts: dict, flood_zones: list[str], url_ok) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("not an object")
    kind = raw.get("kind")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    label = str(raw.get("label") or "").strip()
    if not label:
        raise ValueError("missing label")
    archetypes = list(raw.get("applies_to_archetypes") or [])
    nodes = list(raw.get("applies_to_nodes") or [])
    if any(a not in ARCHETYPE_IDS for a in archetypes):
        raise ValueError("unknown archetype in applies_to_archetypes")
    if any(n not in NODE_IDS for n in nodes):
        raise ValueError("unknown node in applies_to_nodes")
    effect: dict[str, float] = {}
    if kind == "building":
        if not archetypes:
            raise ValueError("building fix needs applies_to_archetypes")
        effect["fragility_median_factor"] = _clamp(raw.get("fragility_median_factor", 1.3),
                                                   "fragility_median_factor")
        per = _range(raw.get("cost_usd_per_building") or [0, 0], "per_building_cost_usd")
        n = sum(counts.get(a, 0) for a in archetypes)
        cost = [per[0] * n, per[1] * n]
        nodes, zones = [], []
    else:
        if kind == "infrastructure" and not nodes:
            raise ValueError("infrastructure fix needs applies_to_nodes")
        if kind == "flood":
            effect["flood_depth_factor"] = _clamp(raw.get("flood_depth_factor", 0.5),
                                                  "flood_depth_factor")
        if nodes:
            effect["node_reduction_factor"] = _clamp(raw.get("node_reduction_factor", 0.3),
                                                     "node_reduction_factor")
        cost = _range(raw.get("cost_usd") or [0, 0], "total_cost_usd")
        archetypes, zones = [], (flood_zones if kind == "flood" else [])
    sources = _sources(raw.get("sources"), url_ok)
    slug = re.sub(r"[^a-z0-9]+", "_", str(raw.get("id") or label).lower()).strip("_")[:40]
    return {
        "id": f"gx_{slug}", "label": label[:90], "kind": kind,
        "applies_to_archetypes": archetypes, "applies_to_nodes": nodes, "applies_to_zones": zones,
        "cost_usd": [round(cost[0]), round(cost[1])],
        "evidence": "sourced" if sources else "inferred", "sources": sources, "effect": effect,
        "rationale": str(raw.get("rationale") or "")[:300],
        "group_label": str(raw.get("group_label") or label)[:90], "source": "gemini",
    }


def _archetype(raw: dict) -> dict:
    if not isinstance(raw, dict) or raw.get("id") not in ARCHETYPE_IDS:
        raise ValueError("unknown archetype")
    medians = [_clamp(v, "median_pga_g") for v in list(raw.get("median_pga_g") or [])]
    if len(medians) != 4 or any(b <= a for a, b in zip(medians, medians[1:], strict=False)):
        raise ValueError("median_pga_g must be 4 strictly increasing values")
    return {"median_pga_g": medians, "beta": _clamp(raw.get("beta", 0.6), "beta"),
            "rationale": str(raw.get("rationale") or "")[:300]}


def validate_plan(raw: object, counts: dict, flood_zones: list[str],
                  url_ok: Callable[[str], bool] = lambda url: True) -> Plan | None:
    """A validated Gemini plan, or None when no fix survives validation."""
    raw = raw if isinstance(raw, dict) else {}
    items = list(raw.get("fixes") or [])
    fixes, rejected = [], []
    for item in items:
        try:
            fix = _fix(item, counts, flood_zones, url_ok)
        except (ValueError, TypeError) as exc:
            rejected.append({"id": item.get("id") if isinstance(item, dict) else None,
                             "reason": str(exc)})
            continue
        if any(f["id"] == fix["id"] for f in fixes):
            rejected.append({"id": fix["id"], "reason": "duplicate id"})
        elif len(fixes) >= MAX_FIXES:
            rejected.append({"id": fix["id"], "reason": f"over {MAX_FIXES} fixes"})
        else:
            fixes.append({**fix, "bit": len(fixes)})
    if not fixes:
        return None
    archetypes = {}
    for item in raw.get("archetypes") or []:
        try:
            archetypes[item["id"]] = _archetype(item)
        except (ValueError, TypeError, KeyError):
            continue
    return Plan(fixes=fixes, archetypes=archetypes, source="gemini", proposed=len(items),
                rejected=rejected)


def default_plan(counts: dict, flood_zones: list[str]) -> Plan:
    return Plan(fixes=builtin_fixes(counts, flood_zones), source="fallback")
