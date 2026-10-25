"""Building archetypes, fixes and hazard heuristics for the contract v1 bake.

Every number here is an illustrative assumption for a composite demonstration scenario, not
a site-calibrated fragility curve, ground-motion model, or inundation forecast.
"""

import numpy as np

# Hazus-style damage states: 0 none, 1 slight, 2 moderate, 3 extensive, 4 complete.
LOSS_RATIOS = np.array([0.0, 0.02, 0.10, 0.50, 1.0])
# Replacement cost by height class, USD per m2 of floor area (price year 2026, inferred).
REPLACEMENT_USD_PER_M2 = {"low": 3500.0, "mid": 4500.0, "high": 6000.0}
FLOOD_STATE_DEPTHS_M = np.array([0.05, 0.5, 1.2, 2.5])  # depth thresholds for states 1..4

# id, label, height class, in hazard area?, soft story?, median PGA (g) for states 1..4, beta
ARCHETYPES = [
    ("softstory_wood_lowrise", "Soft-story wood residential, 1–3 stories, retrofit not complete",
     "low", None, True, [0.12, 0.20, 0.35, 0.55], 0.6),
    ("lowrise_fill", "Low-rise, 1–3 stories, on mapped liquefaction or fill",
     "low", True, False, [0.15, 0.26, 0.45, 0.75], 0.6),
    ("lowrise_firm", "Low-rise, 1–3 stories, outside mapped hazard areas",
     "low", False, False, [0.18, 0.32, 0.55, 0.95], 0.6),
    ("midrise_fill", "Mid-rise, 4–7 stories, on mapped liquefaction or fill",
     "mid", True, False, [0.16, 0.28, 0.50, 0.85], 0.6),
    ("midrise_firm", "Mid-rise, 4–7 stories, outside mapped hazard areas",
     "mid", False, False, [0.20, 0.36, 0.62, 1.05], 0.6),
    ("highrise_fill", "High-rise, 8+ stories, on mapped liquefaction or fill",
     "high", True, False, [0.18, 0.32, 0.58, 1.00], 0.65),
    ("highrise_firm", "High-rise, 8+ stories, outside mapped hazard areas",
     "high", False, False, [0.22, 0.40, 0.70, 1.20], 0.65),
]
ARCHETYPE_IDS = [a[0] for a in ARCHETYPES]

SOURCES = {
    "seismic_zones": {"title": "DataSF Seismic Hazard Zones", "url": "https://data.sf.gov/d/re79-p8j5"},
    "seawall": {"title": "Port of San Francisco: Seismic and flood risk 101",
                "url": "https://www.sfport.com/wrp/seismic-flood-101"},
    "waterfront": {"title": "Port of San Francisco Waterfront Resilience Program",
                   "url": "https://www.sfport.com/wrp"},
    "soft_story": {"title": "SF DBI Soft Story Retrofit Program",
                   "url": "https://sfdbi.org/soft-story-retrofit-program"},
    "tsunami": {"title": "California Geological Survey tsunami hazard maps",
                "url": "https://www.conservation.ca.gov/cgs/tsunami/maps"},
    "tides": {"title": "NOAA station 9414290 San Francisco",
              "url": "https://tidesandcurrents.noaa.gov/stationhome.html?id=9414290"},
    "footprints": {"title": "DataSF Building Footprints", "url": "https://data.sf.gov/d/ynuv-fyni"},
    "neighborhoods": {"title": "DataSF Analysis Neighborhoods",
                      "url": "https://data.sf.gov/d/j2bu-swwd"},
}
# Links that returned HTTP 200 when this bake was written (2026-10-25). Others are dropped.
ALLOWED_DOMAINS = ("data.sf.gov", "sfport.com", "sfdbi.org", "conservation.ca.gov",
                   "tidesandcurrents.noaa.gov", "usgs.gov", "fema.gov", "sf.gov")


def height_class(stories: int) -> str:
    return "low" if stories <= 3 else "mid" if stories <= 7 else "high"


def classify(stories: int, in_hazard_area: bool, soft_story_open: bool) -> int:
    cls = height_class(stories)
    if soft_story_open and cls == "low":
        return 0
    for i, (_, _, c, hazard, soft, _, _) in enumerate(ARCHETYPES):
        if not soft and c == cls and hazard == in_hazard_area:
            return i
    raise ValueError("no archetype")


def median_pga_g(magnitude: float, east_m: np.ndarray, in_hazard_area: np.ndarray) -> np.ndarray:
    """Stylized shaking: San Andreas-like source to the west, fill and liquefaction amplify."""
    rock = 0.22 * 10 ** (0.45 * (magnitude - 7.0))
    distance_km = 14.0 + np.maximum(0.0, east_m + 3000.0) / 1000.0
    return rock * (17.0 / distance_km) * np.where(in_hazard_area, 1.4, 1.0)


def envelope(duration_s: float, magnitude: float) -> list[list[float]]:
    """Shaking amplitude 0..1 over time: fast rise, plateau, exponential decay."""
    peak = min(1.0, 0.45 + 0.18 * (magnitude - 6.0))
    points = []
    for t in np.linspace(0, duration_s, 26):
        rise = min(1.0, t / 4.0)
        decay = np.exp(-max(0.0, t - 9.0) / 5.0)
        amplitude = peak * rise * decay
        points.append([round(float(t), 2), round(float(amplitude), 3)])
    points[-1][1] = 0.0
    return points


def fixes(archetype_counts: dict[str, int], flood_zones: list[str]) -> list[dict]:
    """The five v1 fixes. Effects feed the Monte Carlo; costs are inferred ranges."""
    soft = archetype_counts.get("softstory_wood_lowrise", 0)
    fill = archetype_counts.get("lowrise_fill", 0) + archetype_counts.get("midrise_fill", 0)
    return [
        {"id": "fix_seawall_strengthening", "bit": 0, "kind": "flood",
         "group_label": "Low ground behind the seawall",
         "label": "Strengthen and raise the Embarcadero seawall",
         "applies_to_archetypes": [], "applies_to_nodes": ["seawall"], "applies_to_zones": flood_zones,
         "cost_usd": [50e6, 80e6], "evidence": "sourced",
         "sources": [SOURCES["seawall"], SOURCES["waterfront"]],
         "effect": {"flood_depth_factor": 0.4, "node_reduction_factor": 0.45},
         "rationale": "Limits seawall slumping and overtopping, which cuts flood depth behind the wall "
                      "and the outages that start there."},
        {"id": "fix_softstory_retrofit", "bit": 1, "kind": "building",
         "group_label": "Open soft-story wood buildings",
         "label": "Finish soft-story retrofits still open",
         "applies_to_archetypes": ["softstory_wood_lowrise"], "applies_to_nodes": [], "applies_to_zones": [],
         "cost_usd": [soft * 100e3, soft * 200e3], "evidence": "sourced",
         "sources": [SOURCES["soft_story"]],
         "effect": {"fragility_median_factor": 1.8},
         "rationale": "Steel moment frames or shear walls at the open ground floor roughly double the "
                      "shaking these buildings tolerate."},
        {"id": "fix_fill_ground_improvement", "bit": 2, "kind": "building",
         "group_label": "Low and mid-rise buildings on fill",
         "label": "Ground improvement under low and mid-rise buildings on fill",
         "applies_to_archetypes": ["lowrise_fill", "midrise_fill"], "applies_to_nodes": [],
         "applies_to_zones": [],
         "cost_usd": [fill * 250e3, fill * 500e3], "evidence": "sourced",
         "sources": [SOURCES["seismic_zones"]],
         "effect": {"fragility_median_factor": 1.35},
         "rationale": "Compaction grouting or deep soil mixing limits liquefaction settlement under "
                      "shallow foundations."},
        {"id": "fix_substation_isolation", "bit": 3, "kind": "infrastructure",
         "label": "Base-isolate waterfront substation transformers",
         "applies_to_archetypes": [], "applies_to_nodes": ["substations"], "applies_to_zones": [],
         "cost_usd": [26e6, 38e6], "evidence": "inferred", "sources": [],
         "effect": {"node_reduction_factor": 0.5},
         "rationale": "Keeps power on for pumps and communications, which blocks most of the cascade."},
        {"id": "fix_fuel_shutoffs", "bit": 4, "kind": "infrastructure",
         "label": "Flexible joints and seismic shutoffs at the fuel terminal",
         "applies_to_archetypes": [], "applies_to_nodes": ["fuel_terminal"], "applies_to_zones": [],
         "cost_usd": [19e6, 29e6], "evidence": "inferred", "sources": [],
         "effect": {"node_reduction_factor": 0.48},
         "rationale": "Prevents pipe rupture at tank manifolds, which removes the fuel-fire branch of "
                      "the natech cascade."},
    ]
