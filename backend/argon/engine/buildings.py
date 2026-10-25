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
