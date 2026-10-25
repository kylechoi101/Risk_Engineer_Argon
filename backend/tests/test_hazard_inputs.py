import numpy as np
import pytest

from argon.engine.buildings import BuildingArrays, damage_probabilities
from argon.engine.exposure import exposure_scales, water_level

DATUMS = {"mhhw_navd88_m": 1.798, "mllw_navd88_m": 0.018}


def test_king_tide_feet_above_mllw_converts_to_navd88_and_mhhw():
    level = water_level(DATUMS, tide_ft_mllw=7.0)
    assert level["m_navd88"] == pytest.approx(7.0 * 0.3048 + 0.018)
    assert level["m_above_mhhw"] == pytest.approx(7.0 * 0.3048 + 0.018 - 1.798)


def test_storm_surge_adds_to_tide_and_default_is_mhhw():
    assert water_level(DATUMS)["m_above_mhhw"] == pytest.approx(0.0)
    level = water_level(DATUMS, tide_ft_mllw=7.0, surge_ft=3.0)
    assert level["m_navd88"] == pytest.approx((7.0 + 3.0) * 0.3048 + 0.018)


def test_exposure_scales_match_browser_formula():
    counts = {"building_count": 3759, "seismic_zone_buildings": 1155, "soft_story_open": 13,
              "tall_building_count": 145}
    seismic, coastal = exposure_scales(counts, low_ground_count=250)
    assert seismic == pytest.approx(.85 + .55 * 1155 / 3759 + .10 * 13 / 20 + .05 * 145 / 150)
    assert coastal == pytest.approx(.85 + .45 * 250 / 500)


def arrays(**overrides):
    base = dict(in_zone=[False], soft_story_open=[False], soft_story_done=[False],
                tall_liquefaction=[False], height_m=[20.0], ground_m=[10.0])
    base.update(overrides)
    return BuildingArrays(**{k: np.array(v) for k, v in base.items()})


def p(buildings, magnitude=7.2, water=2.15, seawall=0.3):
    return damage_probabilities(buildings, magnitude, water, seawall)[0]


def test_hazard_zone_and_open_soft_story_raise_shaking_damage():
    plain = p(arrays())
    assert p(arrays(in_zone=[True])) > plain
    assert p(arrays(soft_story_open=[True])) > p(arrays(soft_story_done=[True]))


def test_low_ground_floods_and_seawall_failure_makes_it_worse():
    high, low = p(arrays(ground_m=[10.0])), p(arrays(ground_m=[1.0]))
    assert low > high
    assert p(arrays(ground_m=[1.0]), seawall=0.9) > p(arrays(ground_m=[1.0]), seawall=0.1)


def test_stronger_quake_means_more_damage_and_probabilities_stay_bounded():
    assert p(arrays(), magnitude=8.0) > p(arrays(), magnitude=6.0)
    worst = arrays(in_zone=[True], soft_story_open=[True], tall_liquefaction=[True],
                   height_m=[90.0], ground_m=[-1.0])
    assert 0 < p(worst, magnitude=8.0, water=4.0, seawall=1.0) <= 0.99
