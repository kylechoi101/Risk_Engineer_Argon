# Contract v1.1: additions to Backend Contract v1

Everything in contract v1 holds as written, and every v1 invariant passes
(`backend/argon/contract/check.py`). v1.1 only adds fields. A frontend that reads v1 keeps
working.

Bake the files into `public/data/`:

```bash
cd backend
uv run python scripts/bake_contract.py                                # interim buildings.json from scene.json
uv run python scripts/bake_contract.py --buildings ../path/buildings.json   # key to the frontend bake
```

The run fails, and writes nothing, if any invariant is violated.

## Decisions on the v1 open items

| Item | v1.1 choice |
|---|---|
| Fixes | 5 (bits 0–4): seawall, soft-story retrofit, ground improvement on fill, substation isolation, fuel-terminal shutoffs |
| Flood fixes and the water visual | Water stays unmitigated. The seawall fix only lowers flood depth for buildings in its zones. |
| Zones | DataSF Analysis Neighborhoods, assigned by building centroid. A building outside every polygon (piers, fill) goes to the nearest one. |
| Price year | 2026 |
| Five files | `buildings.json` is the fifth. Until the frontend bake exists, the backend writes an interim one keyed to `public/data/scene.json` order, wrapped as `{schema_version, seed, generated_at, buildings: [...]}`. With `--buildings` the backend never overwrites the frontend's file. |
| Determinism | Same inputs and seed give identical files, except `generated_at` and the elapsed `t_s` in `pipeline_events.json` |

## Added fields

`scenario.json`
- `disclaimer`: "Composite demonstration scenario ... Not a forecast."
- `wave.water_level_m_navd88`, `wave.king_tide_ft_mllw`, `wave.tsunami_run_up_m`: preset 7.0 ft MLLW + 2.0 m = 4.15 m NAVD88.
- `wave.inundation_grid.water_mask`: base64 float32, 1 = open bay water. Bay cells have arrival -1 and depth 0.

`buildings_damage.json`
- `representative_draws`: `{p50, tail, network: {p50, tail}}`. `p50` is the draw nearest the P50 total loss (contract v1). `tail` is nearest CVaR₀.₉₉ (1-in-100). `network` lists the infrastructure model's own draws, used for the cascade traces.
- `outcomes_tail`: same shape as `outcomes`, for the tail draw, so the frontend can toggle between "typical" and "1-in-100".

`summary.json`
- `archetypes[].fragility`: `{median_pga_g: [s1, s2, s3, s4], beta}`. These come from the built-in table for now.
- `fixes[]`: `applies_to_nodes`, `applies_to_zones`, `effect` (`fragility_median_factor`, `flood_depth_factor`, `node_reduction_factor`), `rationale`.
- `by_combo[k].risk`: `expected_loss_usd`, `var99_usd`, `cvar99_usd` (buildings plus infrastructure), `building_expected_loss_usd`, `infrastructure_expected_loss_usd`, `node_failure_probs`.
- `by_combo[k].cascade_trace`: `{p50, tail}`. Each is `{iteration, loss_usd, events: [{node_id, t_s, failed, blocked, cause, upstream}]}`, where `blocked` means the node failed in combo 0 but not here. `t_s` is in contract seconds: shaking-led failures at 8 s, surge-led failures at the wave's arrival at the node, plus 6 s per cascade step.
- `network`: `nodes [{id, name, centroid_enu_m}]` and `edges [{from, to, weight}]`.

## Models (all illustrative)

- Shaking: median PGA is 0.22 g at M7.0, scaled 10^(0.45·ΔM), falls off with distance from a source to the west, and is amplified 1.4× in DataSF seismic hazard areas. Inter-event variability is lognormal with σ 0.3.
- Damage: lognormal fragility per archetype. Each building gets one standard-normal capacity draw per realization, reused for every combo, so a fix can never make a building worse. Flood state comes from peak depth at the building's cell (thresholds 0.05 / 0.5 / 1.2 / 2.5 m). The final state is the worse of shaking and flood.
- Loss: Hazus-style loss ratios 0 / 2 / 10 / 50 / 100% × an inferred replacement cost (footprint area × stories × $3,500–6,000/m²).
- Wave grid: ground is inverse-distance weighted from footprint `gnd_min_m`. Bay cells are cells over 150 m from any footprint that connect to the north or east edge. Land floods by flood-fill from the bay while the water level, decaying 1.5 m per km inland, stays above ground. Arrival is 40 s + distance ÷ 2.5 m/s. This is a screening heuristic.
- Infrastructure: the 8-node cascade from `docs/api.md`, run on the same number of draws and with the same seed for every combo.

## Not done yet

- The CGS Tsunami Hazard Area polygon is not used as the wet extent. Its ArcGIS service requires a token, so the extent comes from the heuristic above.
- Gemini does not yet supply archetype fragility, fix text or rationale. All of these come from built-in tables, and every archetype is `evidence: "inferred"`.
- Source links are the ones that returned HTTP 200 on 2026-10-25. The USGS and FEMA pages returned 403 to scripted checks and are left out.
- The SSE stream does not yet carry these documents. They are baked files only.
