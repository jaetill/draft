import { describe, expect, it } from 'vitest';
import {
  assignTiers,
  observedPositionShares,
  tierSignals,
  tierState,
  tierSurvival,
} from './tiers.js';

const P = (id, position, consensus, uncertainty = 1.5) => ({
  id,
  name: id,
  position,
  consensus,
  uncertainty,
});

describe('assignTiers', () => {
  it('separates players the market is confident about', () => {
    // Tight spreads, clear separation — the elite end of a position.
    const t = assignTiers([P('a', 'WR', 3, 1), P('b', 'WR', 3.5, 1.4), P('c', 'WR', 12, 2)]);
    expect(t.find((p) => p.id === 'a').tier).toBe(1);
    expect(t.find((p) => p.id === 'b').tier).toBe(1);
    expect(t.find((p) => p.id === 'c').tier).toBe(2);
  });

  it('merges players the market cannot distinguish, at the SAME gap', () => {
    // This is the whole thesis. Identical consensus gaps as the test above,
    // but wide expert disagreement — so no defensible cliff exists.
    const t = assignTiers([P('a', 'WR', 3, 20), P('b', 'WR', 3.5, 20), P('c', 'WR', 12, 20)]);
    expect(new Set(t.map((p) => p.tier)).size).toBe(1);
  });

  it('does not chain — a tier cannot drift arbitrarily far from its anchor', () => {
    // Each player is within noise of the previous one, but the last is nowhere
    // near the first. Pairwise chaining would call this all one tier.
    const list = Array.from({ length: 12 }, (_, i) => P(`p${i}`, 'RB', i * 3, 2));
    const t = assignTiers(list);
    const first = t[0].tier;
    const last = t[t.length - 1].tier;
    expect(last).toBeGreaterThan(first);
  });

  it('treats a big gap between confident players as a cliff', () => {
    // The anchor-TE shape: two tight elites, then a chasm.
    const t = assignTiers([P('te1', 'TE', 23, 4), P('te2', 'TE', 25, 5), P('te3', 'TE', 45, 13)]);
    expect(t.find((p) => p.id === 'te1').tier).toBe(1);
    expect(t.find((p) => p.id === 'te2').tier).toBe(1);
    expect(t.find((p) => p.id === 'te3').tier).toBe(2);
  });

  it('defaults missing uncertainty rather than splitting on rounding noise', () => {
    const t = assignTiers([
      { id: 'a', position: 'QB', consensus: 10 },
      { id: 'b', position: 'QB', consensus: 10.4 },
    ]);
    expect(t[0].tier).toBe(t[1].tier);
  });

  it('caps runaway tiering', () => {
    const list = Array.from({ length: 40 }, (_, i) => P(`p${i}`, 'RB', i * 50, 1.5));
    expect(Math.max(...assignTiers(list).map((p) => p.tier))).toBeLessThanOrEqual(8);
  });

  it('sorts by consensus regardless of input order', () => {
    const t = assignTiers([P('c', 'RB', 30), P('a', 'RB', 1), P('b', 'RB', 2)]);
    expect(t.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty position', () => {
    expect(assignTiers([])).toEqual([]);
  });
});

describe('tierState', () => {
  const tiered = [
    ...assignTiers([
      P('rb1', 'RB', 1, 1),
      P('rb2', 'RB', 2, 1),
      P('rb3', 'RB', 3, 1),
      P('rb4', 'RB', 30, 2),
    ]),
    ...assignTiers([P('wr1', 'WR', 4, 1), P('wr2', 'WR', 25, 1), P('wr3', 'WR', 26, 1)]),
  ];

  it('counts what is left in the best available tier', () => {
    const s = tierState(tiered, new Set());
    expect(s.RB.tier).toBe(1);
    expect(s.RB.remaining).toBe(3);
    expect(s.WR.remaining).toBe(1);
  });

  it('flags a cliff when the tier is nearly gone', () => {
    expect(tierState(tiered, new Set()).WR.cliff).toBe(true);
    expect(tierState(tiered, new Set()).RB.cliff).toBe(false);
  });

  it('advances to the next tier once the current one is drafted out', () => {
    const s = tierState(tiered, new Set(['rb1', 'rb2', 'rb3']));
    expect(s.RB.tier).toBe(2);
    expect(s.RB.remaining).toBe(1);
    expect(s.RB.best.id).toBe('rb4');
  });

  it('reports the next tier down so you can price the drop-off', () => {
    const s = tierState(tiered, new Set());
    expect(s.RB.nextTier).toBe(2);
    expect(s.RB.nextTierSize).toBe(1);
  });

  it('omits positions that are fully drafted rather than reporting empty ones', () => {
    const s = tierState(tiered, new Set(['wr1', 'wr2', 'wr3']));
    expect(s.WR).toBeUndefined();
    expect(s.RB).toBeDefined();
  });
});

describe('tierSurvival', () => {
  it('calls a deep tier safe across a short wait', () => {
    expect(tierSurvival(10, 4)).toBe('safe');
  });

  it('calls a thin tier gone across a long wait', () => {
    // 1 left, 22 picks until the turn comes back — it will not be there.
    expect(tierSurvival(1, 22)).toBe('gone');
  });

  it('has a risky middle band rather than a binary', () => {
    expect(tierSurvival(6, 16)).toBe('risky');
  });
});

describe('observedPositionShares', () => {
  const players = {
    a: { position: 'RB' },
    b: { position: 'RB' },
    c: { position: 'WR' },
    d: { position: 'QB' },
  };
  const pk = (id) => ({ playerId: id });

  it('measures the rate each position is actually leaving the board', () => {
    const s = observedPositionShares([pk('a'), pk('b'), pk('c'), pk('d')], players);
    expect(s.RB).toBeCloseTo(0.5);
    expect(s.WR).toBeCloseTo(0.25);
    expect(s.QB).toBeCloseTo(0.25);
  });

  it('uses a trailing window so a positional run shows up', () => {
    // Ten picks, but the last four are all RB — a run in progress.
    const older = Array.from({ length: 10 }, () => pk('c'));
    const run = [pk('a'), pk('b'), pk('a'), pk('b')];
    const s = observedPositionShares([...older, ...run], players, 4);
    expect(s.RB).toBeCloseTo(1);
  });

  it('returns an empty map before any picks, so callers fall back to the default', () => {
    expect(observedPositionShares([], players)).toEqual({});
  });

  it('ignores picks referencing players it cannot resolve', () => {
    const s = observedPositionShares([pk('a'), pk('missing')], players);
    expect(s.RB).toBeCloseTo(1);
  });

  it('reports zero for a position nobody is drafting, not the default rate', () => {
    // No defenses taken yet. Falling through to the caller's 0.25 default made
    // DEF look like it was about to disappear in round 4.
    const s = observedPositionShares([pk('a'), pk('b'), pk('c')], players);
    expect(s.DEF).toBe(0);
    expect(tierSurvival(3, 20, s.DEF)).toBe('safe');
  });

  it('feeds survival: a rarely-drafted position survives a long wait', () => {
    // Same tier depth and same wait; only the observed rate differs.
    expect(tierSurvival(3, 20, 0.05)).toBe('safe');
    expect(tierSurvival(3, 20, 0.4)).toBe('gone');
  });
});

describe('tierSignals', () => {
  const tiered = [
    ...assignTiers([
      P('rb1', 'RB', 1, 1),
      P('rb2', 'RB', 2, 1),
      P('rb3', 'RB', 3, 1),
      P('rb4', 'RB', 4, 1),
      P('rb5', 'RB', 5, 1),
    ]),
    ...assignTiers([P('te1', 'TE', 6, 1), P('te2', 'TE', 40, 2)]),
  ];

  it('surfaces only positions at a cliff — flagging everything flags nothing', () => {
    const sig = tierSignals(tierState(tiered, new Set()), 2);
    expect(sig.map((s) => s.position)).toEqual(['TE']);
  });

  it('orders most urgent first', () => {
    const s = tierState(tiered, new Set(['rb1', 'rb2', 'rb3']));
    const sig = tierSignals(s, 22);
    expect(sig[0].remaining).toBeLessThanOrEqual(sig[sig.length - 1].remaining);
  });

  it('words the last-man case distinctly', () => {
    const sig = tierSignals(tierState(tiered, new Set()), 2);
    expect(sig[0].message).toBe('last TE in tier 1');
  });

  it('warns when a tier will not survive the wait', () => {
    const s = tierState(tiered, new Set(['rb1', 'rb2', 'rb3']));
    const rb = tierSignals(s, 22).find((x) => x.position === 'RB');
    expect(rb.message).toMatch(/gone by your next pick/);
  });
});
