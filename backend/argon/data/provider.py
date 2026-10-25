"""Where request layers come from: the committed snapshot, or DataSF live behind a flag."""

import datetime
import os
from collections.abc import Callable, Mapping
from functools import lru_cache

from argon.data.snapshot import build_snapshot, layers_for, load_snapshot
from argon.data.sources import fetch_raw

# radius_m -> (layers, source, warning or None)
LayerProvider = Callable[[float], tuple[dict, str, str | None]]


@lru_cache(maxsize=8)
def _snapshot_layers(radius_m: int) -> dict:
    return layers_for(load_snapshot(), radius_m)


def snapshot_provider(radius_m: float) -> tuple[dict, str, str | None]:
    return _snapshot_layers(round(radius_m)), "snapshot", None


@lru_cache(maxsize=1)
def _live_snapshot() -> dict:
    return build_snapshot(fetch_raw(timeout=20), collected=datetime.date.today().isoformat())


def live_provider(radius_m: float) -> tuple[dict, str, str | None]:
    try:
        return layers_for(_live_snapshot(), radius_m), "live", None
    except Exception as exc:  # network or parse failure: the demo must keep running
        layers, _, _ = snapshot_provider(radius_m)
        return layers, "snapshot", f"live DataSF fetch failed ({exc}); used snapshot"


def make_provider(env: Mapping[str, str] = os.environ) -> LayerProvider:
    return live_provider if env.get("ARGON_LIVE_DATA") == "1" else snapshot_provider


def datums() -> dict:
    return load_snapshot()["datums"]
