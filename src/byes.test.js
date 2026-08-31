import { describe, expect, it } from 'vitest';
import { byeDistribution, byeImpact, byeReport, isValidByeWeek, severityFor } from './byes.js';

// Jason's league: QB1 RB2 WR2 TE1 FLEX2 DEF1 = 9 starters, 6 bench, 15 total.
const cfg = {
  roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, DEF: 1, BENCH: 6 },
  flex_eligible: ['RB', 'WR', 'TE'],
};

const P = (position, bye_week, name = `${position}-w${bye_week}`) => ({
  name,
  position,
  bye_week,
});

/**
 * A realistic 15-man roster with byes spread out. Note it carries a single DEF
 * and a single TE — which is normal, and which is exactly why a one-slot
 * shortfall must not be treated as a problem.
 */
const spread = [
  P('QB', 5),
  P('QB', 11),
  P('RB', 6),
  P('RB', 7),
  P('RB', 9),
  P('RB', 12),
  P('WR', 5),
  P('WR', 8),
  P('WR', 10),
  P('WR', 13),
  P('WR', 14),
  P('TE', 9),
  P('TE', 12),
  P('DEF', 13),
  P('RB', 4),
];

describe('isValidByeWeek', () => {
  it('accepts real bye weeks', () => {
    expect(isValidByeWeek(4)).toBe(true);
    expect(isValidByeWeek(14)).toBe(true);
  });

  it('rejects the null that players.json actually ships', () => {
    expect(isValidByeWeek(null)).toBe(false);
    expect(isValidByeWeek(undefined)).toBe(false);
  });

  it('rejects out-of-range and non-integer weeks', () => {
    expect(isValidByeWeek(1)).toBe(false);
    expect(isValidByeWeek(18)).toBe(false);
    expect(isValidByeWeek(6.5)).toBe(false);
  });
});

describe('severityFor', () => {
  it('treats a single unfilled slot as streamable, not a problem', () => {
    expect(severityFor(0)).toBe('none');
    expect(severityFor(1)).toBe('stream');
  });

  it('escalates once you lose multiple slots in one week', () => {
    expect(severityFor(2)).toBe('costly');
    expect(severityFor(3)).toBe('severe');
  });
});

describe('byeReport', () => {
  it('stays silent on a well-spread roster', () => {
    expect(byeReport(spread, cfg)).toEqual([]);
  });

  it('does not flag the week the only DEF is out — that is streaming, not a hole', () => {
    // Week 13 loses the sole DEF and a WR. Still only one unfilled slot.
    const wk13 = byeReport(spread, cfg, { includeStreamable: true }).find((p) => p.week === 13);
    expect(wk13.slotsUnfilled).toBe(1);
    expect(wk13.severity).toBe('stream');
    // And it must not appear in the default report.
    expect(byeReport(spread, cfg).map((p) => p.week)).not.toContain(13);
  });

  it('flags a week that guts multiple starting slots', () => {
    const bunched = [
      P('QB', 5),
      P('RB', 6),
      P('RB', 6),
      P('RB', 6),
      P('WR', 6),
      P('WR', 6),
      P('WR', 8),
      P('TE', 10),
      P('DEF', 13),
    ];
    const wk6 = byeReport(bunched, cfg).find((p) => p.week === 6);
    expect(wk6).toBeDefined();
    expect(wk6.slotsUnfilled).toBeGreaterThanOrEqual(2);
    expect(['costly', 'severe']).toContain(wk6.severity);
    expect(wk6.onBye).toHaveLength(5);
  });

  it('ignores weeks where nobody is on bye', () => {
    expect(byeReport(spread, cfg, { includeStreamable: true }).map((p) => p.week)).not.toContain(3);
  });

  it('counts an unfillable FLEX as a real shortfall', () => {
    const thinFlex = [
      P('QB', 5),
      P('RB', 6),
      P('RB', 6),
      P('WR', 6),
      P('WR', 6),
      P('TE', 10),
      P('DEF', 13),
    ];
    const wk6 = byeReport(thinFlex, cfg, { includeStreamable: true }).find((p) => p.week === 6);
    expect(wk6.flexShort).toBeGreaterThan(0);
  });
});

describe('byeImpact', () => {
  it('returns null when the player has no bye data', () => {
    expect(byeImpact(P('RB', null), spread, cfg)).toBeNull();
    expect(byeImpact(P('RB', undefined), spread, cfg)).toBeNull();
  });

  it('returns null for the overwhelmingly common harmless pick', () => {
    expect(byeImpact(P('RB', 4), spread, cfg)).toBeNull();
  });

  it('stays quiet when the pick only creates a streamable one-slot gap', () => {
    const base = [
      P('QB', 5),
      P('RB', 6),
      P('RB', 7),
      P('WR', 8),
      P('WR', 9),
      P('TE', 10),
      P('DEF', 11),
      P('RB', 12),
      P('WR', 13),
    ];
    // Adding a second QB on week 5 changes nothing that matters.
    expect(byeImpact(P('QB', 5), base, cfg)).toBeNull();
  });

  it('flags a pick that stacks a week already carrying starters', () => {
    // Full-ish roster, four skill starters already on week 6.
    const stacked = [
      P('QB', 5),
      P('RB', 6),
      P('RB', 6),
      P('RB', 11),
      P('WR', 6),
      P('WR', 6),
      P('WR', 9),
      P('TE', 10),
      P('DEF', 13),
      P('RB', 12),
      P('WR', 14),
    ];
    const impact = byeImpact(P('RB', 6, 'Fifth Week 6 Body'), stacked, cfg);
    expect(impact).not.toBeNull();
    expect(impact.week).toBe(6);
    expect(impact.byeCost).toBeGreaterThanOrEqual(2);
    expect(impact.message).toMatch(/wk6/);
    // Names the others sharing the bye, so you can see what you're stacking on.
    expect(impact.message).toMatch(/with /);
  });

  it('reports only the shortfall the BYE caused, not the whole roster gap', () => {
    // Round-3 roster: two players, so it is short at nearly every position.
    // Drafting a third who shares a bye with one of them must blame the bye for
    // its own damage only — not for the six slots not yet drafted. Reporting the
    // absolute shortfall here produced warnings like "1 short at QB, 2 short at
    // WR, 1 short at DEF" on a roster that simply had not drafted a QB yet.
    const early = [P('RB', 6, 'Anchor Back'), P('TE', 13, 'Elite TE')];
    const impact = byeImpact(P('RB', 13, 'Week 13 Back'), early, cfg);
    if (impact) {
      expect(impact.message).not.toMatch(/QB/);
      expect(impact.message).not.toMatch(/DEF/);
      // Only positions the bye actually emptied may appear.
      expect(impact.message).toMatch(/wk13/);
    }
  });

  it('is not fooled by an incomplete early-draft roster', () => {
    // Round 3: three players, nowhere near a full lineup. Every week looks
    // "short" in absolute terms, but none of it is caused by byes.
    const round3 = [P('RB', 6), P('WR', 8), P('WR', 11)];
    expect(byeReport(round3, cfg)).toEqual([]);
    expect(byeImpact(P('RB', 9), round3, cfg)).toBeNull();
  });

  it('only ever reports byeCost of 2 or more', () => {
    for (const week of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      const impact = byeImpact(P('WR', week), spread, cfg);
      if (impact) expect(impact.byeCost).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('byeDistribution', () => {
  it('counts players per bye week', () => {
    expect(byeDistribution([P('RB', 6), P('WR', 6), P('TE', 9)])).toEqual({ 6: 2, 9: 1 });
  });

  it('skips missing bye data rather than bucketing it at 0', () => {
    expect(byeDistribution([P('RB', null), P('WR', 6)])).toEqual({ 6: 1 });
  });
});
