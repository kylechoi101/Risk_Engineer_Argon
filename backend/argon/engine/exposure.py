"""Water-level datum conversion and the bounded exposure multipliers from src/app.js."""

FT_TO_M = 0.3048


def water_level(datums: dict, tide_ft_mllw: float | None = None, surge_ft: float = 0.0) -> dict:
    """Still-water level from a tide above MLLW plus surge. With no tide, use MHHW."""
    mhhw, mllw = datums["mhhw_navd88_m"], datums["mllw_navd88_m"]
    tide_m_navd88 = mhhw if tide_ft_mllw is None else tide_ft_mllw * FT_TO_M + mllw
    m_navd88 = tide_m_navd88 + surge_ft * FT_TO_M
    return {
        "ft_mllw": round((m_navd88 - mllw) / FT_TO_M, 2),
        "m_navd88": m_navd88,
        "m_above_mhhw": m_navd88 - mhhw,
    }


def exposure_scales(counts: dict, low_ground_count: int) -> tuple[float, float]:
    """Deliberately small, bounded adjustments: geographic exposure, not fitted loss curves."""
    total = max(1, counts["building_count"])
    seismic = (
        0.85
        + 0.55 * counts["seismic_zone_buildings"] / total
        + 0.10 * min(1, counts["soft_story_open"] / 20)
        + 0.05 * min(1, counts["tall_building_count"] / 150)
    )
    coastal = 0.85 + 0.45 * min(1, low_ground_count / 500)
    return seismic, coastal
