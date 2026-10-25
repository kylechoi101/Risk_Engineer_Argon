# Argon-Risk API contract

Backend: FastAPI on `http://localhost:8000`. Frontend: Next.js on `http://localhost:3000`
(the only CORS origin allowed by default). All bodies are JSON. Money is USD millions (`_m`).
Water levels say their datum in the field name.

The model is a stylized demo. Node fragilities, losses, fix costs and effects are
illustrative assumptions, not engineering estimates.

## Flow

1. `POST /api/runs` returns a `text/event-stream`. The backend parses the scenario, loads data,
   runs the baseline, asks Gemini for fixes, scores and ranks them, simulates a recommended
   bundle, saves the run, and streams one event per stage.
2. `POST /api/simulate` re-runs the saved run with any fix selection and returns one JSON
   response. It never calls Gemini or DataSF, and it uses the run's seed, so a toggle changes
   only what the fixes change.

## `POST /api/runs`

```json
{
  "center": {"lat": 37.7955, "lon": -122.3937, "label": "Ferry Building"},
  "radius_mi": 1.0,
  "hazards": [
    {"type": "earthquake", "magnitude": 7.2},
    {"type": "king_tide", "water_level_ft_mllw": 7.0}
  ],
  "prompt": null,
  "budget_m": 150,
  "seed": 42,
  "iterations": 4096,
  "max_fixes": 30
}
```

| Field | Rules |
|---|---|
| `center` | Must be within 500 m of the Ferry Building (37.7955, -122.3937). `label` optional. |
| `radius_mi` | 0.25 to 1.5. Default 1.0. |
| `hazards` | List. Types: `earthquake` (`magnitude` 5.5 to 8.0), `king_tide` (`water_level_ft_mllw` 0 to 15: still-water level above MLLW, NOAA station 9414290), `storm_surge` (`surge_ft` 0 to 13, added on top of the tide). At most one of each type. |
| `prompt` | Optional plain-language scenario, such as "M7.2 quake during a king tide". Parsed by Gemini, or by a regex parser offline. Explicit `hazards` win over parsed ones of the same type. |
| `budget_m` | CapEx ceiling for the recommended bundle. Default 150. |
| `seed`, `iterations` | Default 42 and 4096. Iterations 100 to 50000. |
| `max_fixes` | Most fixes Gemini may propose. 1 to 30, default 30. |

Without a `prompt`, the request needs an `earthquake` hazard or it fails with 422. With a
prompt, if neither the prompt nor `hazards` names an earthquake, the stream sends one `error`
event (stage `scenario`) and ends. With no water hazard, the water level is MHHW.

`scenario: {"magnitude": 7.2, "king_tide_ft": 7.0}` is accepted as shorthand for the two hazards
above.

Validation errors return 422 before the stream opens. Once the stream is open, failures are
reported as `error` events.

### Stream format

Standard SSE frames. `id` counts up from 1 within a run.

```
id: 3
event: sim.baseline
data: {...}

```

Events, in order:

| Event | When | Payload |
|---|---|---|
| `run.started` | first | `run_id`, `scenario` (see below), `prompt_parse`: `"gemini"`, `"regex"` or `"none"` |
| `data.layer` | 4 times | `layer` (`footprints`, `tall_buildings`, `soft_story`, `seismic_zones`), `source` (`snapshot` or `live`), `count`, `geojson` (FeatureCollection, lon/lat) |
| `exposure` | once | `building_count`, `seismic_zone_buildings`, `soft_story_open`, `tall_building_count`, `low_ground_count`, `seismic_scale`, `coastal_scale` |
| `sim.baseline` | once | `metrics`, `buildings`, `network`, `trace` |
| `agent.fixes` | once | `source` (`gemini`, `recorded` or `fallback`), `proposed`, `accepted`, `rejected`: `[{"id", "reason"}]` |
| `agent.text` | many | `delta`: a chunk of Gemini's narrative about the scenario and the proposed fixes |
| `fix.ranked` | once per kept fix | ranked fix (see below), in rank order |
| `sim.mitigated` | once | `bundle`, `result`, `buildings`, `trace` |
| `run.completed` | last | `run_id`, `dropped_fixes`: `[{"id", "reason"}]`, `timings_ms` (per stage) |
| `error` | on failure | `stage` (`scenario`, `data`, `exposure`, `baseline`, `agent.fixes`, `agent.text`, `scoring`, `bundle`, `store`), `message`, `fallback_used` (bool). The stream continues when a fallback was used, otherwise it ends. |

Fallbacks: a failed Gemini prompt parse uses the regex parser. Failed fix proposals use a
recorded reply, or the built-in 20 fixes when no recording matches (`source: "fallback"`). A
failed narrative uses a recorded or template narrative. A failed live DataSF fetch uses the
snapshot.

`scenario`:

```json
{
  "center": {"lat": 37.7955, "lon": -122.3937, "label": "Ferry Building"},
  "radius_mi": 1.0,
  "hazards": [{"type": "earthquake", "magnitude": 7.2}, {"type": "king_tide", "water_level_ft_mllw": 7.0}],
  "magnitude": 7.2,
  "water_level": {"ft_mllw": 7.0, "m_navd88": 2.15, "m_above_mhhw": 0.35},
  "seed": 42, "iterations": 4096, "budget_m": 150
}
```

`metrics` (also used for `baseline` and `mitigated` inside `result`):

```json
{
  "expected_loss_m": 412.3, "expected_fatalities": 9.1,
  "var99_m": 1160.84, "cvar99_m": 1229.46,
  "quantiles_m": {"p10": 0, "p25": 95.1, "p50": 300.2, "p75": 610.0, "p90": 860.4, "p95": 990.1, "p99": 1160.84},
  "node_failure_probs": {"seawall": 0.21, "substations": 0.43},
  "histogram": [{"bin_start": 0, "bin_end": 55.1, "probability": 0.21}]
}
```

`network`: `nodes` is `[{"id", "name", "lat", "lon"}]` and `edges` is
`[{"from", "to", "weight"}]`, where `from` is the upstream node whose failure raises the
failure chance of `to`.

`buildings`: `damage_p` is a list aligned with the `footprints` layer feature order
(`properties.id` equals the index). Each value is the modeled damage probability (shaking or
flooding), rounded to 3 decimals. `expected_damaged` is their sum. A footprint's flood term
depends on the seawall's failure probability, so seawall fixes lower it.

`trace` is one representative 1-in-100 draw: the iteration whose loss is nearest the baseline
CVaR₀.₉₉. Mitigated traces replay the same iteration with fixes applied.

```json
{
  "iteration": 1873, "loss_m": 1231.4,
  "events": [
    {"node_id": "seawall", "t_s": 1.0, "failed": true, "blocked": false, "cause": "hazard", "upstream": []},
    {"node_id": "substations", "t_s": 2.2, "failed": true, "blocked": false, "cause": "cascade", "upstream": ["seawall"]},
    {"node_id": "water_pump", "t_s": 4.6, "failed": false, "blocked": false, "cause": null, "upstream": ["substations", "fuel_terminal"]}
  ]
}
```

There is one event per node. `failed` is the outcome in this case. `blocked` is true only in
a mitigated trace, for a node that failed in the baseline but not here. `t_s` is a suggested
animation time: 1.0 s plus 1.2 s per level of failed upstream chain. For a node that failed,
`cause` is `hazard` or `cascade`. For a node that survived, `cause` is `null` and `t_s` is when
the upstream failures reached it. `upstream` lists the failed dependencies.

Ranked fix (`fix.ranked`):

```json
{
  "rank": 1,
  "fix": {"id": "gx_seawall_soil_mix", "title": "...", "category": "Civil", "target_node": "seawall",
          "cost_m": 45, "reduction_factor": 0.45, "impact": "...", "source": "gemini"},
  "delta_var99_m": 120.4, "delta_cvar99_m": 150.2, "delta_cvar99_ci95_m": [110.3, 190.8],
  "expected_loss_saved_m": 38.2, "roi": 0.85
}
```

Each fix is scored alone against the baseline with the same random draws. A fix is kept only
when the lower end of a 95% bootstrap interval on its CVaR₀.₉₉ reduction is above zero. Kept
fixes are ranked by `delta_cvar99_m`. `roi` is `expected_loss_saved_m / cost_m`. VaR is not
a cash flow, so it is not used for ROI.

`sim.mitigated.bundle` is `{"fix_ids", "spent_m", "budget_m"}`. It is chosen greedily: at each
step, add the kept fix with the largest extra CVaR₀.₉₉ reduction per dollar that still fits the
budget. `result` has the `/api/simulate` result shape.

## `POST /api/simulate`

```json
{"run_id": "r_8f3a...", "selected_fix_ids": ["gx_seawall_soil_mix", "fix_sub_3"], "budget_m": 150}
```

`budget_m` is optional (no ceiling when omitted). Fixes are applied in the order given, and any
that would exceed the budget are skipped. Unknown ids are ignored.

```json
{
  "run_id": "r_8f3a...",
  "result": {
    "config": {"magnitude": 7.2, "surge_m": 0.35, "iterations": 4096, "seed": 42, "budget_m": 150,
               "spent_m": 56, "applied_fix_ids": ["..."], "skipped_fix_ids": [],
               "seismic_scale": 1.06, "coastal_scale": 0.87},
    "baseline": {"...metrics"},
    "mitigated": {"...metrics"},
    "reduction": {"expected_loss_saved_m": 0, "expected_loss_reduction_pct": 0,
                  "expected_fatalities_saved": 0, "expected_fatalities_reduction_pct": 0,
                  "var99_reduction_m": 0, "cvar99_reduction_m": 0,
                  "net_benefit_m": 0, "benefit_cost_ratio": null}
  },
  "buildings": {"damage_p": [0.041], "expected_damaged": 312.4},
  "trace": {"iteration": 1873, "loss_m": 640.2, "events": []},
  "runtime_ms": 38.2
}
```

404 for an unknown `run_id`.

## Other routes

- `GET /api/runs/{run_id}` returns the saved `scenario`, `fixes` (all accepted fixes, with
  their scores) and `bundle`. 404 if unknown.
- `GET /api/health` returns `{"status": "ok", "agent": "live" | "recorded", "data": "snapshot" | "live"}`.

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `GEMINI_API_KEY` | unset | Required for the live agent. |
| `ARGON_AGENT` | `live` if a key is set, else `recorded` | `recorded` replays `backend/recordings/` and falls back to the built-in 20 fixes. |
| `ARGON_RECORD` | `0` | `1` saves each live Gemini reply to `backend/recordings/`. |
| `ARGON_GEMINI_MODEL` | `gemini-4-argon` | Model id. |
| `ARGON_LIVE_DATA` | `0` | `1` fetches DataSF live, falling back to the snapshot. |
| `ARGON_DB` | `backend/argon.db` | SQLite path for saved runs. |
| `ARGON_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins. |
