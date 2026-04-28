// Pure render functions. No state, no event handlers — main.js wires events.

import { THESES } from './engine/recommend.js';
import { posLabel } from './engine/labels.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

export function renderClock(state) {
  if (state.isComplete) {
    return `<div class="strong">draft complete</div>`;
  }
  const nextMine = state.picksForSlot(state.mySlot).find((p) => p > state.picks.length);
  const fromNow = nextMine ? nextMine - state.currentPick : null;
  const round = Math.ceil(state.currentPick / state.teams);
  if (state.isMyTurn) {
    return `<div class="my-turn">YOU'RE UP</div><div>pick ${state.currentPick} · round ${round}</div>`;
  }
  return `
    <div>pick <span class="strong">${state.currentPick}</span> · round ${round} · slot ${state.currentSlot}</div>
    <div>your next pick: ${nextMine ?? '—'}${fromNow != null ? ` (in ${fromNow})` : ''}</div>
  `;
}

export function renderControls(ui, state) {
  const slots = [];
  for (let s = 1; s <= state.teams; s++) {
    slots.push(`<option value="${s}" ${s === state.mySlot ? 'selected' : ''}>${s}</option>`);
  }
  const thesisOpts = Object.entries(THESES)
    .map(([k, t]) => `<option value="${k}" ${ui.thesis === k ? 'selected' : ''}>${esc(t.label)}</option>`)
    .join('');

  const onClock = state.isMyTurn || state.isComplete;

  return `
    <h2>controls</h2>
    <div class="controls-row">
      <label>slot
        <select id="slot-select" ${state.picks.length > 0 ? 'disabled' : ''}>${slots.join('')}</select>
      </label>
      <label>base engine
        <select id="level-select">
          <option value="l2" ${ui.level === 'l2' ? 'selected' : ''}>L2 — VBD (default)</option>
          <option value="l1" ${ui.level === 'l1' ? 'selected' : ''}>L1 — tier + need</option>
        </select>
      </label>
      <label>L4 thesis
        <select id="thesis-select">${thesisOpts}</select>
      </label>
    </div>
    <div class="controls-row" style="margin-top:8px;">
      <button id="step-btn" ${onClock ? 'disabled' : ''}>auto-pick to my turn</button>
      <button id="undo-btn" class="secondary" ${state.picks.length === 0 ? 'disabled' : ''}>undo</button>
      <button id="reset-btn" class="secondary">reset</button>
    </div>
    <div class="muted" style="margin-top:8px;">
      <strong>L3 signals always on</strong> — position runs (≥5 in last 10) and ADP fallers (≥10 picks below ADP) appear inline as ⚡ on each recommendation.
      ${ui.thesis !== 'none' ? `<br><strong>L4 active:</strong> ${esc(THESES[ui.thesis].description)}` : ''}
    </div>
  `;
}

export function renderRecommendations(recs, state) {
  if (state.isComplete) {
    return `<h2>recommendations</h2><p class="muted">draft complete.</p>`;
  }
  if (!state.isMyTurn) {
    return `<h2>recommendations</h2><p class="muted">other team on the clock — auto-pick to advance.</p>`;
  }
  if (recs.length === 0) {
    return `<h2>recommendations</h2><p class="muted">no recommendations available.</p>`;
  }
  const items = recs.map((r, i) => {
    const tierClass = r.tier <= 3 ? `tier-${r.tier}` : '';
    const signals = (r.signals || [])
      .map((s) => `<span class="signal">⚡ ${esc(s)}</span>`).join('');
    return `
      <li class="rec-item ${tierClass}" data-player-id="${esc(r.player.id)}">
        <span class="rank">${i + 1}</span>
        <div class="info">
          <div class="name">${esc(r.player.name)}${r.player.team ? ` · ${esc(r.player.team)}` : ''}</div>
          <div class="meta">${esc(r.rationale)}</div>
          ${signals}
        </div>
        <span class="pos ${r.player.position}">${posLabel(r.player.position)}</span>
      </li>
    `;
  }).join('');
  return `<h2>your pick — tap to draft</h2><ul class="rec-list">${items}</ul>`;
}

export function renderRoster(state) {
  const roster = state.myRoster();
  const needs = state.myNeeds();
  const r = state.cfg.roster;
  const positions = [
    { key: 'QB', need: r.QB },
    { key: 'RB', need: r.RB },
    { key: 'WR', need: r.WR },
    { key: 'TE', need: r.TE },
    { key: 'DEF', need: r.DEF }
  ];
  const cells = positions.map(({ key, need }) => {
    const have = roster[key];
    const shortfall = needs.starterShortfall[key] > 0;
    const players = have.length
      ? have.map((p) => `<div class="player">${esc(p.name)}</div>`).join('')
      : `<div class="empty">none</div>`;
    return `
      <div class="roster-pos ${shortfall ? 'shortfall' : ''}">
        <div class="pos-label">${posLabel(key)} ${have.length}/${need}${shortfall ? ' ⚠' : ''}</div>
        ${players}
      </div>
    `;
  }).join('');
  return `
    <h2>your roster · ${needs.filled}/${needs.totalSlots}</h2>
    <div class="roster-grid">${cells}</div>
    <div class="muted" style="margin-top:8px;">flex shortfall: ${needs.flexShortfall} · bench room: ${needs.benchRoom}</div>
  `;
}

export function renderBoard(state, n = 12) {
  const recent = state.picks.slice(-n).reverse();
  if (recent.length === 0) {
    return `<h2>recent picks</h2><p class="muted">no picks yet.</p>`;
  }
  const items = recent.map((pick) => {
    const p = state.players[pick.playerId];
    const mine = pick.slot === state.mySlot ? 'my-pick' : '';
    return `
      <li class="board-item ${mine}">
        <span class="pick-no">#${pick.pick}</span>
        <span class="pos ${p.position}">${posLabel(p.position)}</span>
        <span>${esc(p.name)}</span>
        <span class="slot">slot ${pick.slot}</span>
      </li>
    `;
  }).join('');
  return `<h2>recent picks</h2><ul class="board-list">${items}</ul>`;
}

export function renderSignals(state, recs) {
  // Aggregated runs/fallers from the rec annotations; plus standalone fallers.
  const seen = new Set();
  const items = [];
  for (const r of recs) {
    for (const s of r.signals || []) {
      const key = `${r.player.id}|${s}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(`<li><span class="label">${esc(r.player.name)}:</span> ${esc(s)}</li>`);
    }
  }
  if (items.length === 0) return '';
  return `<h2>signals</h2><ul class="signal-list">${items.join('')}</ul>`;
}
