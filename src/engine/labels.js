export function posLabel(pos) {
  return { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', DEF: 'D/ST' }[pos] || pos;
}
