import { describe, expect, it } from 'vitest';
import type { BuildingsMetadataSchema, ContractBundle } from '../types/dataContract';
import {
  analysisReady,
  buildPayload,
  displayOnset,
  pipelineAtClock,
  selectedFixCost,
  DISPLAY_TIMELINE,
} from './contractPayload';

const meta = {
  buildings: [
    { id: 0, centroid: [10, 20], ground_elevation_m: 2, height_m: 30 },
    { id: 1, centroid: [-5, 40], ground_elevation_m: 3, height_m: 12 },
    { id: 2, centroid: [0, 0], ground_elevation_m: 1, height_m: 50 },
  ],
} as unknown as BuildingsMetadataSchema;

const contract = {
  scenario: { earthquake: { duration_s: 25 }, wave: { arrival_s: 40 } },
  damage: {
    building_ids: [0, 1, 2],
    onset_s: [5, -1, 100],
    dominant_mode: ['shaking', 'none', 'flood'],
    outcomes: { '0': { state: [4, 0, 3], cost_usd_mid: [1, 0, 1] }, '1': { state: [2, 0, 1], cost_usd_mid: [1, 0, 1] } },
    outcomes_tail: { '0': { state: [4, 0, 4], cost_usd_mid: [1, 0, 1] }, '1': { state: [3, 0, 2], cost_usd_mid: [1, 0, 1] } },
  },
  summary: {
    fixes: [
      { id: 'a', bit: 0, label: 'A', cost_usd: [10, 20] },
      { id: 'b', bit: 1, label: 'B', cost_usd: [1, 2] },
    ],
  },
  pipeline: [
    { t_s: 0, node: 'gov_data', status: 'running', message: 'start' },
    { t_s: 2, node: 'gov_data', status: 'done', message: 'loaded' },
    { t_s: 8, node: 'monte_carlo', status: 'done', message: 'ran' },
  ],
} as unknown as ContractBundle;

describe('displayOnset', () => {
  it('maps quake seconds onto the shaking window and flood seconds onto the wave window', () => {
    expect(displayOnset(0, 'shaking', 25, 40, 200)).toBe(0);
    expect(displayOnset(25, 'shaking', 25, 40, 200)).toBeCloseTo(DISPLAY_TIMELINE.quakeEnd);
    expect(displayOnset(40, 'flood', 25, 40, 200)).toBeCloseTo(DISPLAY_TIMELINE.waveStart);
    expect(displayOnset(200, 'flood', 25, 40, 200)).toBeCloseTo(DISPLAY_TIMELINE.waveEnd);
    expect(displayOnset(-1, 'none', 25, 40, 200)).toBe(0);
  });
});

describe('buildPayload', () => {
  it('uses the selected combo states and the typical draw by default', () => {
    const p = buildPayload(contract, 1, 'p50', meta);
    expect(Array.from(p.states)).toEqual([2, 0, 1]);
    expect(Array.from(p.modes)).toEqual([0, 0, 1]);
    expect(p.onsetS[2]).toBeGreaterThanOrEqual(DISPLAY_TIMELINE.waveStart);
  });

  it('switches to the 1-in-100 draw and lists collapses in Three.js coordinates', () => {
    const p = buildPayload(contract, 0, 'tail', meta);
    expect(Array.from(p.states)).toEqual([4, 0, 4]);
    expect(p.collapseTargets.map((t) => t.id)).toEqual([0, 2]);
    expect(p.collapseTargets[0]).toMatchObject({ x: 10, y: 2, z: -20, height: 30 });
  });

  it('falls back to the typical draw when the file has no tail outcomes', () => {
    const noTail = { ...contract, damage: { ...contract.damage, outcomes_tail: undefined } };
    expect(Array.from(buildPayload(noTail, 0, 'tail', meta).states)).toEqual([4, 0, 3]);
  });
});

describe('helpers', () => {
  it('sums the cost range of the selected fixes', () => {
    expect(selectedFixCost(contract.summary, 0b11)).toEqual([11, 22]);
    expect(selectedFixCost(contract.summary, 0)).toEqual([0, 0]);
  });

  it('replays pipeline events scaled onto the display clock', () => {
    const early = pipelineAtClock(contract.pipeline, 2, 20);
    expect(early.visible.map((e) => e.message)).toEqual(['start']);
    expect(early.status.gov_data).toBe('running');
    const done = pipelineAtClock(contract.pipeline, 20, 20);
    expect(done.status.gov_data).toBe('done');
    expect(done.status.monte_carlo).toBe('done');
    expect(done.status.fix_planning).toBe('queued');
  });
});

describe('analysisReady', () => {
  it('reveals fixes and results only after the simulation has run', () => {
    expect(analysisReady('idle', contract)).toBe(false);
    expect(analysisReady('playing', contract)).toBe(false);
    expect(analysisReady('analysis_done', contract)).toBe(true);
    expect(analysisReady('analysis_done', null)).toBe(false);
  });
});
