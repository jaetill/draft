// DraftState — single source of truth for the draft. Pure logic, no I/O.
// Used by both the live Sleeper integration and the mock harness.

export class DraftState {
  /**
   * @param {object} cfg - league config (data/league.json shape)
   * @param {object<string,object>} players - trimmed players.json keyed by id
   * @param {number} mySlot - my draft slot (1..teams)
   */
  constructor(cfg, players, mySlot) {
    this.cfg = cfg;
    this.players = players;
    this.mySlot = mySlot;
    this.teams = cfg.teams;
    this.totalRounds =
      cfg.roster.QB +
      cfg.roster.RB +
      cfg.roster.WR +
      cfg.roster.TE +
      cfg.roster.FLEX +
      cfg.roster.DEF +
      cfg.roster.BENCH;
    this.totalPicks = this.teams * this.totalRounds;

    /** @type {Array<{pick:number, slot:number, playerId:string}>} */
    this.picks = [];
    /** @type {Set<string>} */
    this.taken = new Set();
  }

  // --- Snake draft slot math ---

  /** Slot picking at the given 1-indexed pick number. */
  slotAtPick(pick) {
    const round = Math.ceil(pick / this.teams);
    const inRound = ((pick - 1) % this.teams) + 1;
    return round % 2 === 1 ? inRound : this.teams - inRound + 1;
  }

  /** All pick numbers for `slot` across the entire draft. */
  picksForSlot(slot) {
    const result = [];
    for (let r = 1; r <= this.totalRounds; r++) {
      result.push(r % 2 === 1 ? (r - 1) * this.teams + slot : r * this.teams - slot + 1);
    }
    return result;
  }

  /** 1-indexed pick number that's about to be made. */
  get currentPick() {
    return this.picks.length + 1;
  }

  get currentSlot() {
    return this.slotAtPick(this.currentPick);
  }

  get isMyTurn() {
    return this.currentSlot === this.mySlot && this.currentPick <= this.totalPicks;
  }

  get isComplete() {
    return this.picks.length >= this.totalPicks;
  }

  // --- Mutation ---

  /** Shallow clone for hypothetical simulations (lookahead engine).
   *  Shares cfg + players (immutable) but deep-copies picks/taken. */
  clone() {
    const c = new DraftState(this.cfg, this.players, this.mySlot);
    c.picks = [...this.picks];
    c.taken = new Set(this.taken);
    return c;
  }

  addPick(playerId) {
    if (this.taken.has(playerId)) throw new Error(`already taken: ${playerId}`);
    if (!this.players[playerId]) throw new Error(`unknown player: ${playerId}`);
    const pick = this.currentPick;
    this.picks.push({ pick, slot: this.slotAtPick(pick), playerId });
    this.taken.add(playerId);
    return pick;
  }

  // --- Queries ---

  /** Players not yet drafted, sorted by search_rank ascending (Sleeper's overall). */
  available() {
    const out = [];
    for (const p of Object.values(this.players)) {
      if (!this.taken.has(p.id)) out.push(p);
    }
    out.sort((a, b) => a.search_rank - b.search_rank);
    return out;
  }

  /** Just my picks. */
  myPicks() {
    return this.picks.filter((p) => p.slot === this.mySlot);
  }

  /** My roster, grouped by position. Returns counts and the player records. */
  myRoster() {
    const byPos = { QB: [], RB: [], WR: [], TE: [], DEF: [] };
    for (const pick of this.myPicks()) {
      const p = this.players[pick.playerId];
      if (byPos[p.position]) byPos[p.position].push(p);
    }
    return byPos;
  }

  /**
   * What positions do I still need? Returns starter shortfalls plus flex/bench room.
   * Does NOT slot players into specific roster spots — just tracks counts.
   */
  myNeeds() {
    const r = this.cfg.roster;
    const roster = this.myRoster();
    const have = {
      QB: roster.QB.length,
      RB: roster.RB.length,
      WR: roster.WR.length,
      TE: roster.TE.length,
      DEF: roster.DEF.length
    };
    const totalSlots = r.QB + r.RB + r.WR + r.TE + r.FLEX + r.DEF + r.BENCH;
    const filled = have.QB + have.RB + have.WR + have.TE + have.DEF;

    // How many more of each position we *must* still draft as starters.
    const starterShortfall = {
      QB: Math.max(0, r.QB - have.QB),
      RB: Math.max(0, r.RB - have.RB),
      WR: Math.max(0, r.WR - have.WR),
      TE: Math.max(0, r.TE - have.TE),
      DEF: Math.max(0, r.DEF - have.DEF)
    };

    // Flex slots we haven't covered yet (FLEX absorbs surplus RB/WR/TE).
    const flexEligible = this.cfg.flex_eligible; // ['RB','WR','TE']
    const flexSurplus = flexEligible.reduce(
      (sum, pos) => sum + Math.max(0, have[pos] - r[pos]),
      0
    );
    const flexShortfall = Math.max(0, r.FLEX - flexSurplus);

    return {
      have,
      starterShortfall,
      flexShortfall,
      benchRoom: totalSlots - filled,
      filled,
      totalSlots
    };
  }
}
