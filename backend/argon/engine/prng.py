"""Vectorized port of the mulberry32 generator used by src/simulation.js.

mulberry32 is counter-based: call k (0-based) hashes seed + (k + 1) * 0x6D2B79F5 mod 2**32,
so the whole stream can be computed at once while matching the JS output bit for bit.
"""

import numpy as np

_STEP = np.uint64(0x6D2B79F5)
_MASK = np.uint64(0xFFFFFFFF)


def uniforms(seed: int, count: int) -> np.ndarray:
    """Return the first `count` draws of mulberry32(seed) as float64 in [0, 1)."""
    k = np.arange(1, count + 1, dtype=np.uint64)
    a = ((np.uint64(seed & 0xFFFFFFFF) + k * _STEP) & _MASK).astype(np.uint32)
    with np.errstate(over="ignore"):
        t = (a ^ (a >> np.uint32(15))) * (a | np.uint32(1))
        t ^= t + (t ^ (t >> np.uint32(7))) * (t | np.uint32(61))
        t ^= t >> np.uint32(14)
    return t.astype(np.float64) / 4294967296.0
