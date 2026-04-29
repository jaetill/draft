// Owner archetype model. Loaded from public/data/owner-profiles.json
// (built by scripts/build-owner-profiles.mjs from Sleeper history).
//
// Archetype-keyed bias adjusts an opponent's BPA-style pick toward what
// historical pattern suggests they'll grab.

export const ARCHETYPE_LABELS = {
  AnchorTE: 'Anchor TE',
  EarlyQB: 'Early QB',
  HeroRB: 'Hero RB',
  ZeroRB: 'Zero RB',
  RobustRB: 'Robust RB'
};

/**
 * Multiplier for an opponent's score on a candidate player, given their
 * archetype and the current draft round. Returns 1.0 if archetype is
 * unknown or the situation doesn't match.
 */
export function opponentBias(archetype, player, round) {
  switch (archetype) {
    case 'AnchorTE':
      if (player.position === 'TE' && round <= 2) return 1.6;
      return 1.0;
    case 'EarlyQB':
      if (player.position === 'QB' && round <= 3) return 1.5;
      if (player.position === 'QB' && round >= 8) return 0.7;
      return 1.0;
    case 'HeroRB':
      if (player.position === 'RB' && round === 1) return 1.4;
      if (player.position === 'RB' && round >= 2 && round <= 5) return 0.5;
      return 1.0;
    case 'ZeroRB':
      if (player.position === 'RB' && round <= 5) return 0.3;
      if (player.position === 'RB' && round >= 7) return 1.2;
      return 1.0;
    case 'RobustRB':
      if (player.position === 'RB' && round <= 3) return 1.4;
      return 1.0;
    default:
      return 1.0;
  }
}

/** Primary archetype tag for an owner — the first one in the sorted list, or null. */
export function primaryArchetype(profile) {
  return profile?.archetypes?.[0] || null;
}

/**
 * Look up an owner profile by slot. Returns { name, archetypes, primary } or null.
 * Uses the slot→owner map from the most recent completed season.
 */
export function profileForSlot(profiles, slot) {
  if (!profiles?.slotToOwner) return null;
  const name = profiles.slotToOwner[String(slot)];
  if (!name) return null;
  const owner = profiles.owners?.[name];
  if (!owner) return { name, archetypes: [], primary: null };
  return {
    name,
    archetypes: owner.archetypes || [],
    primary: primaryArchetype(owner),
    seasons: owner.seasons || [],
    confidence: owner.confidence || {}
  };
}

/**
 * Does the given archetype likely chase this position at this round? Used for
 * anticipation reasoning ("NuttySequel might grab a TE before your next pick").
 */
export function archetypeTargets(archetype, position, round) {
  switch (archetype) {
    case 'AnchorTE':
      return position === 'TE' && round <= 2;
    case 'EarlyQB':
      return position === 'QB' && round <= 3;
    case 'HeroRB':
      return position === 'RB' && round === 1;
    case 'RobustRB':
      return position === 'RB' && round <= 3;
    case 'ZeroRB':
      return position === 'RB' && round >= 7 && round <= 10; // late RB chase
    default:
      return false;
  }
}

/**
 * Predict which positions the next N opponent picks are most likely to favor
 * based on archetypes. Used for reasoning text on user's recommendations
 * ("NuttySequel up next, Anchor-TE: likely TE before your turn").
 */
export function anticipateUpcoming(state, profiles, n = 5) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const pick = state.currentPick + i;
    if (pick > state.totalPicks) break;
    const slot = state.slotAtPick(pick);
    if (slot === state.mySlot) break; // stop at the user's next pick
    const profile = profileForSlot(profiles, slot);
    out.push({
      pick,
      slot,
      round: Math.ceil(pick / state.teams),
      profile
    });
  }
  return out;
}
