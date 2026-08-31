import { describe, expect, it } from 'vitest';
import { analyzeBackfields, backfieldLabel, isVolatilityFlag } from './backfield.js';

const players = {
  gibbs: { team: 'DET' },
  pacheco: { team: 'DET' },
  jones: { team: 'MIN' },
  mason: { team: 'MIN' },
  henry: { team: 'BAL' },
  chase: { team: 'CIN', position: 'WR' },
  harvey: { team: 'DEN' },
  dobbins: { team: 'DEN' },
  coleman: { team: 'DEN' },
  noTeam: {},
};

const ranked = {
  // Bell cow: 160 spots clear of his backup.
  gibbs: { name: 'Jahmyr Gibbs', position: 'RB', ecr: 3 },
  pacheco: { name: 'Isiah Pacheco', position: 'RB', ecr: 163 },
  // Committee: the market cannot separate them.
  jones: { name: 'Aaron Jones', position: 'RB', ecr: 114 },
  mason: { name: 'Jordan Mason', position: 'RB', ecr: 118 },
  // Sole ranked back on his roster.
  henry: { name: 'Derrick Henry', position: 'RB', ecr: 20 },
  // Not a running back — must be ignored entirely.
  chase: { name: "Ja'Marr Chase", position: 'WR', ecr: 1 },
  // Three-deep committee.
  harvey: { name: 'RJ Harvey', position: 'RB', ecr: 96 },
  dobbins: { name: 'J.K. Dobbins', position: 'RB', ecr: 100 },
  coleman: { name: 'Jonah Coleman', position: 'RB', ecr: 157 },
  // No team — cannot be placed in a backfield.
  noTeam: { name: 'Free Agent', position: 'RB', ecr: 200 },
};

const bf = analyzeBackfields(players, ranked);

describe('analyzeBackfields', () => {
  it('calls a back with no ranked competition the sole back', () => {
    expect(bf.get('henry').role).toBe('sole');
    expect(bf.get('henry').rankedBacks).toBe(1);
  });

  it('separates a bell cow from his handcuff', () => {
    expect(bf.get('gibbs').role).toBe('bellcow');
    expect(bf.get('pacheco').role).toBe('handcuff');
    expect(bf.get('gibbs').gap).toBe(160);
  });

  it('flags a genuine committee when the market cannot separate them', () => {
    expect(bf.get('jones').role).toBe('committee');
    expect(bf.get('mason').role).toBe('committee');
    expect(bf.get('jones').gap).toBe(4);
  });

  it('uses the RB1-RB2 gap even when a third back is far behind', () => {
    // DEN: 96 / 100 / 157. The committee is decided by the top two; the third
    // back trailing badly must not rescue the pair into looking separated.
    expect(bf.get('harvey').role).toBe('committee');
    expect(bf.get('dobbins').role).toBe('committee');
    expect(bf.get('harvey').rankedBacks).toBe(3);
  });

  it('records who a back is sharing with, ordered by rank', () => {
    expect(bf.get('jones').teammates).toEqual(['Jordan Mason']);
    expect(bf.get('harvey').teammates).toEqual(['J.K. Dobbins', 'Jonah Coleman']);
  });

  it('ignores non-running-backs', () => {
    expect(bf.has('chase')).toBe(false);
  });

  it('ignores players with no team rather than inventing a backfield', () => {
    expect(bf.has('noTeam')).toBe(false);
  });

  it('assigns depth in consensus order', () => {
    expect(bf.get('gibbs').depth).toBe(1);
    expect(bf.get('pacheco').depth).toBe(2);
    expect(bf.get('coleman').depth).toBe(3);
  });

  it('survives missing rankings without throwing', () => {
    expect(analyzeBackfields(players, null).size).toBe(0);
    expect(analyzeBackfields(players, {}).size).toBe(0);
  });
});

describe('backfieldLabel', () => {
  it('names the teammates you are splitting with', () => {
    expect(backfieldLabel(bf.get('jones'))).toBe('COMMITTEE w/ Jordan Mason');
  });

  it('avoids commas so the label survives a CSV cell unquoted', () => {
    expect(backfieldLabel(bf.get('harvey'))).not.toContain(',');
    expect(backfieldLabel(bf.get('harvey'))).toBe('COMMITTEE w/ J.K. Dobbins + Jonah Coleman');
  });

  it('is terse for the unambiguous cases', () => {
    expect(backfieldLabel(bf.get('henry'))).toBe('sole RB');
    expect(backfieldLabel(bf.get('gibbs'))).toBe('bellcow');
  });

  it('returns empty for an unknown player rather than a misleading label', () => {
    expect(backfieldLabel(undefined)).toBe('');
  });
});

describe('isVolatilityFlag', () => {
  it('flags shared backfields, not clear starters', () => {
    expect(isVolatilityFlag(bf.get('jones'))).toBe(true);
    expect(isVolatilityFlag(bf.get('gibbs'))).toBe(false);
    expect(isVolatilityFlag(bf.get('henry'))).toBe(false);
  });
});
