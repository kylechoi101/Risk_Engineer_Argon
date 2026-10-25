// Client for the Argon-Risk backend (docs/api.md). The app uses it when /api/health answers,
// and falls back to the in-browser engine otherwise.

const MHHW_ABOVE_MLLW_M = 1.78; // NOAA 9414290
const FT = 0.3048;
const KING_TIDE_FT_MLLW = 7.0;

export async function backendAvailable() {
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

// The UI's water slider is meters above MHHW; the API takes a tide above MLLW plus surge.
export function hazardsFor(magnitude, surgeAboveMhhwM) {
  const totalFt = (surgeAboveMhhwM + MHHW_ABOVE_MLLW_M) / FT;
  const tideFt = Math.min(totalFt, KING_TIDE_FT_MLLW);
  const hazards = [
    { type: 'earthquake', magnitude },
    { type: 'king_tide', water_level_ft_mllw: Number(tideFt.toFixed(2)) }
  ];
  const surgeFt = totalFt - tideFt;
  if (surgeFt > 0.01) hazards.push({ type: 'storm_surge', surge_ft: Number(Math.min(13, surgeFt).toFixed(2)) });
  return hazards;
}

// POST /api/runs and call onEvent(name, data) for each SSE frame.
export async function streamRun(body, onEvent, signal) {
  const response = await fetch('/api/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal
  });
  if (!response.ok) throw new Error(`Run failed: ${response.status} ${await response.text()}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = {};
      for (const line of buffer.slice(0, end).split('\n')) {
        const colon = line.indexOf(': ');
        if (colon > 0) frame[line.slice(0, colon)] = line.slice(colon + 2);
      }
      buffer = buffer.slice(end + 2);
      if (frame.event) onEvent(frame.event, JSON.parse(frame.data));
    }
  }
}

export async function simulate(body, signal) {
  const response = await fetch('/api/simulate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal
  });
  if (!response.ok) throw new Error(`Simulate failed: ${response.status}`);
  return response.json();
}

const metrics = (m) => ({
  expectedLossMillions: m.expected_loss_m,
  expectedFatalities: m.expected_fatalities,
  var99Millions: m.var99_m,
  cvar99Millions: m.cvar99_m,
  quantilesMillions: m.quantiles_m,
  nodeFailureProbs: m.node_failure_probs,
  histogram: m.histogram.map((h) => ({ binStart: h.bin_start, binEnd: h.bin_end, probability: h.probability }))
});

// Map an /api/simulate response onto the shape the UI already renders (runSimulation's output).
export function toUiResult(response) {
  const { result } = response;
  const r = result.reduction;
  return {
    config: { runtimeMs: response.runtime_ms, spentMillions: result.config.spent_m,
              appliedFixIds: result.config.applied_fix_ids },
    baseline: metrics(result.baseline),
    mitigated: metrics(result.mitigated),
    overallReduction: {
      expectedLossSavedMillions: r.expected_loss_saved_m,
      expectedFatalitiesSaved: r.expected_fatalities_saved,
      var99ReductionMillions: r.var99_reduction_m,
      cvar99ReductionMillions: r.cvar99_reduction_m,
      netBenefitMillions: r.net_benefit_m,
      benefitCostRatio: r.benefit_cost_ratio
    },
    trace: response.trace
  };
}

// Map a fix.ranked event onto the UI's fix-card shape.
export function toUiFix(ranked) {
  const f = ranked.fix;
  return {
    id: f.id, title: f.title, category: f.category, targetNode: f.target_node, costMillions: f.cost_m,
    impact: f.impact, source: f.source, rank: ranked.rank,
    varReduction: Math.max(0, ranked.delta_var99_m), cvarReduction: ranked.delta_cvar99_m,
    expectedSaved: Math.max(0, ranked.expected_loss_saved_m), roi: Math.max(0, ranked.roi ?? 0)
  };
}
