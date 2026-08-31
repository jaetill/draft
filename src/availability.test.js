import { describe, expect, it } from 'vitest';
import { availabilityOf, isHardOut, lateArrivals } from './availability.js';

describe('availabilityOf', () => {
  it('treats a roster designation as a real absence', () => {
    const a = availabilityOf({ status: 'PUP' });
    expect(a.level).toBe('out');
    expect(a.label).toContain('PUP');
    expect(a.weeksLikelyMissed).toBe(4);
  });

  it('names a suspension distinctly from an injury', () => {
    const a = availabilityOf({ status: 'Sus' });
    expect(a.label).toBe('SUSPENDED');
    expect(a.reason).toBe('suspension');
  });

  it('does NOT treat preseason Questionable as a risk signal', () => {
    // Ja'Marr Chase carries this tag while holding the tightest expert spread
    // in the pool. Flagging him as a risk would be worse than saying nothing.
    const a = availabilityOf({ injury_status: 'Questionable' });
    expect(a.level).toBe('watch');
    expect(a.weeksLikelyMissed).toBe(0);
    expect(isHardOut({ injury_status: 'Questionable' })).toBe(false);
  });

  it('still respects a hard game-day tag', () => {
    expect(isHardOut({ injury_status: 'Out' })).toBe(true);
    expect(isHardOut({ injury_status: 'Doubtful' })).toBe(true);
  });

  it('prefers roster status over the weekly tag when both are present', () => {
    // A player on IR who also carries a stale "Questionable" must read as OUT.
    const a = availabilityOf({ status: 'IR', injury_status: 'Questionable' });
    expect(a.level).toBe('out');
    expect(a.reason).toBe('roster designation');
  });

  it('returns null when nothing is known rather than implying health', () => {
    expect(availabilityOf({})).toBeNull();
    expect(availabilityOf(null)).toBeNull();
  });

  it('carries the body part through when Sleeper provides it', () => {
    expect(availabilityOf({ status: 'IR', injury_body_part: 'Achilles' }).bodyPart).toBe(
      'Achilles',
    );
  });
});

describe('lateArrivals', () => {
  const players = {
    a: { status: 'PUP' },
    b: { status: 'Sus' },
    c: { injury_status: 'Questionable' },
    d: {},
    deep: { status: 'IR' },
  };
  const ranked = {
    a: { name: 'PUP Guy', position: 'RB', ecr: 90, stdev: 20, best: 50 },
    b: { name: 'Suspended Guy', position: 'WR', ecr: 60, stdev: 25, best: 30 },
    c: { name: 'Questionable Guy', position: 'WR', ecr: 40, stdev: 5, best: 35 },
    d: { name: 'Healthy Guy', position: 'RB', ecr: 20, stdev: 4, best: 15 },
    deep: { name: 'Deep IR Guy', position: 'TE', ecr: 400, stdev: 40, best: 300 },
  };

  it('returns only real absences, ordered by cost', () => {
    const out = lateArrivals(players, ranked);
    expect(out.map((x) => x.name)).toEqual(['Suspended Guy', 'PUP Guy']);
  });

  it('excludes preseason Questionable entirely', () => {
    expect(lateArrivals(players, ranked).some((x) => x.name === 'Questionable Guy')).toBe(false);
  });

  it('ignores players outside the draftable range', () => {
    expect(lateArrivals(players, ranked, 250).some((x) => x.name === 'Deep IR Guy')).toBe(false);
    expect(lateArrivals(players, ranked, 500).some((x) => x.name === 'Deep IR Guy')).toBe(true);
  });

  it('survives missing rankings', () => {
    expect(lateArrivals(players, null)).toEqual([]);
  });
});
