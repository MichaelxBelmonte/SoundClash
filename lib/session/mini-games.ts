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
  // Real-song stem game (needs LALAL_API_KEY + host-uploaded audio prepared in
  // the Stem Lab; reuses song_mash.png). Only playable once >=4 stems are ready.
  { id: "stem_heist", name: "Stem Heist", blurb: "Name the track from one isolated stem.", example: "guess the song from just the bass", category: "trivia", image: "/games/song_mash.png" },
  // Voice Clash (needs ELEVENLABS_API_KEY; host clones their voice in the Voice
  // Studio, the app bakes a track, the crowd rates it; reuses artist_pick.png).
  { id: "voice_clash", name: "Voice Clash", blurb: "The host's cloned voice drops a track — rate it.", example: "rate the host's AI track", category: "trivia", image: "/games/artist_pick.png" },
  // Studio Session (needs ELEVENLABS_API_KEY; each player records a line in the
  // lobby Studio booth → STT → the AI sings it over a beat → the crowd rates every
  // track). No image yet → falls back to the built-in SVG line-art.
  { id: "studio_session", name: "Studio Session", blurb: "Record a line — the AI sings it, the crowd rates it.", example: "tap mic ~10s → hear your AI track", category: "trivia" },
];

// Façade-only entries shown in the host gallery as "Coming soon". They are NOT
// MiniGameId values and never enter the rotation — purely for the demo/pitch feel.
export interface ComingSoonGame {
  id: string;
  name: string;
  blurb: string;
}

export const COMING_SOON_GAMES: ComingSoonGame[] = [
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

// ---- Content source: what each game needs to be playable -------------------
// The single source of truth for the setup flow. A game's content source decides
// whether the host must pick Musixmatch tracks ("lyrics"), needs nothing because
// the audio is generated from scratch ("generated"), or must prepare host-supplied
// audio in the lobby ("host-audio"). Drives the conditional Music step and the
// no-silent-fallback start gate. Exhaustive over MiniGameId on purpose.
export type GameContentSource = "lyrics" | "generated" | "host-audio" | "host-voice" | "player-voice";

export const GAME_CONTENT_SOURCE: Record<MiniGameId, GameContentSource> = {
  finish_line: "lyrics",
  mondegreen: "lyrics",
  next_line: "lyrics",
  the_drop: "lyrics",
  on_beat: "lyrics",
  name_song: "lyrics",
  song_mash: "lyrics",
  artist_pick: "lyrics",
  word_rush: "lyrics",
  genre_roulette: "generated",
  beat_lock: "generated",
  stem_heist: "host-audio",
  voice_clash: "host-voice",
  studio_session: "player-voice",
};

// Minimum host-prepared stems before Stem Heist can run (need real decoys).
export const STEM_HEIST_MIN = 4;
// Minimum baked tracks before Voice Clash can run.
export const VOICE_CLASH_MIN = 1;
// Minimum ready player tracks before Studio Session can run.
export const STUDIO_SESSION_MIN = 1;

export function contentSourceFor(game: MiniGameId): GameContentSource {
  return GAME_CONTENT_SOURCE[game];
}
export function needsLyricsDeck(games: readonly MiniGameId[]): boolean {
  return games.some((id) => GAME_CONTENT_SOURCE[id] === "lyrics");
}
export function needsHostAudio(games: readonly MiniGameId[]): boolean {
  return games.some((id) => GAME_CONTENT_SOURCE[id] === "host-audio");
}
export function needsHostVoice(games: readonly MiniGameId[]): boolean {
  return games.some((id) => GAME_CONTENT_SOURCE[id] === "host-voice");
}
export function needsPlayerVoice(games: readonly MiniGameId[]): boolean {
  return games.some((id) => GAME_CONTENT_SOURCE[id] === "player-voice");
}
// True when the rotation can start with NO Musixmatch deck and NO host upload —
// i.e. every selected game generates its own audio. Lets us skip the Music step.
export function onlyGenerated(games: readonly MiniGameId[]): boolean {
  return games.length > 0 && games.every((id) => GAME_CONTENT_SOURCE[id] === "generated");
}

// ---- Readiness: which selected games can't start yet, and why ---------------
export interface ReadinessContext {
  /** Musixmatch tracks the host has added. */
  deckCount: number;
  /** Host-prepared isolated stems ready for Stem Heist. */
  preparedStems: number;
  /** Baked Voice Clash tracks ready (host voice over a beat). */
  voiceTracks: number;
  /** Whether the host's voice clone exists yet. */
  voiceCloned: boolean;
  /** Player recordings already generated into ready Studio Session tracks. */
  studioTracksReady: number;
  /** ELEVENLABS_API_KEY present server-side (generated audio possible). */
  audioGen: boolean;
  /** LALAL_API_KEY present server-side (stem separation possible). */
  stemSeparation: boolean;
}

export interface GameBlocker {
  game: MiniGameId;
  source: GameContentSource;
  reason: string;
}

// Returns one blocker per selected game whose content source isn't ready. Empty
// array means the show can start. This is the gate that REPLACES silent fallback:
// a selected game that isn't ready blocks Start (with a reason) — it is never
// swapped for another game behind the host's back.
export function gameBlockers(games: readonly MiniGameId[], ctx: ReadinessContext): GameBlocker[] {
  const blockers: GameBlocker[] = [];
  for (const game of games) {
    const source = GAME_CONTENT_SOURCE[game];
    if (source === "lyrics") {
      if (ctx.deckCount < 1) blockers.push({ game, source, reason: "Add at least one track in Music" });
    } else if (source === "generated") {
      if (!ctx.audioGen) blockers.push({ game, source, reason: "Audio generation off — set ELEVENLABS_API_KEY" });
    } else if (source === "host-audio") {
      if (!ctx.stemSeparation) {
        blockers.push({ game, source, reason: "Stem separation off — set LALAL_API_KEY" });
      } else if (ctx.preparedStems < STEM_HEIST_MIN) {
        const left = STEM_HEIST_MIN - ctx.preparedStems;
        blockers.push({ game, source, reason: `Upload ${left} more track${left === 1 ? "" : "s"} in Stem Lab` });
      }
    } else if (source === "host-voice") {
      if (!ctx.audioGen) {
        blockers.push({ game, source, reason: "Voice generation off — set ELEVENLABS_API_KEY" });
      } else if (!ctx.voiceCloned) {
        blockers.push({ game, source, reason: "Clone your voice in the Voice Studio" });
      } else if (ctx.voiceTracks < VOICE_CLASH_MIN) {
        blockers.push({ game, source, reason: "Bake a track in the Voice Studio" });
      }
    } else if (source === "player-voice") {
      if (!ctx.audioGen) {
        blockers.push({ game, source, reason: "Audio generation off — set ELEVENLABS_API_KEY" });
      } else if (ctx.studioTracksReady < STUDIO_SESSION_MIN) {
        blockers.push({ game, source, reason: "Players need to record in the Studio booth" });
      }
    }
  }
  return blockers;
}
