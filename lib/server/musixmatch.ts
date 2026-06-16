// SERVER-ONLY Musixmatch client.
// Reads MXM_KEY from the environment. NEVER import this from a Client Component —
// it must only be used inside route handlers / server actions so the key stays server-side.
import type { TrackSummary } from "@/lib/types";

const BASE = "https://api.musixmatch.com/ws/1.1";

function apiKey(): string {
  const k = process.env.MXM_KEY;
  if (!k) throw new Error("MXM_KEY is not set in the environment");
  return k;
}

/** Low-level call. Returns message.body, throwing on transport or Musixmatch status errors. */
async function call(method: string, params: Record<string, string | number>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  qs.set("apikey", apiKey());

  const res = await fetch(`${BASE}/${method}?${qs.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Musixmatch HTTP ${res.status}`);

  const json = await res.json();
  const status = json?.message?.header?.status_code;
  if (status !== 200) throw new Error(`Musixmatch status_code ${status} for ${method}`);
  return json.message.body;
}

/** Search tracks by free-text query. Returns only songs that have lyrics. */
export async function searchTracks(query: string, limit = 8): Promise<TrackSummary[]> {
  // q_track_artist matches title+artist (not lyrics) and rating sort surfaces the
  // well-known version first — far better relevance for a song picker than a bare `q`.
  const body = await call("track.search", {
    q_track_artist: query,
    page_size: limit,
    s_track_rating: "desc",
    f_has_lyrics: 1,
  });
  const list: any[] = body?.track_list ?? [];
  return list.map((item) => {
    const t = item.track;
    return {
      trackId: t.track_id,
      trackName: t.track_name,
      artistName: t.artist_name,
      hasLyrics: t.has_lyrics === 1,
      hasRichsync: t.has_richsync === 1,
    } satisfies TrackSummary;
  });
}
