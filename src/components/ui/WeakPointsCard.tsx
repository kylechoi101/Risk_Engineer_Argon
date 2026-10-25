import { ShieldAlert, ArrowUpDown, CheckSquare, Sparkles } from 'lucide-react';
import { DAMAGE_STATE_LABELS, THEME } from '../../config/theme';
import { DAMAGE_STATES } from '../../config/constants';
import { useSimulationStore } from '../../store/useSimulationStore';
import { analysisReady, formatUsd, selectedFixCost } from '../../data/contractPayload';
import type { FixDefinition, WeakPointGroup } from '../../types/dataContract';

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
  const contract = useSimulationStore((s) => s.contract);
  const mask = useSimulationStore((s) => s.selectedFixMask);
  const drawView = useSimulationStore((s) => s.drawView);
  const setDrawView = useSimulationStore((s) => s.setDrawView);
  const toggleFixBit = useSimulationStore((s) => s.toggleFixBit);
  const setSelectedFixMask = useSimulationStore((s) => s.setSelectedFixMask);
  const setHoveredGroupId = useSimulationStore((s) => s.setHoveredGroupId);

  // Results and fixes stay hidden until the simulation has calculated them.
  const summary = analysisReady(phase, contract) ? contract!.summary : null;
  const combo = summary?.by_combo[String(mask)] ?? null;
  const fixes = summary?.fixes ?? [];
  const fixById = new Map(fixes.map((f) => [f.id, f]));
  const allMask = (1 << fixes.length) - 1;
  const [costLo, costHi] = summary ? selectedFixCost(summary, mask) : [0, 0];
  const groupFixIds = new Set(summary?.weak_point_groups.map((g) => g.fix_id) ?? []);
  const otherFixes = fixes.filter((f) => !groupFixIds.has(f.id));
  const groups = [...(summary?.weak_point_groups ?? [])].sort((a, b) =>
    sortMode === 'cost' ? a.fix_cost_usd[0] - b.fix_cost_usd[0] : b.priority_score - a.priority_score
  );

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
            <span className={`summary-metric-value ${combo ? '' : 'muted'}`}>
              {combo
                ? `${formatUsd(combo.total_loss_usd.p10)} – ${formatUsd(combo.total_loss_usd.p90)}`
                : phase === 'idle'
                  ? 'Awaiting Run'
                  : contract
                    ? 'Simulating…'
                    : 'Mock Proof Mode'}
            </span>
          </div>
        </div>

        {combo?.risk && (
          <div className="summary-top-metrics">
            <div className="summary-metric">
              <span className="summary-metric-label">VaR₀.₉₉ / CVaR₀.₉₉ (bldg + infra)</span>
              <span className="summary-metric-value">
                {formatUsd(combo.risk.var99_usd)} / {formatUsd(combo.risk.cvar99_usd)}
              </span>
            </div>
            <div className="summary-metric">
              <span className="summary-metric-label">Collapses (p50) · Realization</span>
              <span className="summary-metric-value">
                {combo.est_collapse_count.p50.toLocaleString()} ·{' '}
                <span className="sort-toggle-group" role="group" aria-label="Realization">
                  <button
                    type="button"
                    className={`sort-pill ${drawView === 'p50' ? 'active' : ''}`}
                    onClick={() => setDrawView('p50')}
                  >
                    Typical
                  </button>
                  <button
                    type="button"
                    className={`sort-pill ${drawView === 'tail' ? 'active' : ''}`}
                    onClick={() => setDrawView('tail')}
                  >
                    1-in-100
                  </button>
                </span>
              </span>
            </div>
          </div>
        )}

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

      {summary ? (
        <div className="skeleton-groups-list weak-points-list">
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              fix={fixById.get(g.fix_id)}
              checked={Boolean(fixById.get(g.fix_id) && mask & (1 << fixById.get(g.fix_id)!.bit))}
              onToggle={(bit) => toggleFixBit(bit)}
              onHover={setHoveredGroupId}
            />
          ))}
          {otherFixes.length > 0 && (
            <div className="skeleton-group-row">
              <div className="skeleton-row-top">
                <span className="priority-badge medium">INFRASTRUCTURE</span>
                <span className="skeleton-meta">Natech cascade network fixes</span>
              </div>
              {otherFixes.map((f) => (
                <FixRow key={f.id} fix={f} checked={Boolean(mask & (1 << f.bit))} onToggle={toggleFixBit} />
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="weak-points-list-empty">
        <div className="empty-state-banner">
          <ShieldAlert size={20} className="empty-state-icon" />
          <div className="empty-state-text">
            <strong>
              {contract && phase === 'playing'
                ? 'Simulating district damage…'
                : 'Awaiting District Simulation Analysis'}
            </strong>
            <p>
              {contract
                ? 'Press Play Simulation. Weak-point groups, recommended fixes, costs and loss ranges appear when the run finishes.'
                : <>Weak-point groups, priority scores, expected loss ranges, and retrofit fix
                  checkboxes will populate from <code>/public/data/summary.json</code> after the
                  simulation runs (Phase 2 &amp; 3).</>}
            </p>
          </div>
        </div>

        {/* Skeleton Placeholder Cards showing the exact structure for Phase 3 */}
        {!contract && (
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
        )}
      </div>
      )}

      {/* Card Footer: Running Total Cost & Select All */}
      <footer className="card-footer">
        <label
          className={`select-all-label ${summary ? '' : 'disabled'}`}
          onClick={() => summary && setSelectedFixMask(mask === allMask ? 0 : allMask)}
        >
          <CheckSquare size={15} />
          <span>{summary && mask === allMask ? 'Clear all fixes' : 'Select all fixes'}</span>
        </label>

        <div className="running-cost-total">
          <span className="cost-label">Selected Fixes Cost:</span>
          <span className="cost-value">
            {costHi > 0 ? `${formatUsd(costLo)} – ${formatUsd(costHi)}` : '$0'}
          </span>
        </div>
      </footer>
    </section>
  );
}

function FixRow({
  fix,
  checked,
  onToggle,
}: {
  fix: FixDefinition;
  checked: boolean;
  onToggle: (bit: number) => void;
}) {
  const source = fix.sources?.[0];
  return (
    <label className="skeleton-fix-row" title={fix.rationale}>
      <input type="checkbox" checked={checked} onChange={() => onToggle(fix.bit)} />
      <span className="skeleton-fix-label">
        Fix: {fix.label}
        {source ? (
          <>
            {' '}
            <a href={source.url} target="_blank" rel="noreferrer">
              [source]
            </a>
          </>
        ) : fix.evidence === 'inferred' ? (
          ' (inferred)'
        ) : null}
      </span>
      <span className="skeleton-fix-cost">
        {formatUsd(fix.cost_usd[0])}–{formatUsd(fix.cost_usd[1])}
      </span>
    </label>
  );
}

function GroupRow({
  group,
  fix,
  checked,
  onToggle,
  onHover,
}: {
  group: WeakPointGroup;
  fix: FixDefinition | undefined;
  checked: boolean;
  onToggle: (bit: number) => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <div
      className="skeleton-group-row"
      onMouseEnter={() => onHover(group.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="skeleton-row-top">
        <span className={`priority-badge ${group.priority}`}>
          {group.priority.toUpperCase()} PRIORITY
        </span>
        <span className="skeleton-meta">
          {group.building_count.toLocaleString()} buildings • Est. loss:{' '}
          {formatUsd(group.expected_loss_usd[0])} – {formatUsd(group.expected_loss_usd[1])}
        </span>
      </div>
      <div className="skeleton-title">{group.label}</div>
      <p className="weak-point-rationale">{group.rationale}</p>
      {fix && <FixRow fix={fix} checked={checked} onToggle={onToggle} />}
    </div>
  );
}
