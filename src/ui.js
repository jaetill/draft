// Pure render functions. No state, no event handlers — main.js wires events.

import { THESES } from './engine/recommend.js';
import { posLabel } from './engine/labels.js';
import { ARCHETYPE_LABELS, profileForSlot } from './owners.js';
import { availabilityOf } from './availability.js';
import { backfieldLabel } from './backfield.js';
import { byeImpact } from './byes.js';
import { tierSurvival } from './tiers.js';

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );

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

export function renderControls(ui, state, opts = {}) {
  const slots = [];
  for (let s = 1; s <= state.teams; s++) {
    slots.push(`<option value="${s}" ${s === state.mySlot ? 'selected' : ''}>${s}</option>`);
  }
  const thesisOpts = Object.entries(THESES)
    .map(
      ([k, t]) =>
        `<option value="${k}" ${ui.thesis === k ? 'selected' : ''}>${esc(t.label)}</option>`,
    )
    .join('');

  const onClock = state.isMyTurn || state.isComplete;

  const isLive = ui.mode === 'live';
  const slotLocked = isLive || state.picks.length > 0;

  let liveStatusHtml = '';
  if (isLive && ui.live) {
    const s = ui.live;
    const statusLabel =
      {
        pre_draft: 'pre-draft (waiting for commissioner to start)',
        drafting: 'DRAFTING — live',
        paused: 'paused',
        complete: 'complete',
      }[s.draftStatus] ||
      s.draftStatus ||
      'unknown';
    const polledAgo = s.lastPollAt
      ? `${Math.round((Date.now() - s.lastPollAt.getTime()) / 1000)}s ago`
      : 'never';
    liveStatusHtml = `
      <div class="muted" style="margin-top:8px;">
        <strong>${esc(s.leagueName || 'league')}</strong> · status: ${esc(statusLabel)} · last poll: ${polledAgo}
        ${s.lastError ? `<br><span style="color:var(--bad)">error: ${esc(s.lastError)}</span>` : ''}
        ${!s.orderSet && s.draftStatus === 'pre_draft' ? '<br>draft order not set yet — commissioner will assign slots before draft.' : ''}
        ${s.sizeMismatch ? `<br><span style="color:var(--bad)">⚠ ${esc(s.sizeMismatch)} — VBD replacement levels are tuned for the league size</span>` : ''}
        ${s.roundsMismatch ? `<br><span style="color:var(--bad)">⚠ ${esc(s.roundsMismatch)} — roster needs and bye math assume the league shape</span>` : ''}
        ${opts.personasOff ? '<br>personas off — this room is a different size than the league chart.' : ''}
      </div>
    `;
  }

  return `
    <h2>controls</h2>
    <div class="controls-row">
      <label>mode
        <select id="mode-select">
          <option value="mock" ${ui.mode === 'mock' ? 'selected' : ''}>mock (practice)</option>
          <option value="live" ${ui.mode === 'live' ? 'selected' : ''}>live (Sleeper)</option>
        </select>
      </label>
      <label>slot
        <select id="slot-select" ${slotLocked && !isLive ? 'disabled' : ''}>${slots.join('')}</select>
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
      <label>lookahead
        <input type="checkbox" id="lookahead-toggle" ${ui.lookahead ? 'checked' : ''} />
      </label>
      <label>draft id
        <input
          type="text"
          id="draft-id-input"
          inputmode="numeric"
          placeholder="mock room URL id (optional)"
          value="${esc(ui.draftIdInput || '')}"
          ${ui.mode === 'live' ? 'disabled' : ''}
        />
      </label>
    </div>
    <div class="controls-row" style="margin-top:8px;">
      <button id="step-btn" ${isLive || onClock ? 'disabled' : ''}>auto-pick to my turn</button>
      <button id="undo-btn" class="secondary" ${isLive || state.picks.length === 0 ? 'disabled' : ''}>undo</button>
      <button id="reset-btn" class="secondary" ${isLive ? 'disabled' : ''}>reset</button>
    </div>
    ${liveStatusHtml}
    <div class="muted" style="margin-top:8px;">
      <strong>L3 signals always on</strong> — position runs (≥5 in last 10) and ADP fallers (≥10 picks below ADP) appear inline as ⚡ on each recommendation.
      ${ui.thesis !== 'none' ? `<br><strong>L4 active:</strong> ${esc(THESES[ui.thesis].description)}` : ''}
    </div>
  `;
}

/**
 * Live tier depth per position, plus the cliff warnings that survive gating.
 * This is the number that actually drives a snake-draft decision: not "who is
 * best" but "how many of these are left before the drop".
 */
export function renderTiers(view) {
  if (!view) return '';
  const { st, shares, away, signals } = view;
  const POS_ORDER = ['RB', 'WR', 'TE', 'QB', 'DEF'];
  const cells = POS_ORDER.filter((pos) => st[pos])
    .map((pos) => {
      const s = st[pos];
      const survival = tierSurvival(s.remaining, away, shares[pos]);
      const cls = survival === 'gone' ? 'gone' : s.remaining <= 2 ? 'cliff' : '';
      const note =
        survival === 'gone'
          ? 'gone by your pick'
          : survival === 'risky'
            ? 'risky'
            : s.remaining <= 2
              ? 'nearly out'
              : '';
      return `
      <div class="tier-cell ${cls}">
        <span class="pos ${pos}">${posLabel(pos)}</span>
        <span class="tier-count">${s.remaining}</span>
        <span class="tier-note">left in T${s.tier}${note ? ` · ${note}` : ''}</span>
      </div>`;
    })
    .join('');
  if (!cells) return '';
  const sigs = signals
    .slice(0, 3)
    .map((s) => `<li>⚠ ${esc(s.message)}</li>`)
    .join('');
  return `
    <h2>tier depth · best tier left per position</h2>
    <div class="tier-grid">${cells}</div>
    ${sigs ? `<ul class="signal-list">${sigs}</ul>` : ''}
  `;
}

/** Per-player context the score cannot see: byes, committees, availability. */
function recContext(r, evalRoster, cfg, backfields) {
  const p = r.player;
  const impact = byeImpact(p, evalRoster, cfg);
  const byeWarn = impact
    ? `<span class="signal" style="display:inline; color:var(--bad);">⚠ ${esc(impact.message)}</span>`
    : '';

  // Depth-chart position and committee status, when we know them. A back
  // splitting carries a compressed ceiling, which VBD cannot see.
  const bf = backfields ? backfieldLabel(backfields.get(p.id)) : '';
  const depth = p.depth_chart_order ? `${p.position}${p.depth_chart_order} on depth chart` : '';
  // Availability only when it means missed games — the raw injury tag is
  // dominated by preseason "Questionable" noise.
  const avail = availabilityOf(p);
  const availLabel =
    avail?.level === 'out'
      ? `⛔ ${avail.label}${avail.weeksLikelyMissed ? ` — ~${avail.weeksLikelyMissed}+ wks` : ''}`
      : '';
  const context = [depth, bf, availLabel].filter(Boolean).join(' · ');
  return { byeWarn, context };
}

/**
 * @param {Array} recs
 * @param {DraftState} state
 * @param {object} opts - {mode, projected, away, evalRoster, cfg, backfields,
 *   allZero, beforeYou, lookahead}
 */
export function renderRecommendations(recs, state, opts = {}) {
  const {
    mode = 'mock',
    projected = false,
    away = 0,
    evalRoster = [],
    cfg = state.cfg,
    backfields = null,
    allZero = false,
    beforeYou = '',
    lookahead = false,
  } = opts;

  if (state.isComplete) {
    return `<h2>recommendations</h2><p class="muted">draft complete.</p>`;
  }

  let heading;
  let note = '';
  if (state.isMyTurn) {
    heading =
      mode === 'live' ? `<h2>★ you're on the clock</h2>` : `<h2>your pick — tap to draft</h2>`;
    if (lookahead) {
      note = `<p class="muted">ranked by two-pick total: this pick + your best option next turn</p>`;
    }
  } else if (projected && recs.length) {
    heading = `<h2>projected board at your pick</h2>`;
    note = `<p class="muted">${away} pick${away === 1 ? '' : 's'} away — opponents simulated${
      beforeYou ? `<br>picking before you: ${esc(beforeYou)}` : ''
    }</p>`;
  } else {
    const hint =
      mode === 'live'
        ? 'other team on the clock — picks will sync from Sleeper.'
        : 'other team on the clock — auto-pick to advance.';
    return `<h2>recommendations</h2><p class="muted">${hint}</p>`;
  }

  if (recs.length === 0) {
    return `${heading}<p class="muted">no recommendations available.</p>`;
  }

  const zeroNote = allZero
    ? `<p class="muted">no positive-value players left — take upside, not VBD.</p>`
    : '';

  const canDraft = mode === 'mock' && state.isMyTurn;
  const items = recs
    .map((r, i) => {
      const tierClass = r.tier <= 3 ? `tier-${r.tier}` : '';
      const signals = (r.signals || [])
        .map((s) => `<span class="signal">⚡ ${esc(s)}</span>`)
        .join('');
      // "Take him NOW, and this is the best player still on the board at your
      // next turn" — futureScore, not futureVbd: the list is ordered by score,
      // and raw VBD made a heavily-penalised player look like a strong
      // consolation prize.
      const future = r.futureBest
        ? `<div class="meta" style="color:var(--accent); margin-top:4px;">→ take him, then likely ${esc(r.futureBest.name)} (${esc(r.futureBest.position)}${r.futureBest.posRank}, ${Math.round(r.futureScore ?? 0)}) = ${Math.round(r.totalScore ?? r.score)} over both picks</div>`
        : '';
      const { byeWarn, context } = recContext(r, evalRoster, cfg, backfields);
      const bye = r.player.bye_week ? ` · bye ${r.player.bye_week}` : '';
      // SCORE is what the list is ordered by (VBD × roster need). Showing VBD
      // alone made the ranking look scrambled.
      const mult = r.mult !== undefined && r.mult !== 1 ? ` ×${r.mult.toFixed(2)}` : '';
      const scoreLine = `${Math.round(r.score)} (${esc(r.rationale)}${mult})${bye}`;
      return `
      <li class="rec-item ${tierClass} ${canDraft ? 'draftable' : ''}" data-player-id="${esc(r.player.id)}">
        <span class="rank">${i + 1}</span>
        <div class="info">
          <div class="name">${esc(r.player.name)}${r.player.team ? ` · ${esc(r.player.team)}` : ''}</div>
          <div class="meta">${scoreLine} ${byeWarn}</div>
          ${context ? `<div class="meta">${esc(context)}</div>` : ''}
          ${future}
          ${signals}
        </div>
        <span class="pos ${r.player.position}">${posLabel(r.player.position)}</span>
      </li>
    `;
    })
    .join('');
  return `${heading}${note}${zeroNote}<ul class="rec-list">${items}</ul>`;
}

/**
 * Browseable list of available players. Position filter tabs + sortable list.
 * In mock mode + my turn, taps draft the player.
 */
export function renderAvailable(state, rankings, uiState, mode = 'mock') {
  const allAvailable = state.available();
  const filter = uiState.availablePosFilter || 'ALL';
  const FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF'];
  const POS_LIMIT = 40;

  // Counts by position for the tab labels.
  const counts = { ALL: allAvailable.length, QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
  for (const p of allAvailable) {
    if (counts[p.position] !== undefined) counts[p.position]++;
  }

  const tabs = FILTERS.map(
    (f) =>
      `<button class="filter-tab ${f === filter ? 'active' : ''}" data-filter="${f}">${f} <span class="muted">${counts[f]}</span></button>`,
  ).join('');

  // Compute replacement levels for VBD display.
  const replacement = {};
  for (const [pos, cutoff] of Object.entries(state.cfg.replacement_levels || {})) {
    if (pos.startsWith('_')) continue;
    replacement[pos] = rankings.replacementPoints(pos, cutoff);
  }

  // Filter + score.
  let filtered =
    filter === 'ALL' ? allAvailable : allAvailable.filter((p) => p.position === filter);

  const scored = filtered.map((p) => {
    const proj = rankings.projection(p);
    const vbd = Math.max(0, proj - (replacement[p.position] || 0));
    const tier = rankings.tier(p);
    const posRank = rankings.posRank.get(p.id) ?? 999;

    // Show the consensus rank when we have one. The old label here said "ADP
    // <search_rank>", which was wrong twice over: search_rank is Sleeper's
    // search-popularity index, not average draft position, and it has no
    // bearing on value. An unranked player is worth flagging as such.
    const ecr = rankings.meta.ecr(p);
    const rankLabel =
      ecr !== null
        ? ` · ECR ${Math.round(ecr)}`
        : rankings.meta.usingRealRankings
          ? ' · unranked'
          : '';

    // Expert spread as a risk read. Wide disagreement on a player is a real
    // signal — it usually means the field is split on role or health.
    const sd = rankings.meta.spread(p);
    const riskLabel =
      sd === null ? '' : sd >= 25 ? ' · ⚠ high spread' : sd >= 15 ? ' · wide spread' : '';

    return { player: p, proj, vbd, tier, posRank, rankLabel, riskLabel };
  });
  scored.sort((a, b) => b.vbd - a.vbd);
  const top = scored.slice(0, POS_LIMIT);

  const canDraft = mode === 'mock' && state.isMyTurn;
  const items = top
    .map((s) => {
      const tierClass = s.tier <= 3 ? `tier-${s.tier}` : '';
      const injury = s.player.injury_status
        ? `<span class="signal" style="display:inline; color:var(--bad);">${esc(s.player.injury_status)}</span>`
        : '';
      return `
      <li class="rec-item ${tierClass} ${canDraft ? 'draftable' : ''}" data-player-id="${esc(s.player.id)}">
        <span class="rank">${s.player.position}${s.posRank}</span>
        <div class="info">
          <div class="name">${esc(s.player.name)}${s.player.team ? ` · ${esc(s.player.team)}` : ''} ${injury}</div>
          <div class="meta">+${s.vbd.toFixed(0)} VBD · tier ${s.tier}${s.rankLabel}${s.riskLabel}${s.player.exp === 0 ? ' · ROOKIE' : ''}</div>
        </div>
        <span class="pos ${s.player.position}">${posLabel(s.player.position)}</span>
      </li>
    `;
    })
    .join('');

  const showing =
    top.length < scored.length ? `(showing top ${top.length} of ${scored.length})` : '';
  return `
    <h2>available players ${showing}</h2>
    <div class="filter-tabs">${tabs}</div>
    <ul class="rec-list" style="max-height:480px; overflow-y:auto;">${items || '<li class="muted">none</li>'}</ul>
  `;
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
    { key: 'DEF', need: r.DEF },
  ];
  const cells = positions
    .map(({ key, need }) => {
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
    })
    .join('');
  return `
    <h2>your roster · ${needs.filled}/${needs.totalSlots}</h2>
    <div class="roster-grid">${cells}</div>
    <div class="muted" style="margin-top:8px;">flex shortfall: ${needs.flexShortfall} · bench room: ${needs.benchRoom}</div>
  `;
}

export function renderBoard(state, n = 12, ownerProfiles = null) {
  const recent = state.picks.slice(-n).reverse();

  // Upcoming picks preview (next 4 slots) with archetype hints.
  let upcomingHtml = '';
  if (ownerProfiles && !state.isComplete) {
    const upcoming = [];
    for (let i = 0; i < 4 && state.currentPick + i <= state.totalPicks; i++) {
      const pickNo = state.currentPick + i;
      const slot = state.slotAtPick(pickNo);
      const profile = profileForSlot(ownerProfiles, slot);
      upcoming.push({ pickNo, slot, profile, mine: slot === state.mySlot });
    }
    upcomingHtml = `
      <h2>up next</h2>
      <ul class="board-list" style="margin-bottom:12px;">
        ${upcoming
          .map((u) => {
            const tags = [];
            if (u.profile?.primary) {
              tags.push(
                `<span class="signal" style="display:inline">⚡ ${esc(ARCHETYPE_LABELS[u.profile.primary] || u.profile.primary)}</span>`,
              );
            }
            const aff = (u.profile?.teamAffinities || []).slice(0, 2);
            for (const a of aff) {
              tags.push(
                `<span class="signal" style="display:inline">${esc(a.team)} ${a.ratio}x</span>`,
              );
            }
            const rk = u.profile?.rookieAffinity?.ratio || 0;
            if (rk >= 1.4) {
              tags.push(
                `<span class="signal" style="display:inline">rookies ${rk.toFixed(1)}x</span>`,
              );
            }
            if (u.profile?.occasionallyAutodrafts) {
              tags.push(
                `<span class="signal muted" style="display:inline; opacity:0.7;">may autodraft</span>`,
              );
            }
            const name = u.profile?.name || `slot ${u.slot}`;
            return `
            <li class="board-item ${u.mine ? 'my-pick' : ''}">
              <span class="pick-no">#${u.pickNo}</span>
              <span class="slot" style="grid-column:2/4;">${esc(name)} ${tags.join(' ')}</span>
              <span class="slot">slot ${u.slot}</span>
            </li>
          `;
          })
          .join('')}
      </ul>
    `;
  }

  if (recent.length === 0) {
    return `${upcomingHtml}<h2>recent picks</h2><p class="muted">no picks yet.</p>`;
  }
  const items = recent
    .map((pick) => {
      const p = state.players[pick.playerId];
      const mine = pick.slot === state.mySlot ? 'my-pick' : '';
      const profile = ownerProfiles ? profileForSlot(ownerProfiles, pick.slot) : null;
      const owner = profile?.name ? esc(profile.name) : `slot ${pick.slot}`;
      return `
      <li class="board-item ${mine}">
        <span class="pick-no">#${pick.pick}</span>
        <span class="pos ${p.position}">${posLabel(p.position)}</span>
        <span>${esc(p.name)}</span>
        <span class="slot">${owner}</span>
      </li>
    `;
    })
    .join('');
  return `${upcomingHtml}<h2>recent picks</h2><ul class="board-list">${items}</ul>`;
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
