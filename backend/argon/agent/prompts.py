"""Prompt text for Gemini and the offline template narrative. Pure string building."""

import json

from argon.agent.validate import COST_RANGE_M, REDUCTION_RANGE
from argon.engine.catalog import CATEGORIES, NODES

HAZARD_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "hazards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["earthquake", "king_tide", "storm_surge"]},
                    "magnitude": {"type": "number"},
                    "water_level_ft_mllw": {"type": "number"},
                    "surge_ft": {"type": "number"},
                },
                "required": ["type"],
            },
        }
    },
    "required": ["hazards"],
}


def parse_prompt_text(prompt: str) -> str:
    return (
        "Extract the hazards from this San Francisco waterfront disaster scenario.\n"
        "Types: earthquake (magnitude), king_tide (water_level_ft_mllw: still-water level in "
        "feet above MLLW at NOAA station 9414290; a typical king tide is 7.0), storm_surge "
        "(surge_ft added on top of the tide). Omit hazards that are not mentioned.\n\n"
        f"Scenario: {prompt}"
    )


def _network() -> list[dict]:
    return [{"id": n.id, "name": n.name, "depends_on": n.deps} for n in NODES]


def fixes_prompt(context: dict, max_fixes: int) -> str:
    return (
        "You are a senior infrastructure risk engineer. A Monte Carlo cascade model of the San "
        "Francisco waterfront near the Ferry Building produced the baseline below. Propose up "
        f"to {max_fixes} specific, proactive engineering fixes that would block the cascade.\n\n"
        "Rules:\n"
        f"- category is one of {', '.join(CATEGORIES)}.\n"
        "- target_node is one node id from the network.\n"
        f"- cost_m is upfront CapEx in USD millions, {COST_RANGE_M[0]:g} to {COST_RANGE_M[1]:g}.\n"
        f"- reduction_factor is the fraction of the node's failure probability removed, "
        f"{REDUCTION_RANGE[0]} to {REDUCTION_RANGE[1]}. Be realistic: cheap software fixes "
        "rarely exceed 0.3.\n"
        "- Cover every node with high failure probability, and mix categories on the same "
        "node: the model rewards Civil + Hardware + Software combinations.\n"
        "- impact is one sentence on the failure mechanism the fix blocks.\n\n"
        f"Network: {json.dumps(_network())}\n"
        f"Scenario: {json.dumps(context['scenario'])}\n"
        f"Exposure: {json.dumps(context.get('exposure', {}))}\n"
        f"Baseline: {json.dumps(context['baseline'])}\n"
    )


def narrative_prompt(context: dict) -> str:
    return (
        "In about 120 words of plain prose for a risk engineer, explain how this scenario "
        "cascades through the waterfront network, which failures drive the 1-in-100 tail, and "
        "how the proposed fixes break the chain. Say that the model is a stylized demo, not "
        "an engineering estimate. No headings or lists.\n\n"
        f"Network: {json.dumps(_network())}\n"
        f"Scenario: {json.dumps(context['scenario'])}\n"
        f"Baseline: {json.dumps(context['baseline'])}\n"
        f"Proposed fixes: {json.dumps(context.get('fixes', []))}\n"
    )


def template_narrative(context: dict) -> str:
    scenario, baseline = context["scenario"], context["baseline"]
    names = {n.id: n.name for n in NODES}
    probs = baseline.get("node_failure_probs", {})
    weakest = sorted(probs, key=probs.get, reverse=True)[:2]
    weak_text = (
        " and ".join(f"{names.get(n, n)} ({probs[n]:.0%})" for n in weakest)
        if weakest else "the seawall and substations"
    )
    targets = sorted({names.get(f["target_node"], f["target_node"])
                      for f in context.get("fixes", [])})
    fix_text = (f" The proposed fixes target {', '.join(targets)}." if targets else "")
    return (
        f"M{scenario['magnitude']:.1f} shaking during a {scenario['water_level']['ft_mllw']:.1f} ft "
        f"(MLLW) tide puts the most strain on {weak_text}. When the seawall slumps, flooding "
        "reaches the substations, and the outage spreads to pumps, communications and the "
        "ferry terminal. A fuel fire with no firefighting water is what drives the 1-in-100 "
        f"tail: VaR 0.99 is ${baseline['var99_m']:,.0f}M and CVaR 0.99 is "
        f"${baseline['cvar99_m']:,.0f}M.{fix_text} This replay uses recorded analysis, and the "
        "model is a stylized demo, not an engineering estimate."
    )


def contract_plan_prompt(context: dict) -> str:
    """Ask for the five demo fixes plus archetype fragility, for the baked contract files."""
    from argon.contract.plan import LIMITS, MAX_FIXES

    return (
        "You are Argon, a senior infrastructure risk engineer planning retrofits for a composite "
        "earthquake + wave scenario on the San Francisco waterfront (1 mile around the Ferry "
        "Building). Code will run a seeded Monte Carlo over every combination of your fixes; you "
        "only choose the fixes and the fragility parameters.\n\n"
        f"Return exactly {MAX_FIXES} fixes, mixing the kinds:\n"
        "- kind 'flood' (seawall / floodwall / barrier): set flood_depth_factor (fraction of flood "
        f"depth left, {LIMITS['flood_depth_factor'][0]}-{LIMITS['flood_depth_factor'][1]}), cost_usd "
        "[low, high] total, and optionally applies_to_nodes ['seawall'] with node_reduction_factor.\n"
        "- kind 'building': applies_to_archetypes (ids below), fragility_median_factor (how much "
        f"stronger, {LIMITS['fragility_median_factor'][0]}-{LIMITS['fragility_median_factor'][1]}), "
        "cost_usd_per_building [low, high].\n"
        "- kind 'infrastructure': applies_to_nodes (ids below), node_reduction_factor "
        f"({LIMITS['node_reduction_factor'][0]}-{LIMITS['node_reduction_factor'][1]}), cost_usd total.\n"
        "Target what drives the most loss: many buildings, high node failure probabilities, the "
        "fuel-fire natech chain. Use realistic 2026 USD. label is a short imperative title; "
        "group_label names the buildings it protects; rationale is one or two plain sentences on "
        "the failure mechanism it blocks.\n"
        "sources: only real, existing government pages (sf.gov, sfport.com, sfdbi.org, "
        "data.sf.gov, conservation.ca.gov, usgs.gov, fema.gov, tidesandcurrents.noaa.gov). Leave "
        "the list empty rather than guess a URL; unverifiable links are discarded.\n\n"
        "Also return archetypes: for any archetype whose default fragility you would change, its "
        "lognormal median PGA in g for damage states slight, moderate, extensive, complete "
        "(4 strictly increasing values) and beta.\n\n"
        f"Scenario: {json.dumps(context['scenario'])}\n"
        f"Archetypes: {json.dumps(context['archetypes'])}\n"
        f"Flood-exposed neighborhoods: {json.dumps(context['flood_zones'])}\n"
        f"Infrastructure network: {json.dumps(context['nodes'])}\n"
    )
