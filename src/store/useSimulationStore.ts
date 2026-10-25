import { create } from 'zustand';
import {
  SHADER_PROOF_DURATION_S,
  type DamageState,
  type SimulationStatusLabel,
} from '../config/constants';
import type { BuildingsMetadataSchema } from '../types/dataContract';

export type SimulationPhase = 'idle' | 'playing' | 'analysis_done';
export type SortMode = 'priority' | 'cost';
export type CameraMode = 'drift' | 'orbit';

export interface CollapseTarget {
  id: number;
  x: number;
  y: number;
  z: number;
  height: number;
  onset: number;
}

export interface ShaderProofPayload {
  /** Per-building target damage state 0..4 */
  states: Uint8Array;
  /** Per-building onset time in seconds (0..16s) */
  onsetS: Float32Array;
  /** Per-building dominant mode: 0 = shaking, 1 = flood */
  modes: Uint8Array;
  /** Subset of state-4 buildings for instanced dust puff particle bursts */
  collapseTargets: CollapseTarget[];
}

export interface PerfStats {
  fps: number;
  triangles: number;
  drawCalls: number;
  buildingCount: number;
}

interface SimulationStoreState {
  // Core store fields required by spec
  phase: SimulationPhase;
  clock: number;
  duration: number;
  selectedFixMask: number;
  sortMode: SortMode;
  hoveredGroupId: string | null;

  // Phase 1 District & Shader Proof State
  buildingsMeta: BuildingsMetadataSchema | null;
  isShaderProof: boolean;
  shaderProofPayload: ShaderProofPayload | null;
  statusLabel: SimulationStatusLabel;

  // Camera & Interaction
  cameraMode: CameraMode;
  hoveredBuildingId: number | null;
  hoveredPointer: { x: number; y: number } | null;

  // Debug Overlay (toggled with D)
  debugOpen: boolean;
  wireframe: boolean;
  perfStats: PerfStats;

  // Actions
  setBuildingsMeta: (meta: BuildingsMetadataSchema) => void;
  setPhase: (phase: SimulationPhase) => void;
  setClock: (clock: number) => void;
  advanceClock: (dt: number) => void;
  setSelectedFixMask: (mask: number) => void;
  toggleFixBit: (bit: number) => void;
  setSortMode: (mode: SortMode) => void;
  setHoveredGroupId: (groupId: string | null) => void;
  setHoveredBuilding: (id: number | null, pointer?: { x: number; y: number } | null) => void;
  setCameraMode: (mode: CameraMode) => void;
  toggleDebug: () => void;
  toggleWireframe: () => void;
  setPerfStats: (stats: Partial<PerfStats>) => void;

  // Simulation / Shader Proof Triggers
  startShaderProof: () => void;
  resetSimulation: () => void;
}

/**
 * Deterministic seeded PRNG (Mulberry32) so the Phase 1 Shader Proof ('P' key)
 * is repeatable and realistic across the district.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function computeStatusLabel(
  phase: SimulationPhase,
  clock: number,
  isShaderProof: boolean
): SimulationStatusLabel {
  if (phase === 'idle') return 'Idle';
  if (phase === 'analysis_done') return 'Complete';
  if (isShaderProof) {
    if (clock < 8.5) return 'Earthquake';
    if (clock < SHADER_PROOF_DURATION_S) return 'Wave surge';
    return 'Complete';
  }
  if (clock < 25) return 'Earthquake';
  return 'Wave surge';
}

export const useSimulationStore = create<SimulationStoreState>((set, get) => ({
  phase: 'idle',
  clock: 0,
  duration: SHADER_PROOF_DURATION_S,
  selectedFixMask: 0,
  sortMode: 'priority',
  hoveredGroupId: null,

  buildingsMeta: null,
  isShaderProof: false,
  shaderProofPayload: null,
  statusLabel: 'Idle',

  cameraMode: 'drift',
  hoveredBuildingId: null,
  hoveredPointer: null,

  debugOpen: false,
  wireframe: false,
  perfStats: {
    fps: 60,
    triangles: 0,
    drawCalls: 0,
    buildingCount: 0,
  },

  setBuildingsMeta: (meta) =>
    set((state) => ({
      buildingsMeta: meta,
      perfStats: { ...state.perfStats, buildingCount: meta.building_count },
    })),

  setPhase: (phase) =>
    set((state) => ({
      phase,
      statusLabel: computeStatusLabel(phase, state.clock, state.isShaderProof),
    })),

  setClock: (clock) =>
    set((state) => ({
      clock,
      statusLabel: computeStatusLabel(state.phase, clock, state.isShaderProof),
    })),

  advanceClock: (dt) => {
    const state = get();
    if (state.phase !== 'playing') return;
    const nextClock = state.clock + dt;
    if (nextClock >= state.duration) {
      set({
        clock: state.duration,
        phase: 'analysis_done',
        statusLabel: 'Complete',
      });
    } else {
      set({
        clock: nextClock,
        statusLabel: computeStatusLabel('playing', nextClock, state.isShaderProof),
      });
    }
  },

  setSelectedFixMask: (mask) => set({ selectedFixMask: mask }),

  toggleFixBit: (bit) =>
    set((state) => ({
      selectedFixMask: state.selectedFixMask ^ (1 << bit),
    })),

  setSortMode: (sortMode) => set({ sortMode }),

  setHoveredGroupId: (hoveredGroupId) => set({ hoveredGroupId }),

  setHoveredBuilding: (id, pointer = null) =>
    set({ hoveredBuildingId: id, hoveredPointer: pointer }),

  setCameraMode: (cameraMode) => set({ cameraMode }),

  toggleDebug: () => set((state) => ({ debugOpen: !state.debugOpen })),

  toggleWireframe: () => set((state) => ({ wireframe: !state.wireframe })),

  setPerfStats: (partial) =>
    set((state) => ({
      perfStats: { ...state.perfStats, ...partial },
    })),

  startShaderProof: () => {
    const meta = get().buildingsMeta;
    const count = meta ? meta.building_count : 3200;
    const rand = mulberry32(20261025);

    const states = new Uint8Array(count);
    const onsetS = new Float32Array(count);
    const modes = new Uint8Array(count);
    const collapseTargets: CollapseTarget[] = [];

    for (let i = 0; i < count; i++) {
      const b = meta?.buildings[i];
      const east = b ? b.centroid[0] : (rand() - 0.5) * 2400;
      const north = b ? b.centroid[1] : (rand() - 0.5) * 2400;
      const groundElev = b ? b.ground_elevation_m : 3.0;
      const height = b ? b.height_m : 18.0;

      // Distance from bay waterfront (northeast edge: east + north*0.55 > -150)
      const waterfrontSignedDist = east * 0.78 + north * 0.62;
      const isLowWaterfront = groundElev < 4.5 && waterfrontSignedDist > -380;

      const r = rand();
      let st: DamageState = 0;

      if (isLowWaterfront) {
        // Higher flood & liquefaction vulnerability near Embarcadero / South Beach / Piers
        if (r < 0.14) st = 0;
        else if (r < 0.36) st = 1;
        else if (r < 0.68) st = 2;
        else if (r < 0.91) st = 3;
        else st = 4;
      } else {
        // Inland shaking distribution
        if (r < 0.28) st = 0;
        else if (r < 0.58) st = 1;
        else if (r < 0.82) st = 2;
        else if (r < 0.95) st = 3;
        else st = 4;
      }

      states[i] = st;

      if (isLowWaterfront && rand() < 0.65) {
        // Flood-dominated onset (8.5s .. 15.5s as wave front moves inland from Bay)
        modes[i] = 1;
        const inlandDepth = Math.max(0, 350 - waterfrontSignedDist);
        onsetS[i] = 8.5 + Math.min(6.5, (inlandDepth / 650) * 5.5 + rand() * 1.4);
      } else {
        // Shaking-dominated onset (1.2s .. 8.0s during earthquake)
        modes[i] = 0;
        onsetS[i] = 1.2 + rand() * 6.8;
      }

      // Collect up to 65 state-4 collapse buildings for the instanced dust puff effect
      if (st === 4 && collapseTargets.length < 65 && b) {
        collapseTargets.push({
          id: i,
          x: east,
          y: groundElev,
          z: -north, // ENU -> Three.js Z = -North
          height,
          onset: onsetS[i],
        });
      }
    }

    set({
      phase: 'playing',
      clock: 0,
      duration: SHADER_PROOF_DURATION_S,
      isShaderProof: true,
      shaderProofPayload: {
        states,
        onsetS,
        modes,
        collapseTargets,
      },
      statusLabel: 'Earthquake',
    });
  },

  resetSimulation: () =>
    set({
      phase: 'idle',
      clock: 0,
      isShaderProof: false,
      shaderProofPayload: null,
      statusLabel: 'Idle',
    }),
}));
