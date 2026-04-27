// Thin wrapper around the Sleeper public API. No auth.
// Spec: https://docs.sleeper.com/

const BASE = 'https://api.sleeper.app/v1';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path} → HTTP ${res.status}`);
  return res.json();
}

export const fetchNflState = () => get('/state/nfl');
export const fetchPlayers = () => get('/players/nfl');
export const fetchLeague = (id) => get(`/league/${id}`);
export const fetchLeagueDrafts = (id) => get(`/league/${id}/drafts`);
export const fetchDraft = (id) => get(`/draft/${id}`);
export const fetchDraftPicks = (id) => get(`/draft/${id}/picks`);
