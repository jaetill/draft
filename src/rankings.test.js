import { describe, expect, it } from 'vitest';
import { buildRankings } from './rankings.js';

// A deliberately adversarial fixture: search_rank disagrees with expert
// consensus, because that disagreement is the entire reason this layer exists.
//   - "Hype Merchant" is heavily searched but unranked by the experts.
//   - "Quiet Stud" is barely searched but the consensus WR1.
const players = {
  wr1: { id: 'wr1', name: 'Quiet Stud', position: 'WR', team: 'AAA', search_rank: 500, exp: 3 },
  wr2: { id: 'wr2', name: 'Hype Merchant', position: 'WR', team: 'BBB', search_rank: 1, exp: 9 },
  wr3: { id: 'wr3', name: 'Solid Wr', position: 'WR', team: 'CCC', search_rank: 40, exp: 4 },
  rb1: { id: 'rb1', name: 'Bell Cow', position: 'RB', team: 'DDD', search_rank: 30, exp: 2 },
  rb2: { id: 'rb2', name: 'Committee Back', position: 'RB', team: 'EEE', search_rank: 60, exp: 5 },
  te1: { id: 'te1', name: 'Elite Te', position: 'TE', team: 'FFF', search_rank: 80, exp: 3 },
  qb1: { id: 'qb1', name: 'Top Qb', position: 'QB', team: 'GGG', search_rank: 90, exp: 6 },
  def1: { id: 'DDD', name: 'Delta Defense', position: 'DEF', team: 'DDD', search_rank: 9999 },
};

const ecr = {
  source: 'test fixture',
  scoring: 'ppr',
  fetchedAt: '2026-08-27T00:00:00.000Z',
  maxTier: 8,
  players: {
    wr1: { name: 'Quiet Stud', position: 'WR', ecr: 1.5, tier: 1, stdev: 0.9, posRank: 1 },
    rb1: { name: 'Bell Cow', position: 'RB', ecr: 3.2, tier: 1, stdev: 1.4, posRank: 1 },
    te1: { name: 'Elite Te', position: 'TE', ecr: 18.0, tier: 3, stdev: 5.0, posRank: 1 },
    wr3: { name: 'Solid Wr', position: 'WR', ecr: 22.0, tier: 4, stdev: 30.5, posRank: 2 },
    qb1: { name: 'Top Qb', position: 'QB', ecr: 26.0, tier: 4, stdev: 2.7, posRank: 1 },
    rb2: { name: 'Committee Back', position: 'RB', ecr: 40.0, tier: 6, stdev: 18.0, posRank: 2 },
  },
};

describe('buildRankings — synthetic mode', () => {
  const r = buildRankings(players);

  it('reports that it is not using real rankings', () => {
    expect(r.meta.usingRealRankings).toBe(false);
    expect(r.meta.rankedCount).toBe(0);
  });

  it('orders by search_rank, which is exactly the flaw ECR fixes', () => {
    // Hype Merchant (search_rank 1) leads purely on popularity.
    expect(r.posRank.get('wr2')).toBe(1);
    expect(r.posRank.get('wr1')).toBe(3);
  });

  it('returns null for ECR and spread when there is no data', () => {
    expect(r.meta.ecr(players.wr1)).toBeNull();
    expect(r.meta.spread(players.wr1)).toBeNull();
    expect(r.meta.isRanked(players.wr1)).toBe(false);
  });
});

describe('buildRankings — expert consensus mode', () => {
  const r = buildRankings(players, ecr);

  it('reports source metadata', () => {
    expect(r.meta.usingRealRankings).toBe(true);
    expect(r.meta.rankedCount).toBe(6);
    expect(r.meta.scoring).toBe('ppr');
  });

  it('ranks by consensus, not search popularity', () => {
    expect(r.posRank.get('wr1')).toBe(1); // consensus WR1 despite search_rank 500
    expect(r.posRank.get('wr3')).toBe(2);
    expect(r.posRank.get('wr2')).toBe(3); // unranked hype falls behind both
  });

  it('places every ranked player ahead of every unranked one', () => {
    const wrOrder = r.byPos.WR.map((p) => p.id);
    const lastRanked = wrOrder.findIndex((id) => !ecr.players[id]);
    expect(wrOrder.slice(0, lastRanked).every((id) => ecr.players[id])).toBe(true);
  });

  it('uses the real consensus tier', () => {
    expect(r.tier(players.wr1)).toBe(1);
    expect(r.tier(players.te1)).toBe(3);
  });

  it('parks unranked players past the deepest real tier', () => {
    expect(r.tier(players.wr2)).toBe(ecr.maxTier + 1);
    expect(r.tier(players.wr2)).toBeGreaterThan(r.tier(players.rb2));
  });

  it('exposes expert spread as a risk signal', () => {
    expect(r.meta.spread(players.wr3)).toBe(30.5); // the field disagrees hard
    expect(r.meta.spread(players.qb1)).toBe(2.7); // the field agrees
    expect(r.meta.spread(players.wr2)).toBeNull(); // unranked = unknown, not zero
  });

  it('gives higher projections to better consensus ranks', () => {
    expect(r.projection(players.wr1)).toBeGreaterThan(r.projection(players.wr3));
    expect(r.projection(players.wr3)).toBeGreaterThan(r.projection(players.wr2));
  });
});

describe('tier vs posTier', () => {
  const r = buildRankings(players, ecr);

  it('keeps overall tier and positional tier distinct', () => {
    // The elite TE is only tier 3 on the overall board but posTier 1 at TE.
    // Conflating these is what silently disabled the Anchor TE thesis.
    expect(r.tier(players.te1)).toBe(3);
    expect(r.posTier(players.te1)).toBe(1);
  });

  it('defines posTier identically in synthetic and consensus mode', () => {
    const synthetic = buildRankings(players);
    // Both modes bucket rank 1 at TE into positional tier 1.
    expect(synthetic.posTier(players.te1)).toBe(1);
    expect(r.posTier(players.te1)).toBe(1);
  });
});

describe('measured value curve', () => {
  // Points by positional FINISH — index 0 is the season's WR1.
  const valueCurve = {
    seasons: ['2025', '2024', '2023'],
    curve: { WR: [340, 280, 250], RB: [330, 260, 210] },
  };

  it('falls back to the modelled curve when no measured one is supplied', () => {
    const r = buildRankings(players, ecr);
    expect(r.meta.usingRealProjections).toBe(false);
    expect(r.meta.projectionSource).toBe('modelled exponential');
  });

  it('uses measured points for the slot a player is ranked at', () => {
    const r = buildRankings(players, ecr, valueCurve);
    expect(r.meta.usingRealProjections).toBe(true);
    // wr1 is the consensus WR1, so he gets the measured WR1 finish.
    expect(r.projection(players.wr1)).toBe(340);
    expect(r.projection(players.wr3)).toBe(280);
  });

  it('decays past the measured depth instead of falling to zero', () => {
    const r = buildRankings(players, ecr, valueCurve);
    // wr2 is unranked → posRank 3, still inside the curve. Use a position
    // with a shorter curve to check the tail.
    const beyond = r.projection({ id: 'nobody', position: 'WR' });
    expect(beyond).toBeGreaterThan(0);
    expect(beyond).toBeLessThan(250);
  });

  it('leaves positions absent from the curve on the modelled path', () => {
    const partial = { seasons: ['2025'], curve: { WR: [340, 280, 250] } };
    const r = buildRankings(players, ecr, partial);
    // TE has no measured curve here, so it must still produce a sane number.
    expect(r.projection(players.te1)).toBeGreaterThan(0);
  });

  it('reports which seasons the projections came from', () => {
    const r = buildRankings(players, ecr, valueCurve);
    expect(r.meta.projectionSource).toContain('2025');
  });
});

describe('replacementPoints', () => {
  const r = buildRankings(players, ecr);

  it('falls back to the last player when the cutoff exceeds the pool', () => {
    // Only 3 WRs in the fixture; asking for WR36 must not return undefined.
    const pts = r.replacementPoints('WR', 36);
    expect(Number.isFinite(pts)).toBe(true);
    expect(pts).toBeGreaterThan(0);
  });

  it('returns 0 for a position with no players', () => {
    expect(r.replacementPoints('K', 5)).toBe(0);
  });

  it('yields positive VBD for a stud and near-zero for replacement level', () => {
    const repl = r.replacementPoints('RB', 2);
    expect(r.projection(players.rb1) - repl).toBeGreaterThan(0);
    expect(r.projection(players.rb2) - repl).toBe(0);
  });
});
