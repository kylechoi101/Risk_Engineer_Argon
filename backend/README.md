# Argon-Risk backend

FastAPI service that streams a natech cascade analysis over SSE, then re-runs it with any fix
selection in a few milliseconds. The API contract, including every event payload, is in
[`../docs/api.md`](../docs/api.md).

## Run

```bash
uv sync
uv run fastapi dev          # http://localhost:8000, docs at /docs
uv run pytest
uv run ruff check .
```

Try a run:

```bash
curl -N -X POST localhost:8000/api/runs -H 'content-type: application/json' \
  -d '{"radius_mi": 1.0, "scenario": {"magnitude": 7.2, "king_tide_ft": 7.0}}'
```

## Layout

| Module | Job |
|---|---|
| `argon/engine/` | Pure, seeded math: cascade Monte Carlo (an exact port of `../src/simulation.js`), VaR/CVaR, building damage, trace, fix scoring, greedy budget. No I/O. |
| `argon/data/` | Snapshot builder, radius layers, live DataSF fetch behind a flag. |
| `argon/agent/` | Gemini, recorded and fallback agents behind one interface, plus validation and clamps for Gemini's fixes. |
| `argon/pipeline.py` | Runs the stages in order and yields stream events. |
| `argon/api.py`, `argon/main.py` | HTTP routes and the ASGI entrypoint. |
| `argon/store.py` | SQLite runs, keyed by `run_id`. |

## Offline demo

The demo runs with no network. Without `GEMINI_API_KEY`, the agent replays
`recordings/<scenario>.json`, or falls back to the 20 built-in fixes and a template narrative.
To record Gemini for the demo scenario, set `GEMINI_API_KEY` and `ARGON_RECORD=1` in `.env`, run
the scenario once, and commit the file it writes to `recordings/`.

## Data

`data/snapshot.json` holds DataSF footprints, tall buildings, soft-story properties, seismic
hazard zones and NOAA datums for a 2.5 km circle around the Ferry Building, collected
2026-10-25. Refresh it with `uv run python scripts/build_snapshot.py`. Raw downloads go to
`data/raw/` (gitignored).

## Parity with the browser engine

`tests/fixtures/js_golden.json` holds outputs from `../src/simulation.js`. The Python engine must
match them exactly. If the JS model changes, regenerate the fixture with
`node scripts/js_golden.mjs > tests/fixtures/js_golden.json`.

All model parameters are illustrative assumptions. This is a demo, not an engineering tool.
