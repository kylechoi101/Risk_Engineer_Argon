import { ShieldAlert, ArrowUpDown, CheckSquare, Sparkles } from 'lucide-react';
import { DAMAGE_STATE_LABELS, THEME } from '../../config/theme';
import { DAMAGE_STATES } from '../../config/constants';
import { useSimulationStore } from '../../store/useSimulationStore';

/**
 * RIGHT TOP CARD: "Cost Estimation + Suggested Weak Points".
 * In Phase 1, renders the complete layout and theme in an empty/loading placeholder
 * state awaiting simulation playback (or showing live Shader Proof counts when 'P' runs).
 */
export function WeakPointsCard() {
  const sortMode = useSimulationStore((s) => s.sortMode);
  const setSortMode = useSimulationStore((s) => s.setSortMode);
  const buildingsMeta = useSimulationStore((s) => s.buildingsMeta);
  const phase = useSimulationStore((s) => s.phase);
  const isShaderProof = useSimulationStore((s) => s.isShaderProof);
  const shaderProofPayload = useSimulationStore((s) => s.shaderProofPayload);
  const clock = useSimulationStore((s) => s.clock);

  const totalBuildings = buildingsMeta?.building_count ?? 2439;

  // Compute live state counts during Phase 1 Shader Proof ('P') or baseline state 0 when idle
  const stateCounts = [totalBuildings, 0, 0, 0, 0];
  if ((phase === 'playing' || phase === 'analysis_done') && isShaderProof && shaderProofPayload) {
    stateCounts[0] = 0;
    const n = shaderProofPayload.states.length;
    for (let i = 0; i < n; i++) {
      const st = clock >= shaderProofPayload.onsetS[i] ? shaderProofPayload.states[i] : 0;
      stateCounts[st] = (stateCounts[st] || 0) + 1;
    }
  }

  return (
    <section className="sidebar-card weak-points-card" aria-label="Cost Estimation and Weak Points">
      {/* Card Header */}
      <header className="card-header">
        <div>
          <h2 className="card-title">Cost Estimation + Suggested Weak Points</h2>
          <p className="card-subtitle">
            District-wide structural &amp; flood vulnerability groups
          </p>
        </div>

        {/* Sort Toggle: Priority | Cost */}
        <div className="sort-toggle-group" role="group" aria-label="Sort weak points">
          <span className="sort-label">
            <ArrowUpDown size={12} /> Sort:
          </span>
          <button
            type="button"
            className={`sort-pill ${sortMode === 'priority' ? 'active' : ''}`}
            onClick={() => setSortMode('priority')}
          >
            Priority
          </button>
          <button
            type="button"
            className={`sort-pill ${sortMode === 'cost' ? 'active' : ''}`}
            onClick={() => setSortMode('cost')}
          >
            Cost
          </button>
        </div>
      </header>

      {/* District Summary Bar (Buildings by Damage State + Estimated Loss Range) */}
      <div className="district-summary-box">
        <div className="summary-top-metrics">
          <div className="summary-metric">
            <span className="summary-metric-label">District Buildings</span>
            <span className="summary-metric-value">{totalBuildings.toLocaleString()}</span>
          </div>
          <div className="summary-metric">
            <span className="summary-metric-label">Estimated Loss Range (p10–p90)</span>
            <span className="summary-metric-value muted">
              {phase === 'idle' ? 'Awaiting Run' : 'Mock Proof Mode'}
            </span>
          </div>
        </div>

        <div className="damage-counts-strip">
          {DAMAGE_STATES.map((st) => (
            <div key={st} className="damage-count-chip">
              <span
                className="damage-chip-dot"
                style={{ backgroundColor: THEME.damageRamp[st] }}
              />
              <span className="damage-chip-name">{DAMAGE_STATE_LABELS[st]}</span>
              <span className="damage-chip-num">{stateCounts[st].toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Weak-Point Groups Placeholder List (Phase 1 Empty / Loading State) */}
      <div className="weak-points-list-empty">
        <div className="empty-state-banner">
          <ShieldAlert size={20} className="empty-state-icon" />
          <div className="empty-state-text">
            <strong>Awaiting District Simulation Analysis</strong>
            <p>
              Weak-point groups, priority scores, expected loss ranges, and retrofit fix
              checkboxes will populate from <code>/public/data/summary.json</code> after the
              simulation runs (Phase 2 &amp; 3).
            </p>
          </div>
        </div>

        {/* Skeleton Placeholder Cards showing the exact structure for Phase 3 */}
        <div className="skeleton-groups-list" aria-hidden="true">
          {[
            {
              badge: 'HIGH PRIORITY',
              badgeClass: 'high',
              title: 'Unreinforced Masonry (Pre-1940) — Jackson Sq & Chinatown',
              meta: '— buildings • Est. loss: $— – $—',
              fix: 'Seismic parapet & wall-to-diaphragm anchorage retrofit',
            },
            {
              badge: 'HIGH PRIORITY',
              badgeClass: 'high',
              title: 'Embarcadero Seawall & Finger Pier Substructures',
              meta: '— buildings • Est. loss: $— – $—',
              fix: 'Perimeter floodwall raise + pile jacket reinforcement',
            },
            {
              badge: 'MEDIUM PRIORITY',
              badgeClass: 'medium',
              title: 'Soft-Story Wood-Frame Multi-Family — North Beach / SoMa',
              meta: '— buildings • Est. loss: $— – $—',
              fix: 'Ground-floor steel moment frame retrofit',
            },
          ].map((item, idx) => (
            <div key={idx} className="skeleton-group-row">
              <div className="skeleton-row-top">
                <span className={`priority-badge ${item.badgeClass}`}>{item.badge}</span>
                <span className="skeleton-meta">{item.meta}</span>
              </div>
              <div className="skeleton-title">{item.title}</div>
              <div className="skeleton-fix-row">
                <input type="checkbox" disabled />
                <span className="skeleton-fix-label">Fix: {item.fix}</span>
                <span className="skeleton-fix-cost">$—M</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Card Footer: Running Total Cost & Select All */}
      <footer className="card-footer">
        <label className="select-all-label disabled">
          <CheckSquare size={15} />
          <span>Select all fixes</span>
        </label>

        <div className="running-cost-total">
          <span className="cost-label">Selected Fixes Cost:</span>
          <span className="cost-value">$0</span>
        </div>
      </footer>
    </section>
  );
}
