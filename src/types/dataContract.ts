/**
 * Data Contract TypeScript Definitions (Section 5 & Section 6)
 * Matches /public/data/*.json schemas produced by the Argon backend team and bake scripts.
 */

import type {
  BuildingDominantMode,
  DamageState,
  DominantMode,
  EvidenceType,
  PipelineNodeId,
  PipelineStatus,
  PriorityLevel,
} from '../config/constants';

export interface DataSourceRef {
  title: string;
  url: string;
}

// ============================================================================
// 5.1 scenario.json
// ============================================================================
export interface InundationGridSchema {
  origin_enu_m: [number, number];
  cell_m: number;
  cols: number;
  rows: number;
  /** Base64-encoded Float32Array (cols * rows, row-major) */
  arrival_s: string;
  /** Base64-encoded Float32Array (cols * rows, row-major) */
  peak_depth_m: string;
  /** Base64-encoded Float32Array (cols * rows, row-major) */
  recede_s: string;
}

export interface ScenarioSchema {
  schema_version: '1.0';
  scenario_id: string;
  label: string;
  earthquake: {
    magnitude: number;
    duration_s: number;
    /** Array of [t_s, amplitude_0_1] pairs */
    envelope: [number, number][];
    dominant_freq_hz: number;
  };
  wave: {
    arrival_s: number;
    inundation_grid: InundationGridSchema;
  };
  sources: DataSourceRef[];
}

// ============================================================================
// 5.2 buildings_damage.json
// ============================================================================
export interface BuildingOutcomeCombo {
  state: DamageState[];
  cost_usd_mid: number[];
}

export interface BuildingsDamageSchema {
  building_ids: number[];
  archetype_idx: number[];
  zone_idx: number[];
  onset_s: number[];
  dominant_mode: BuildingDominantMode[];
  /** Keys are decimal strings of the bitmask of selected fixes ("0", "1", "5", etc.) */
  outcomes: Record<string, BuildingOutcomeCombo>;
  /** v1.1: the 1-in-100 realization (draw nearest CVaR 0.99), same shape as outcomes */
  outcomes_tail?: Record<string, BuildingOutcomeCombo>;
  representative_draws?: { p50: number; tail: number };
}

// ============================================================================
// 5.3 summary.json
// ============================================================================
export interface ZoneInfo {
  id: string;
  label: string;
}

export interface ArchetypeInfo {
  id: string;
  label: string;
}

export interface FixDefinition {
  id: string;
  bit: number;
  label: string;
  cost_usd: [number, number];
  applies_to_archetypes?: string[];
  /** v1.1 */
  applies_to_nodes?: string[];
  applies_to_zones?: string[];
  evidence?: EvidenceType;
  sources?: DataSourceRef[];
  rationale?: string;
}

/** v1.1: buildings + infrastructure tail risk for one combo */
export interface ComboRisk {
  expected_loss_usd: number;
  var99_usd: number;
  cvar99_usd: number;
  building_expected_loss_usd: number;
  infrastructure_expected_loss_usd: number;
  node_failure_probs: Record<string, number>;
}

export interface PercentileEstimate {
  p10: number;
  p50: number;
  p90: number;
}

export interface ComboSummary {
  counts_by_state: [number, number, number, number, number];
  total_loss_usd: PercentileEstimate;
  est_collapse_count: PercentileEstimate;
  by_zone_counts_by_state: [number, number, number, number, number][];
  risk?: ComboRisk;
}

export interface WeakPointGroup {
  id: string;
  label: string;
  archetype_ids: string[];
  building_count: number;
  priority: PriorityLevel;
  priority_score: number;
  expected_loss_usd: [number, number];
  fix_id: string;
  fix_cost_usd: [number, number];
  rationale: string;
  evidence: EvidenceType;
  sources: DataSourceRef[];
  hover_building_ids: number[];
}

export interface HotspotInfo {
  id: string;
  label: string;
  /** Local ENU [east_m, north_m] or Three [x, z] */
  center_enu_m: [number, number];
  radius_m: number;
  dominant_mode: DominantMode;
  building_ids: number[];
}

export interface SummarySchema {
  price_year?: number;
  zones: ZoneInfo[];
  archetypes: ArchetypeInfo[];
  fixes: FixDefinition[];
  by_combo: Record<string, ComboSummary>;
  weak_point_groups: WeakPointGroup[];
  hotspots: HotspotInfo[];
}

// ============================================================================
// 5.4 pipeline_events.json + Live Stream Adapter Interface
// ============================================================================
export interface PipelineEvent {
  t_s: number;
  node: PipelineNodeId;
  status: PipelineStatus;
  message: string;
}

export type PipelineEventsSchema = PipelineEvent[];

/**
 * Adapter interface so a recorded log in pipeline_events.json can be swapped
 * seamlessly with a live SSE stream later.
 */
export interface PipelineEventAdapter {
  mode: 'recorded' | 'live';
  start(onEvent: (event: PipelineEvent) => void): void;
  syncToClock?(clockS: number): void;
  stop(): void;
}

// ============================================================================
// 6. buildings.json (District Metadata baked alongside district.glb)
// ============================================================================
export interface BuildingFieldQuality {
  footprint_area_m2: EvidenceType;
  height_m: EvidenceType;
  stories: EvidenceType | 'unavailable';
  year_built: EvidenceType | 'unavailable';
  material: EvidenceType | 'unavailable';
  ground_elevation_m: EvidenceType;
}

export interface BuildingRecord {
  id: number;
  /** Local ENU [east_m, north_m] */
  centroid: [number, number];
  footprint_area_m2: number;
  height_m: number;
  stories: number | null;
  year_built: number | null;
  material: string | null;
  ground_elevation_m: number;
  data_quality: BuildingFieldQuality;
  is_landmark?: boolean;
  name?: string | null;
}

export interface BuildingsMetadataSchema {
  schema_version: '1.0';
  is_placeholder: boolean;
  generation_note: string;
  origin_wgs84: { lat: number; lon: number };
  radius_m: number;
  building_count: number;
  unavailable_attributes_report: string[];
  buildings: BuildingRecord[];
}

// ============================================================================
// Loaded contract bundle (all four backend files, validated)
// ============================================================================
export interface ContractBundle {
  scenario: ScenarioSchema;
  damage: BuildingsDamageSchema;
  summary: SummarySchema;
  pipeline: PipelineEventsSchema;
}
