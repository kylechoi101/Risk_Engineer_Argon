"""Offline regex parser for plain-language scenarios, used when Gemini is unavailable."""

import re

DEFAULT_KING_TIDE_FT_MLLW = 7.0
_NUMBER = r"(\d+(?:\.\d+)?)"
_FEET = r"\s*(?:ft|feet|foot)\b"
_MAGNITUDE = re.compile(r"\b(?:mw?|magnitude)\s*-?\s*(\d(?:\.\d+)?)", re.I)
_KING_TIDE = re.compile(r"king\s+tide", re.I)
_TIDE_LEVEL = (re.compile(_NUMBER + _FEET + r"(?:\s+\(?mllw\)?)?\s+king\s+tide", re.I),
               re.compile(r"king\s+tide\s+(?:of|at)?\s*" + _NUMBER + _FEET, re.I))
_SURGE = (re.compile(_NUMBER + _FEET + r"\s+(?:of\s+)?(?:storm\s+)?surge", re.I),
          re.compile(r"surge\s+(?:of\s+)?" + _NUMBER + _FEET, re.I))


def _first(patterns, text):
    for pattern in patterns:
        if match := pattern.search(text):
            return float(match.group(1))
    return None


def parse_prompt(prompt: str) -> list[dict]:
    hazards = []
    if match := _MAGNITUDE.search(prompt):
        hazards.append({"type": "earthquake", "magnitude": float(match.group(1))})
    if _KING_TIDE.search(prompt):
        level = _first(_TIDE_LEVEL, prompt)
        hazards.append({"type": "king_tide",
                        "water_level_ft_mllw": level if level is not None
                        else DEFAULT_KING_TIDE_FT_MLLW})
    if (surge := _first(_SURGE, prompt)) is not None:
        hazards.append({"type": "storm_surge", "surge_ft": surge})
    return hazards
