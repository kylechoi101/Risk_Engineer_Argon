import './style.css';
import { FIXES, NODES, runSimulation } from './simulation.js';
import { createScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const state = {
  magnitude: 7.2,
  surge: 2.2,
  budget: 150,
  selected: new Set(['fix_sw_1', 'fix_sub_1', 'fix_brg_1']),
  category: 'All',
  activeNode: null,
  scene: null,
  rankings: [],
  result: null
};

const compactMoney = (value) => {
  if (value >= 1000) return `$${(value / 1000).toFixed(2)}B`;
  return `$${Math.round(value).toLocaleString()}M`;
};
const cleanNumber = (value, digits = 1) => Number(value).toFixed(digits);
const nodeName = (id) => NODES.find((n) => n.id === id)?.name || id.replaceAll('_', ' ');
const chosenCost = () => FIXES.filter((f) => state.selected.has(f.id)).reduce((sum, f) => sum + f.costMillions, 0);

function updateRange(input) {
  const min = Number(input.min), max = Number(input.max), value = Number(input.value);
  input.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
}

function syncControls() {
  $('magnitude').value = state.magnitude;
  $('surge').value = state.surge;
  $('budget').value = state.budget;
  $('magnitudeValue').textContent = cleanNumber(state.magnitude);
  $('surgeValue').textContent = `${cleanNumber(state.surge)} m`;
  updateRange($('magnitude'));
  updateRange($('surge'));
  document.querySelectorAll('.preset').forEach((button) => {
    const match = Number(button.dataset.mag) === state.magnitude && Number(button.dataset.surge) === state.surge;
    button.classList.toggle('selected', match);
    button.setAttribute('aria-pressed', String(match));
  });
}

function analyzeFixes() {
  state.rankings = FIXES.map((fix) => {
    const run = runSimulation({
      earthquakeMagnitude: state.magnitude,
      coastalSurgeMeters: state.surge,
      selectedFixIds: [fix.id],
      seed: 42,
      iterations: 4096
    });
    return {
      ...fix,
      varReduction: Math.max(0, run.overallReduction.var99ReductionMillions),
      expectedSaved: Math.max(0, run.overallReduction.expectedLossSavedMillions),
      roi: Math.max(0, run.overallReduction.expectedLossSavedMillions / fix.costMillions)
    };
  }).sort((a, b) => b.varReduction - a.varReduction);
}

function drawDistribution(baseline, mitigated) {
  const width = 300, height = 126, bottom = 115, top = 12;
  const maxX = Math.max(baseline.histogram.at(-1).binEnd, mitigated.histogram.at(-1).binEnd);
  const maxY = Math.max(...baseline.histogram.map((b) => b.probability), ...mitigated.histogram.map((b) => b.probability), .01) * 1.12;
  const x = (value) => (value / maxX) * width;
  const y = (value) => bottom - (value / maxY) * (bottom - top);
  const area = (histogram) => {
    const points = histogram.map((bin) => [x((bin.binStart + bin.binEnd) / 2), y(bin.probability)]);
    return `M0 ${bottom} L${points.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(' L')} L${width} ${bottom} Z`;
  };
  const varX = x(mitigated.var99Millions);
  $('distribution').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1="${bottom}" x2="${width}" y2="${bottom}" stroke="#3c5c69" stroke-width="1" />
    <line x1="${width / 2}" y1="${top}" x2="${width / 2}" y2="${bottom}" stroke="#284451" stroke-dasharray="3 5" />
    <path d="${area(baseline.histogram)}" fill="#ed815d" fill-opacity=".21" stroke="#fb956e" stroke-width="2" />
    <path d="${area(mitigated.histogram)}" fill="#57cad0" fill-opacity=".24" stroke="#68dde0" stroke-width="2" />
    <line x1="${varX.toFixed(1)}" y1="${top}" x2="${varX.toFixed(1)}" y2="${bottom}" stroke="#79dadd" stroke-width="1" stroke-dasharray="3 3" />
  </svg>`;
  $('chartMid').textContent = compactMoney(maxX / 2);
  $('chartMax').textContent = compactMoney(maxX);
  $('distribution').setAttribute('aria-label', `Modeled loss distribution. Baseline 99th percentile ${compactMoney(baseline.var99Millions)}, with selected fixes ${compactMoney(mitigated.var99Millions)}.`);
}

function selectNode(id) {
  state.activeNode = id;
  state.scene?.focusNode(id);
  renderNodes();
}

function renderNodes() {
  const probabilities = state.result?.mitigated.nodeFailureProbs || {};
  const sorted = [...NODES].sort((a, b) => (probabilities[b.id] || 0) - (probabilities[a.id] || 0));
  if (!state.activeNode) state.activeNode = sorted[0]?.id;
  $('nodeList').replaceChildren(...sorted.map((node, index) => {
    const probability = probabilities[node.id] || 0;
    const row = document.createElement('button');
    row.className = `node-row${state.activeNode === node.id ? ' active' : ''}`;
    row.innerHTML = `<span class="node-index">${String(index + 1).padStart(2, '0')}</span><span class="node-name"></span><span class="node-pct">${Math.round(probability * 100)}%</span><span class="node-bar"><i style="width:${Math.round(probability * 100)}%"></i></span>`;
    row.querySelector('.node-name').textContent = node.name;
    row.addEventListener('click', () => selectNode(node.id));
    return row;
  }));
  $('selectedAssetName').textContent = nodeName(state.activeNode);
  $('selectedAssetRisk').textContent = `${Math.round((probabilities[state.activeNode] || 0) * 100)}%`;
  state.scene?.setRisk(probabilities, state.activeNode);
}

function renderFixes() {
  const visible = state.rankings.filter((fix) => state.category === 'All' || fix.category === state.category);
  $('fixGrid').replaceChildren(...visible.map((fix) => {
    const rank = state.rankings.indexOf(fix) + 1;
    const selected = state.selected.has(fix.id);
    const card = document.createElement('article');
    card.className = `fix-card${selected ? ' selected' : ''}`;
    card.innerHTML = `<div class="fix-top"><span class="category ${fix.category}">${fix.category.toUpperCase()}</span><span class="fix-rank">#${String(rank).padStart(2, '0')}</span></div>
      <h3></h3><p></p>
      <div class="fix-metrics"><div><small>CAPEX</small><strong>${compactMoney(fix.costMillions)}</strong></div><div><small>VaR ↓</small><strong>${compactMoney(fix.varReduction)}</strong></div><div><small>ROI</small><strong>${fix.roi.toFixed(1)}×</strong></div></div>
      <div class="fix-bottom"><span class="target-label"></span><button class="fix-toggle" aria-pressed="${selected}">${selected ? '✓ SELECTED' : '+ ADD FIX'}</button></div>`;
    card.querySelector('h3').textContent = fix.title;
    card.querySelector('p').textContent = fix.impact;
    card.querySelector('.target-label').textContent = nodeName(fix.targetNode).toUpperCase();
    card.querySelector('.fix-toggle').addEventListener('click', () => toggleFix(fix.id));
    return card;
  }));
  document.querySelectorAll('.filter').forEach((button) => {
    const active = button.dataset.category === state.category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderMetrics() {
  const result = state.result;
  if (!result) return;
  const { baseline, mitigated, overallReduction, config } = result;
  $('varValue').textContent = compactMoney(mitigated.var99Millions);
  $('varDelta').textContent = state.selected.size ? `↓ ${compactMoney(overallReduction.var99ReductionMillions)} VS. BASELINE ${compactMoney(baseline.var99Millions)}` : `BASELINE EXPOSURE · SELECT FIXES TO REDUCE`;
  $('cvarValue').textContent = compactMoney(mitigated.cvar99Millions);
  $('casualtiesValue').textContent = cleanNumber(mitigated.expectedFatalities);
  $('avoidedValue').textContent = compactMoney(overallReduction.expectedLossSavedMillions);
  $('runTime').textContent = `RERUN ${Math.round(config.runtimeMs)} MS`;
  $('selectedCount').innerHTML = `${state.selected.size} <span>/ 20</span>`;
  $('spentValue').textContent = compactMoney(chosenCost());
  $('roiValue').textContent = chosenCost() ? `${overallReduction.benefitCostRatio.toFixed(1)}×` : '—';
  drawDistribution(baseline, mitigated);
  renderNodes();
  renderFixes();
}

function recalculate(reanalyze = false) {
  if (reanalyze) analyzeFixes();
  state.result = runSimulation({
    earthquakeMagnitude: state.magnitude,
    coastalSurgeMeters: state.surge,
    selectedFixIds: [...state.selected],
    budgetMillions: state.budget,
    seed: 42,
    iterations: 4096
  });
  renderMetrics();
}

function toggleFix(id) {
  const fix = FIXES.find((item) => item.id === id);
  if (!fix) return;
  if (state.selected.has(id)) state.selected.delete(id);
  else if (chosenCost() + fix.costMillions <= state.budget) state.selected.add(id);
  else { $('budget').focus(); $('budget').classList.add('budget-warning'); setTimeout(() => $('budget').classList.remove('budget-warning'), 700); return; }
  recalculate();
}

function optimizeBudget() {
  const byValue = [...state.rankings].sort((a, b) => b.roi - a.roi);
  const chosen = new Set();
  let spent = 0;
  for (const fix of byValue) if (spent + fix.costMillions <= state.budget) { chosen.add(fix.id); spent += fix.costMillions; }
  state.selected = chosen;
  recalculate();
  document.querySelector('.mitigation-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindControls() {
  document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => {
    state.magnitude = Number(button.dataset.mag);
    state.surge = Number(button.dataset.surge);
    syncControls();recalculate(true);
  }));
  $('magnitude').addEventListener('input', (event) => {state.magnitude = Number(event.target.value);syncControls();recalculate(true);});
  $('surge').addEventListener('input', (event) => {state.surge = Number(event.target.value);syncControls();recalculate(true);});
  $('budget').addEventListener('change', (event) => {
    state.budget = Math.max(0, Math.min(500, Number(event.target.value) || 0));
    for (const id of [...state.selected].reverse()) {
      if (chosenCost() <= state.budget) break;
      state.selected.delete(id);
    }
    syncControls();recalculate();
  });
  $('optimizeBtn').addEventListener('click', optimizeBudget);
  $('resetBtn').addEventListener('click', () => {
    state.magnitude=7.2;state.surge=2.2;state.budget=150;
    state.selected=new Set(['fix_sw_1','fix_sub_1','fix_brg_1']);
    state.activeNode=null;syncControls();recalculate(true);state.scene?.resetView();
  });
  document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {state.category=button.dataset.category;renderFixes();}));
  $('aboutBtn').addEventListener('click', () => $('aboutDialog').showModal());
  $('zoomIn').addEventListener('click', () => state.scene?.zoom(1.25));
  $('zoomOut').addEventListener('click', () => state.scene?.zoom(.8));
  $('resetView').addEventListener('click', () => state.scene?.resetView());
}

async function start() {
  bindControls();syncControls();recalculate(true);
  try {
    const response = await fetch('/data/scene.json');
    if (!response.ok) throw new Error(`Scene data: ${response.status}`);
    const data = await response.json();
    state.scene = await createScene($('scene'), data);
    state.scene.onNodeSelect((id) => {state.activeNode=id;renderNodes();});
    $('renderMode').textContent = `${state.scene.mode} RENDERER · ${data.buildings.length.toLocaleString()} BUILDINGS`;
    state.scene.setRisk(state.result.mitigated.nodeFailureProbs, state.activeNode);
  } catch (error) {
    console.error(error);
    $('sceneFallback').hidden=false;
    $('renderMode').textContent='3D UNAVAILABLE';
  }
}

start();
