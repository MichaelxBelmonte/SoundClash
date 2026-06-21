import type { MiniGameId } from "@/lib/session/types";

// Each game belongs to one category, which drives its card accent + line-art.
export type MiniGameCategory = "lyrics" | "trivia" | "timing";

export interface MiniGameMeta {
  id: MiniGameId;
  name: string;
  blurb: string;
  /** One-line in-card example that shows the mechanic at a glance. */
  example: string;
  category: MiniGameCategory;
  /**
   * Optional raster art for the host picker card. When set, the card shows this
   * image instead of the built-in SVG line-art. Drop a PNG in public/games/ and
   * point here (e.g. "/games/finish_line.png") — no other change needed.
   */
  image?: string;
}

/** Category → display label + brand accent tone, used by the host picker cards. */
export const CATEGORY_META: Record<
  MiniGameCategory,
  { label: string; tagline: string; tone: "magenta" | "aqua" | "tangerine" }
> = {
  lyrics: { label: "Lyrics", tagline: "Know the words?", tone: "magenta" },
  trivia: { label: "Trivia", tagline: "Know the tracks?", tone: "aqua" },
  timing: { label: "Timing", tagline: "Got rhythm?", tone: "tangerine" },
};

// Categories in display order for the grouped picker.
export const MINI_GAME_CATEGORIES: MiniGameCategory[] = ["lyrics", "trivia", "timing"];

// Canonical catalog: single source of truth for rotation order AND the host
// picker labels. Order here is the order the autopilot cycles through.
// Phase 0 roster: the three lyrics games that run reliably on ANY track (no
// richsync, no >=4-track deck) and cover three distinct skills — recall, fake-
// spotting, sequence. The other six were cut (richsync-fragile / deck-dependent /
// overlapping / weak); their PNGs in public/games/ are reserved for the upcoming
// generation-based audio games (Genre Roulette -> the_drop.png, Beat Lock ->
// on_beat.png, Stem Heist -> song_mash.png). MiniGameId keeps the old values so
// MiniGameArt + the builders stay valid; they simply never enter rotation now.
export const MINI_GAME_CATALOG: MiniGameMeta[] = [
  { id: "finish_line", name: "Finish the Line", blurb: "Tap the missing last word.", example: "“…and I will always love ___”", category: "lyrics", image: "/games/finish_line.png" },
  { id: "mondegreen", name: "Misheard", blurb: "Spot the real lyric among the mondegreens.", example: "“Hold me closer, Tony Danza” — real or misheard?", category: "lyrics", image: "/games/mondegreen.png" },
  { id: "next_line", name: "Next Line", blurb: "Pick the line that comes next.", example: "pick the line that comes next", category: "lyrics", image: "/games/next_line.png" },
  // Generated-audio games (need ELEVENLABS_API_KEY; reuse cut games' art).
  { id: "genre_roulette", name: "Genre Roulette", blurb: "Name the vibe of the beat.", example: "what genre is this beat?", category: "trivia", image: "/games/the_drop.png" },
  { id: "beat_lock", name: "Beat Lock", blurb: "Tap on the beat — timing scores.", example: "tap on every beat", category: "timing", image: "/games/on_beat.png" },
];

// Façade-only entries shown in the host gallery as "Coming soon". They are NOT
// MiniGameId values and never enter the rotation — purely for the demo/pitch feel.
export interface ComingSoonGame {
  id: string;
  name: string;
  blurb: string;
}

export const COMING_SOON_GAMES: ComingSoonGame[] = [
  { id: "stem_heist", name: "Stem Heist", blurb: "Guess the song from one isolated stem." },
  { id: "beat_roulette", name: "Beat Roulette", blurb: "BEATBOT spins up a fresh beat to play on." },
  { id: "karaoke_clash", name: "Karaoke Clash", blurb: "Sing the line — pitch & timing scored." },
  { id: "rap_battle", name: "Rap Battle", blurb: "Fill the bar before the beat drops." },
];

export const ALL_MINI_GAME_IDS: MiniGameId[] = MINI_GAME_CATALOG.map((meta) => meta.id);

const KNOWN_IDS = new Set<string>(ALL_MINI_GAME_IDS);

// Validate + de-duplicate + force canonical order, dropping anything unknown.
export function orderMiniGames(ids: readonly MiniGameId[]): MiniGameId[] {
  const wanted = new Set<string>((ids ?? []).filter((id) => KNOWN_IDS.has(id)));
  return MINI_GAME_CATALOG.filter((meta) => wanted.has(meta.id)).map((meta) => meta.id);
}
