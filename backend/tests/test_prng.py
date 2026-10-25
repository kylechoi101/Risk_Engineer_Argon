import json
from pathlib import Path

from argon.engine.prng import uniforms

GOLDEN = json.loads((Path(__file__).parent / "fixtures/js_golden.json").read_text())


def test_matches_js_mulberry32_stream():
    assert uniforms(42, 8).tolist() == GOLDEN["prng_seed42_first8"]


def test_same_seed_same_stream_and_values_in_unit_interval():
    a, b = uniforms(7, 1000), uniforms(7, 1000)
    assert (a == b).all()
    assert a.min() >= 0 and a.max() < 1
