import { describe, expect, it } from 'vitest';
import { recommend } from './l2.js';
import { DraftState } from '../state.js';

const cfg = {
  teams: 12,
  roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, DEF: 1, BENCH: 6 },
  flex_eligible: ['RB', 'WR', 'TE'],
  te_flex_penalty: 0.5,
  replacement_levels: { QB: 12, RB: 30, WR: 36, TE: 15, DEF: 12 },
  def_earliest_round: 15,
};

/**
 * Minimal player pool: several viable players at each position, with points
 * arranged so raw VBD would favour piling up tight ends and quarterbacks.
 * That is exactly the shape that produced a five-TE recommendation list.
 */
const players = {};
const add = (id, position, pts) => {
  players[id] = { id, name: id, position, team: 'AAA', search_rank: 100, bye_week: null, pts };
};
for (let i = 1; i <= 20; i++) add(`TE${i}`, 'TE', 300 - i * 8);
for (let i = 1; i <= 40; i++) add(`RB${i}`, 'RB', 400 - i * 7);
for (let i = 1; i <= 40; i++) add(`WR${i}`, 'WR', 390 - i * 5);
for (let i = 1; i <= 20; i++) add(`QB${i}`, 'QB', 410 - i * 10);
for (let i = 1; i <= 12; i++) add(`DEF${i}`, 'DEF', 190 - i * 5);

const byPos = {};
for (const p of Object.values(players)) (byPos[p.position] ??= []).push(p);
for (const list of Object.values(byPos)) list.sort((a, b) => b.pts - a.pts);

const posRank = new Map();
for (const list of Object.values(byPos)) list.forEach((p, i) => posRank.set(p.id, i + 1));

const rankings = {
  posRank,
  byPos,
  projection: (p) => players[p.id]?.pts ?? 0,
  tier: () => 1,
  posTier: () => 1,
  replacementPoints(pos, cutoff) {
    const list = byPos[pos] ?? [];
    const t = list[Math.min(cutoff - 1, list.length - 1)];
    return t ? t.pts : 0;
  },
  meta: { isRanked: () => true, ecr: () => null, spread: () => null },
};

function stateWith(roster) {
  const s = new DraftState(cfg, players, 1);
  s.picks = roster.map((id, i) => ({ pick: i + 1, slot: 1, playerId: id }));
  s.taken = new Set(roster);
  return s;
}

const positionsIn = (recs) => recs.map((r) => r.player.position);

describe('roster strategy overrides', () => {
  // This manager does not bench a healthy starter and does not flex tight ends;
  // he covers byes from waivers. A drafted QB2 or TE2 is worth almost nothing.
  const strat = {
    ...cfg,
    roster_strategy: { flex_te_discount: 0.9, backup_qb_value: 0.05, backup_te_value: 0.05 },
  };

  function stateStrat(roster) {
    const s = new DraftState(strat, players, 1);
    s.picks = roster.map((id, i) => ({ pick: i + 1, slot: 1, playerId: id }));
    s.taken = new Set(roster);
    return s;
  }

  it('prices a backup QB near zero when he never benches his starter', () => {
    const filled = ['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1'];
    const withStrat = recommend(stateStrat(filled), rankings, 30);
    const qb = withStrat.find((r) => r.player.position === 'QB');
    if (qb) expect(qb.mult).toBeLessThanOrEqual(0.05);
  });

  it('lets a tight end take the flex on merit — no quality gate', () => {
    // Two earlier rules hard-blocked TEs from the flex. Both were wrong: the
    // comparison is on points, and the flex baseline already makes it.
    const filled = ['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1'];
    const recs = recommend(stateStrat(filled), rankings, 60);
    const te = recs.find((r) => r.player.position === 'TE');
    if (te) expect(te.slot).toBe('flex');
  });

  it('breaks near-ties toward an RB/WR blend without overruling a better TE', () => {
    const filled = ['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1'];
    const recs = recommend(stateStrat(filled), rankings, 60);
    const te = recs.find((r) => r.player.position === 'TE' && r.slot === 'flex');
    const wr = recs.find((r) => r.player.position === 'WR' && r.slot === 'flex');

    // The discount is a nudge, not a veto: a TE's multiplier is lower than a
    // receiver's, but he still ranks above one he clearly out-projects.
    if (te && wr) {
      expect(te.mult).toBeLessThan(wr.mult);
      expect(te.mult / wr.mult).toBeCloseTo(0.9, 2);
    }
  });

  it('pure point comparison when the discount is 1.0', () => {
    const pure = { ...strat, roster_strategy: { ...strat.roster_strategy, flex_te_discount: 1.0 } };
    const s = new DraftState(pure, players, 1);
    const filled = ['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1'];
    s.picks = filled.map((id, i) => ({ pick: i + 1, slot: 1, playerId: id }));
    s.taken = new Set(filled);

    const recs = recommend(s, rankings, 60);
    const te = recs.find((r) => r.player.position === 'TE' && r.slot === 'flex');
    const wr = recs.find((r) => r.player.position === 'WR' && r.slot === 'flex');
    if (te && wr) expect(te.mult).toBeCloseTo(wr.mult, 5);
  });

  it('leaves the default behaviour untouched without a strategy block', () => {
    const filled = ['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1'];
    const plain = recommend(stateWith(filled), rankings, 30);
    const te = plain.find((r) => r.player.position === 'TE');
    if (te) expect(te.slot).toBe('flex');
  });
});

describe('l2 positional saturation', () => {
  it('recommends a starter at an empty position', () => {
    const recs = recommend(stateWith([]), rankings, 6);
    expect(recs.length).toBeGreaterThan(0);
  });

  it('does not stack tight ends once the TE slot is filled', () => {
    // One elite TE rostered. Raw VBD still likes TE2..TE5, but you can start
    // at most one more via flex and never five.
    const recs = recommend(stateWith(['TE1', 'RB1', 'RB2', 'WR1', 'WR2']), rankings, 6);
    const tes = positionsIn(recs).filter((p) => p === 'TE').length;
    expect(tes).toBeLessThanOrEqual(1);
  });

  it('does not recommend a third quarterback', () => {
    const recs = recommend(stateWith(['QB1', 'QB2', 'RB1', 'RB2', 'WR1', 'WR2']), rankings, 6);
    expect(positionsIn(recs)).not.toContain('QB');
  });

  it('still recommends RB/WR depth after starters are filled', () => {
    const recs = recommend(stateWith(['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1']), rankings, 6);
    const skill = positionsIn(recs).filter((p) => p === 'RB' || p === 'WR').length;
    expect(skill).toBeGreaterThan(0);
  });

  it('ranks by score, and score is VBD times the need multiplier', () => {
    const recs = recommend(stateWith(['RB1']), rankings, 6);
    for (const r of recs) {
      expect(r.score).toBeCloseTo(r.vbd * r.mult, 5);
    }
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
    }
  });

  it('measures a flex-bound player against the flex line, not his own position', () => {
    // Starters all filled, flex open. A TE here competes for the flex slot
    // against every RB and WR, so his baseline must be the flex replacement —
    // not TE15, which would credit him for scarcity he cannot use.
    const s = stateWith(['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1']);
    const recs = recommend(s, rankings, 20);
    const flexBound = recs.filter((r) => r.slot === 'flex');
    expect(flexBound.length).toBeGreaterThan(0);

    // Same player, both baselines. TE replacement is deeper (worse) than the
    // flex line in this pool, so the flex baseline must yield the lower value.
    const te = Object.values(players).find((p) => p.position === 'TE' && p.id === 'TE2');
    const teRepl = rankings.replacementPoints('TE', 15);
    const viaPosition = te.pts - teRepl;
    const rec = recs.find((r) => r.player.id === 'TE2');
    if (rec && rec.slot === 'flex') {
      expect(rec.vbd).toBeLessThan(viaPosition);
    }
  });

  it('labels the baseline it used, so +40 is not ambiguous', () => {
    const recs = recommend(stateWith(['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1']), rankings, 12);
    const flexBound = recs.find((r) => r.slot === 'flex');
    if (flexBound) expect(flexBound.rationale).toMatch(/vs flex/);
  });

  it('applies the flex penalty proportionally, not as a flat ratio', () => {
    // The bug this replaces: a constant multiplier over-punished elite TEs and
    // under-punished replacement-level ones. A fixed subtraction does neither —
    // the ratio must shrink as the player gets worse.
    const s = stateWith(['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1']);
    const recs = recommend(s, rankings, 60);
    const tes = recs.filter((r) => r.player.position === 'TE' && r.slot === 'flex');
    if (tes.length >= 2) {
      const teRepl = rankings.replacementPoints('TE', 15);
      const ratio = (r) => r.vbd / (players[r.player.id].pts - teRepl);
      const best = tes[0];
      const worst = tes[tes.length - 1];
      expect(ratio(best)).toBeGreaterThan(ratio(worst));
    }
  });

  it('falls back to best-available when VBD has bottomed out for everyone', () => {
    // Late-round reality: nothing left has positive value, so score ties at 0
    // and the sort has nothing to separate on. Without a tiebreak the list was
    // whatever order the available pool happened to be in — a wall of
    // interchangeable backup QBs. Consensus rank is the honest fallback.
    const ecrByName = {};
    Object.values(players).forEach((p, i) => (ecrByName[p.id] = i + 1));
    const withEcr = {
      ...rankings,
      // Everyone projects at replacement level → every VBD is zero.
      projection: () => 0,
      meta: { ...rankings.meta, ecr: (p) => ecrByName[p.id] ?? 9999 },
    };
    const recs = recommend(stateWith(['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1']), withEcr, 5);
    expect(recs.every((r) => r.score === 0)).toBe(true);
    const ecrs = recs.map((r) => ecrByName[r.player.id]);
    expect([...ecrs]).toEqual([...ecrs].sort((a, b) => a - b));
  });

  it('drives the multiplier toward zero at a saturated position', () => {
    const loaded = ['TE1', 'TE2', 'TE3', 'RB1', 'RB2', 'WR1', 'WR2', 'QB1'];
    const recs = recommend(stateWith(loaded), rankings, 12);
    const te = recs.find((r) => r.player.position === 'TE');
    if (te) expect(te.mult).toBeLessThan(0.1);
  });
});

describe('zero-VBD tiebreak restores the slot hierarchy', () => {
  // The bug: once VBD floors at zero mid-draft, score = vbd × mult is 0 for
  // everyone and the need multiplier stops mattering. With ECR as the only
  // tiebreak, a fifth tight end (mult 0.02, well-ranked by experts) beat a
  // startable RB filling an open starter slot (mult 1.4). Ties must break on
  // mult first — starter > flex > bench — and only then on consensus.
  it('prefers an open starter slot over a buried bench position at score 0', () => {
    const ecrByName = {};
    Object.values(players).forEach((p, i) => (ecrByName[p.id] = i + 1));
    const flat = {
      ...rankings,
      projection: () => 0, // every VBD is zero
      meta: { ...rankings.meta, ecr: (p) => ecrByName[p.id] ?? 9999 },
    };
    // RB2 starter slot still open; TE loaded to saturation. TEs carry the best
    // ECR in this pool (ids inserted first), so under the old sort they win.
    const recs = recommend(stateWith(['QB1', 'RB1', 'WR1', 'WR2', 'TE1', 'TE2']), flat, 3);
    expect(recs.every((r) => r.score === 0)).toBe(true);
    expect(recs[0].slot).toBe('starter');
    expect(recs[0].player.position).toBe('RB');
  });

  it('within equal multipliers, still falls back to consensus order', () => {
    const ecrByName = {};
    Object.values(players).forEach((p, i) => (ecrByName[p.id] = i + 1));
    const flat = {
      ...rankings,
      projection: () => 0,
      meta: { ...rankings.meta, ecr: (p) => ecrByName[p.id] ?? 9999 },
    };
    const recs = recommend(stateWith(['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1']), flat, 5);
    for (let i = 1; i < recs.length; i++) {
      if (recs[i - 1].mult === recs[i].mult) {
        expect(ecrByName[recs[i - 1].player.id]).toBeLessThan(ecrByName[recs[i].player.id]);
      }
    }
  });
});

describe('max_flex_te caps how many TEs the flex can hold', () => {
  const capped = {
    ...cfg,
    roster_strategy: { flex_te_discount: 0.9, backup_te_value: 0.05, max_flex_te: 1 },
  };

  function stateCapped(roster) {
    const s = new DraftState(capped, players, 1);
    s.picks = roster.map((id, i) => ({ pick: i + 1, slot: 1, playerId: id }));
    s.taken = new Set(roster);
    return s;
  }

  it('lets the first TE past the starter compete for flex on merit', () => {
    const recs = recommend(stateCapped(['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1']), rankings, 60);
    const te = recs.find((r) => r.player.position === 'TE');
    if (te) expect(te.slot).toBe('flex');
  });

  it('values the second flex-bound TE as bench, not flex', () => {
    // TE1 starts, TE2 occupies a flex slot. Without the cap, TE3 got the same
    // per-player comparison and the engine built a three-TE starting lineup.
    const recs = recommend(
      stateCapped(['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'TE2']),
      rankings,
      60,
    );
    const te = recs.find((r) => r.player.position === 'TE');
    if (te) {
      expect(te.slot).toBe('bench');
      expect(te.mult).toBeLessThanOrEqual(0.05);
    }
  });

  it('does not cap without the config key — default behaviour unchanged', () => {
    const recs = recommend(
      stateWith(['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'TE2']),
      rankings,
      60,
    );
    const te = recs.find((r) => r.player.position === 'TE');
    if (te) expect(te.slot).toBe('flex');
  });
});
