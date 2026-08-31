// Live Sleeper integration. Polls /draft/{id}/picks every N seconds and
// rewrites DraftState's picks from the canonical server response. Also
// surfaces draft metadata (status, current pick, draft_order) so the UI
// can show "waiting for draft" / "in progress" / "complete".

import { fetchLeague, fetchLeagueDrafts, fetchDraft, fetchDraftPicks } from './sleeper.js';

// Picks change constantly during a draft; metadata (status, order) changes a
// handful of times in three hours. Fetching both every tick doubled the
// request rate for nothing, so meta refreshes on a pick change, on a slow
// cycle, and never in between — which is what buys the faster pick polling.
// Matches the cadence the terminal watcher settled on.
const POLL_DRAFTING_MS = 4_000;
const POLL_IDLE_MS = 30_000; // pre_draft / complete: poll less aggressively
const META_EVERY_POLLS = 4;

export class SleeperLive {
  /**
   * @param {string|null} leagueId - null when attaching straight to a draft
   * @param {DraftState} state - mutated in place from server picks
   * @param {() => void} onUpdate - called after each successful poll
   * @param {{draftId?: string}} [opts] - attach directly to a draft id
   */
  constructor(leagueId, state, onUpdate, opts = {}) {
    this.leagueId = leagueId;
    this.state = state;
    this.onUpdate = onUpdate;
    /**
     * Direct draft attachment, bypassing the league lookup.
     *
     * Mock drafts are not attached to a league — they have a draft_id and
     * `league_id: null` — so resolving league → drafts[0] finds nothing and
     * live mode dies before it polls anything. That makes the one realistic
     * rehearsal for draft day impossible to run, which is backwards.
     *
     * It also doubles as the draft-day escape hatch: if league→draft
     * resolution ever misbehaves, the draft id straight off the room URL is a
     * path that cannot break.
     * @type {string|null}
     */
    this.draftId = opts.draftId ?? null;
    /** @type {object|null} */
    this.league = null;
    /** @type {object|null} */
    this.draft = null;
    /** @type {string|null} */
    this.lastError = null;
    this.timer = null;
    this.lastPollAt = null;
  }

  async init() {
    if (!this.draftId) {
      if (!this.leagueId) throw new Error('need either a league id or a draft id');
      this.league = await fetchLeague(this.leagueId);
      const drafts = await fetchLeagueDrafts(this.leagueId);
      if (!drafts.length) throw new Error('no drafts found for league');
      this.draftId = drafts[0].draft_id;
    }

    this.draft = await fetchDraft(this.draftId);
    if (!this.draft) throw new Error(`draft ${this.draftId} not found`);

    // A mock has no league to name, so fall back to something the UI can show
    // rather than rendering "undefined" in the status bar.
    if (!this.league) {
      this.league = { name: this.draft.metadata?.name || `mock draft ${this.draftId}` };
    }

    // Teams/rounds come from the draft, not league.json. A mock is frequently a
    // different size than the real league, and silently scoring a 10-team mock
    // against 12-team replacement levels would make every recommendation subtly
    // wrong in a way that looks fine.
    const teams = this.draft.settings?.teams;
    const rounds = this.draft.settings?.rounds;
    if (teams && teams !== this.state.teams) {
      this.sizeMismatch = `draft has ${teams} teams, league.json says ${this.state.teams}`;
    }
    if (rounds && rounds !== this.state.totalRounds) {
      this.roundsMismatch = `draft has ${rounds} rounds, league.json says ${this.state.totalRounds}`;
    }

    // The live draft is the authority on shape, so it OVERRIDES state — the
    // warnings above stay, because VBD replacement levels are still tuned for
    // the league shape. DraftState derives totalPicks in the constructor;
    // setting teams/rounds and leaving totalPicks stale silently breaks
    // isMyTurn and isComplete near the end, so all three move together.
    if (teams) this.state.teams = teams;
    if (rounds) this.state.totalRounds = rounds;
    this.state.totalPicks = this.state.teams * this.state.totalRounds;

    // Which seat am I? The draft order is the authority when it knows me —
    // Sleeper commissioners can reshuffle draft_order right up until the
    // draft starts, and a stale league.json slot silently aims every
    // projection at somebody else's turn.
    const myId = this.state.cfg.my_sleeper_user_id;
    const orderedSlot = myId ? this.draft.draft_order?.[myId] : null;
    if (orderedSlot) this.state.mySlot = orderedSlot;

    await this.poll();
  }

  start() {
    this.stop();
    const tick = async () => {
      await this.poll();
      const interval = this.draft?.status === 'drafting' ? POLL_DRAFTING_MS : POLL_IDLE_MS;
      this.timer = setTimeout(tick, interval);
    };
    tick();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async poll() {
    try {
      const picks = await fetchDraftPicks(this.draftId);
      const pickCount = picks.filter((p) => p.player_id).length;
      const changed = pickCount !== this.lastPickCount;

      // Refresh draft meta on a pick change or a slow cycle, so we still see
      // status transitions (pre_draft → drafting → complete) without paying
      // for metadata on every tick.
      this.pollCount = (this.pollCount ?? 0) + 1;
      if (changed || this.pollCount % META_EVERY_POLLS === 1) {
        this.draft = await fetchDraft(this.draftId);
      }

      this.applyPicks(picks);
      this.lastPickCount = pickCount;
      this.lastError = null;
      this.lastPollAt = new Date();
    } catch (err) {
      this.lastError = err.message;
    }
    this.onUpdate?.();
  }

  /**
   * Replace state.picks/taken from a server response. Idempotent — if no
   * change, nothing visible to the user.
   */
  applyPicks(serverPicks) {
    const sorted = [...serverPicks].sort((a, b) => a.pick_no - b.pick_no);
    const next = [];
    const taken = new Set();
    for (const sp of sorted) {
      if (!sp.player_id) continue;
      if (!this.state.players[sp.player_id]) continue; // unknown player — skip rather than crash
      next.push({
        pick: sp.pick_no,
        slot: sp.draft_slot,
        playerId: sp.player_id,
      });
      taken.add(sp.player_id);
    }
    this.state.picks = next;
    this.state.taken = taken;
  }

  /** Snapshot for the UI. */
  status() {
    return {
      leagueName: this.league?.name,
      draftStatus: this.draft?.status, // 'pre_draft' | 'drafting' | 'paused' | 'complete'
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      orderSet: this.draft?.draft_order && Object.keys(this.draft.draft_order).length > 0,
      draftId: this.draftId,
      isMock: !this.leagueId,
      // Surfaced so a mock of the wrong shape can't quietly produce
      // confident-looking nonsense.
      sizeMismatch: this.sizeMismatch ?? null,
      roundsMismatch: this.roundsMismatch ?? null,
    };
  }
}
