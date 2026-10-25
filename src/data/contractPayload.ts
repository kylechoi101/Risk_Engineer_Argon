/**
 * Turn the backend contract files into the per-building payload the damage shader plays.
 * Pure functions: no fetching, no store access.
 */
import type { DamageState, PipelineNodeId, PipelineStatus } from '../config/constants';
import { PIPELINE_NODES } from '../config/constants';
import type {
  BuildingsMetadataSchema,
  ContractBundle,
  PipelineEvent,
  SummarySchema,
} from '../types/dataContract';
import type { CollapseTarget, ShaderProofPayload } from '../store/useSimulationStore';

export type DrawView = 'p50' | 'tail';

/**
 * The scene animates a 20 s display timeline: shaking until 8.5 s, then the wave front
 * advancing until ~15.5 s. Contract times (seconds from quake start) are mapped onto it.
 */
export const DISPLAY_TIMELINE = { quakeEnd: 8.5, waveStart: 8.5, waveEnd: 15.5, duration: 20 };
const MAX_COLLAPSE_TARGETS = 65;

export function displayOnset(
  onsetS: number,
  mode: string,
  quakeDurationS: number,
  waveArrivalS: number,
  lastFloodOnsetS: number
): number {
  if (onsetS < 0 || mode === 'none') return 0;
  if (mode === 'flood') {
    const span = Math.max(1, lastFloodOnsetS - waveArrivalS);
    const f = Math.min(1, Math.max(0, (onsetS - waveArrivalS) / span));
    return DISPLAY_TIMELINE.waveStart + f * (DISPLAY_TIMELINE.waveEnd - DISPLAY_TIMELINE.waveStart);
  }
  const f = Math.min(1, Math.max(0, onsetS / Math.max(1, quakeDurationS)));
  return f * DISPLAY_TIMELINE.quakeEnd;
}

export function buildPayload(
  contract: ContractBundle,
  mask: number,
  view: DrawView,
  meta: BuildingsMetadataSchema | null
): ShaderProofPayload {
  const { damage, scenario } = contract;
  const outcomes = view === 'tail' && damage.outcomes_tail ? damage.outcomes_tail : damage.outcomes;
  const combo = outcomes[String(mask)] ?? outcomes['0'];
  const n = damage.building_ids.length;
  const quake = scenario.earthquake.duration_s;
  const arrival = scenario.wave.arrival_s;
  let lastFlood = arrival;
  for (let i = 0; i < n; i++) {
    if (damage.dominant_mode[i] === 'flood') lastFlood = Math.max(lastFlood, damage.onset_s[i]);
  }

  const states = new Uint8Array(n);
  const onsetS = new Float32Array(n);
  const modes = new Uint8Array(n);
  const collapseTargets: CollapseTarget[] = [];
  for (let i = 0; i < n; i++) {
    const mode = damage.dominant_mode[i];
    states[i] = combo.state[i] as DamageState;
    modes[i] = mode === 'flood' ? 1 : 0;
    onsetS[i] = displayOnset(damage.onset_s[i], mode, quake, arrival, lastFlood);
    const b = meta?.buildings[damage.building_ids[i]];
    if (states[i] === 4 && b && collapseTargets.length < MAX_COLLAPSE_TARGETS) {
      collapseTargets.push({
        id: i,
        x: b.centroid[0],
        y: b.ground_elevation_m,
        z: -b.centroid[1], // ENU north -> Three.js -Z
        height: b.height_m,
        onset: onsetS[i],
      });
    }
  }
  return { states, onsetS, modes, collapseTargets };
}

/** Fixes and loss results appear only once the simulation has finished running. */
export function analysisReady(phase: string, contract: ContractBundle | null): boolean {
  return contract !== null && phase === 'analysis_done';
}

export function selectedFixCost(summary: SummarySchema, mask: number): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const fix of summary.fixes) {
    if (mask & (1 << fix.bit)) {
      lo += fix.cost_usd[0];
      hi += fix.cost_usd[1];
    }
  }
  return [lo, hi];
}

/** Recorded pipeline events stretched to finish at 80% of the display timeline. */
export function pipelineAtClock(
  events: PipelineEvent[],
  clock: number,
  duration: number
): { visible: PipelineEvent[]; status: Record<PipelineNodeId, PipelineStatus> } {
  const lastT = Math.max(1e-6, ...events.map((e) => e.t_s));
  const scale = (duration * 0.8) / lastT;
  const visible = events.filter((e) => e.t_s * scale <= clock + 1e-9);
  const status = Object.fromEntries(PIPELINE_NODES.map((n) => [n, 'queued'])) as Record<
    PipelineNodeId,
    PipelineStatus
  >;
  for (const e of visible) status[e.node] = e.status;
  return { visible, status };
}

export function formatUsd(value: number): string {
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}
