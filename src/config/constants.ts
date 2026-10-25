/**
 * Fixed vocabularies and shared simulation constants.
 * The backend sends states and names, never animation code.
 */

export const DAMAGE_STATES = [0, 1, 2, 3, 4] as const;
export type DamageState = (typeof DAMAGE_STATES)[number];

export const DOMINANT_MODES = ['shaking', 'flood'] as const;
export type DominantMode = (typeof DOMINANT_MODES)[number];

export const PIPELINE_NODES = [
  'gov_data',
  'hazard_model',
  'monte_carlo',
  'failure_analysis',
  'fix_planning',
] as const;
export type PipelineNodeId = (typeof PIPELINE_NODES)[number];

export const PIPELINE_NODE_LABELS: Record<PipelineNodeId, string> = {
  gov_data: 'Government Data Retrieval',
  hazard_model: 'Hazard Modeling',
  monte_carlo: 'Monte Carlo Simulation',
  failure_analysis: 'Failure Analysis',
  fix_planning: 'Fix Planning',
};

export const PIPELINE_STATUSES = ['queued', 'running', 'done'] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PRIORITY_LEVELS = ['high', 'medium', 'low'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export const EVIDENCE_TYPES = ['sourced', 'inferred'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export type SimulationStatusLabel = 'Idle' | 'Earthquake' | 'Wave surge' | 'Complete';

// Phase 1 Debug Shader Proof Duration (seconds)
export const SHADER_PROOF_DURATION_S = 20.0;
export const DEFAULT_SIMULATION_DURATION_S = 60.0;
