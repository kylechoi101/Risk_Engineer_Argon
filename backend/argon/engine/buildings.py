"""Per-building damage probabilities for coloring the 3D scene.

Analytic (no random draws), so it never perturbs the cascade model's random stream. Shaking
and flooding terms are stylized screening heuristics, not structural fragility curves.
"""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class BuildingArrays:
    in_zone: np.ndarray  # bool: footprint center inside a mapped seismic hazard zone
    soft_story_open: np.ndarray  # bool: soft-story property not marked "Work Complete"
    soft_story_done: np.ndarray  # bool: soft-story retrofit marked complete
    tall_liquefaction: np.ndarray  # bool: tall-building record with High/Very High potential
    height_m: np.ndarray
    ground_m: np.ndarray  # DataSF gnd_min_m, compared against water level in NAVD88 meters

    def __len__(self) -> int:
        return len(self.height_m)


BASE_SHAKING_DAMAGE = 0.12  # at the M8.0 reference intensity, ordinary building
FLOOD_DEPTH_SCALE_M = 0.6  # depth at which flood damage reaches ~63%
SETTLEMENT_M = 0.3  # liquefaction settlement in hazard zones at the reference intensity


def shaking_intensity(magnitude: float) -> float:
    """Same intensity scaling as the cascade model: 1.0 at M8.0."""
    m = max(5.5, min(8.0, magnitude))
    return 10 ** (0.58 * (m - 5.5)) / 10 ** (0.58 * 2.5)


def damage_probabilities(
    b: BuildingArrays, magnitude: float, water_m_navd88: float, seawall_fail_p: float
) -> np.ndarray:
    """Probability each footprint is damaged by shaking or flooding."""
    intensity = shaking_intensity(magnitude)
    multiplier = (
        np.where(b.in_zone, 2.2, 1.0)
        * np.where(b.soft_story_open, 3.0, np.where(b.soft_story_done, 0.8, 1.0))
        * np.where(b.tall_liquefaction, 1.4, 1.0)
        * np.where(b.height_m > 45, 1.15, 1.0)
    )
    shaking = np.minimum(0.95, BASE_SHAKING_DAMAGE * intensity * multiplier)

    # Liquefaction settles hazard-zone ground, compounding the flood depth (the natech link).
    ground = b.ground_m - np.where(b.in_zone, SETTLEMENT_M * intensity, 0.0)
    depth = np.maximum(0.0, water_m_navd88 - ground)
    exposure = 1.0 - np.exp(-depth / FLOOD_DEPTH_SCALE_M)
    # Part of the low ground floods regardless; the rest only when the seawall fails.
    flooding = exposure * (0.35 + 0.65 * float(np.clip(seawall_fail_p, 0, 1)))
    return np.minimum(0.99, 1.0 - (1.0 - shaking) * (1.0 - flooding))


def building_summary(probabilities: np.ndarray) -> dict:
    return {
        "damage_p": [round(float(x), 3) for x in probabilities],
        "expected_damaged": round(float(probabilities.sum()), 1),
    }
