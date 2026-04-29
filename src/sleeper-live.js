// Live Sleeper integration. Polls /draft/{id}/picks every N seconds and
// rewrites DraftState's picks from the canonical server response. Also
// surfaces draft metadata (status, current pick, draft_order) so the UI
// can show "waiting for draft" / "in progress" / "complete".

import { fetchLeague, fetchLeagueDrafts, fetchDraft, fetchDraftPicks } from './sleeper.js';

const POLL_DRAFTING_MS = 10_000;
const POLL_IDLE_MS = 30_000; // pre_draft / complete: poll less aggressively

export class SleeperLive {
  /**
   * @param {string} leagueId
   * @param {DraftState} state - mutated in place from server picks
   * @param {() => void} onUpdate - called after each successful poll
   */
  constructor(leagueId, state, onUpdate) {
    this.leagueId = leagueId;
    this.state = state;
    this.onUpdate = onUpdate;
    /** @type {string|null} */
    this.draftId = null;
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
    this.league = await fetchLeague(this.leagueId);
    const drafts = await fetchLeagueDrafts(this.leagueId);
    if (!drafts.length) throw new Error('no drafts found for league');
    this.draftId = drafts[0].draft_id;
    this.draft = await fetchDraft(this.draftId);
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
      // Refresh draft meta so we see status transitions (pre_draft → drafting → complete).
      this.draft = await fetchDraft(this.draftId);
      const picks = await fetchDraftPicks(this.draftId);
      this.applyPicks(picks);
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
        playerId: sp.player_id
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
      orderSet: this.draft?.draft_order && Object.keys(this.draft.draft_order).length > 0
    };
  }
}
