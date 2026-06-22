import "server-only";

import { polishBars } from "@/lib/server/anthropic";
import {
  composeMusicWithLyrics,
  transcribeVoice,
  type CompositionPlan,
} from "@/lib/server/elevenlabs";
import { languageName } from "@/lib/game/languages";
import type { StudioTrackState } from "@/lib/session/types";

// Studio Session track baking: a player records ~8-10s of speech on their phone,
// we transcribe it (Scribe STT), polish it into clean bars (Claude), and have
// ElevenLabs Music (v1, composition_plan) SING it over a beat. The result is one
// fully-mixed mp3 cached in-process and served via /api/sessions/[code]/studio.
//
// Everything is volatile/in-process: a restart drops the cached audio (the TV
// then skips that track). Raw recordings are consumed by STT and never persisted
// — only the generated derivative lives here, cleared at match end (privacy).

// Pin the cache to globalThis like the session store so Next dev HMR / route
// re-evaluation doesn't wipe a track that was baked moments earlier.
const globalForStudio = globalThis as typeof globalThis & {
  __soundclashStudioAudio?: Map<string, Uint8Array>;
};
const audioCache: Map<string, Uint8Array> = globalForStudio.__soundclashStudioAudio ?? new Map();
globalForStudio.__soundclashStudioAudio = audioCache;

function cacheKey(code: string, trackId: number): string {
  return `${code}:${trackId}`;
}

// Beat vibes the host can pick → vocal-friendly composition styles. Ids mirror
// voice-studio.ts VOICE_VIBES so the picker stays consistent across games.
const STUDIO_VIBES: Record<string, { global: string[]; local: string[] }> = {
  boombap: { global: ["90s boom-bap hip-hop", "clean rap vocals", "head-nod groove"], local: ["confident rap delivery"] },
  trap: { global: ["modern trap", "punchy 808 bass", "clean rap vocals"], local: ["energetic rap delivery"] },
  drill: { global: ["uk drill", "sliding 808s", "clean rap vocals"], local: ["menacing flow"] },
  funk: { global: ["upbeat funk", "slap bass", "bright sung vocals"], local: ["playful sung delivery"] },
  lofi: { global: ["mellow lo-fi hip-hop", "warm keys", "relaxed sung vocals"], local: ["laid-back delivery"] },
  hyperpop: { global: ["energetic hyperpop", "glossy synths", "catchy sung vocals"], local: ["bright auto-tuned delivery"] },
  pop: { global: ["upbeat pop", "catchy sung vocals", "radio-ready"], local: ["energetic sung delivery"] },
};
const DEFAULT_VIBE = "boombap";
const NEGATIVE_GLOBAL = ["off-key", "muffled", "noisy"];
// One section; well within ElevenLabs' 3000–120000 ms per-section range.
const SECTION_MS = 14_000;

export const STUDIO_VIBE_IDS = Object.keys(STUDIO_VIBES);

// Build a single-section composition plan from the polished lyric, clamped to the
// API limits (max 30 lines, max 200 chars/line). `langName` (e.g. "Italian")
// nudges the model to sing in the player's language, not default English.
function planFor(lyric: string, vibe: string, langName?: string): CompositionPlan {
  const styles = STUDIO_VIBES[vibe] ?? STUDIO_VIBES[DEFAULT_VIBE];
  const lines = lyric
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line) => line.slice(0, 200));
  return {
    positive_global_styles: langName ? [`vocals sung in ${langName}`, ...styles.global] : styles.global,
    negative_global_styles: NEGATIVE_GLOBAL,
    sections: [
      {
        section_name: "Verse",
        positive_local_styles: styles.local,
        negative_local_styles: [],
        duration_ms: SECTION_MS,
        lines: lines.length ? lines : ["la la la"],
      },
    ],
  };
}

export interface StudioTrackInput {
  code: string;
  trackId: number;
  playerName: string;
  /** The player's raw recording (consumed by STT, never persisted). */
  audio: Blob;
  vibe?: string;
  /** Session narrator language code, used for STT + lyric language. */
  languageCode?: string;
  /** Native language name for the lyrics (e.g. "Italian"). */
  nativeName?: string;
  /** Progress callback so callers can mirror state onto the session. */
  onState?: (state: StudioTrackState) => void;
}

export interface StudioTrackResult {
  transcript: string;
  lyric: string;
  audioUrl: string;
}

// record → STT → polish → compose (music_v1) → cache. Throws on failure so the
// caller can mark the track "failed" and run its fallback chain (Phase E).
export async function generateStudioTrack(input: StudioTrackInput): Promise<StudioTrackResult> {
  const vibe = input.vibe && STUDIO_VIBES[input.vibe] ? input.vibe : DEFAULT_VIBE;

  input.onState?.("transcribing");
  // Auto-detect the spoken language (don't force the room's language) so the song
  // comes out in the language the player actually used.
  const { text: transcript, languageCode: detected } = await transcribeVoice(input.audio, input.languageCode);

  input.onState?.("writing");
  const lyric = await polishBars({
    transcript,
    playerName: input.playerName,
    vibe,
    nativeName: input.nativeName,
  });

  input.onState?.("composing");
  const songLangName = detected ? languageName(detected) : input.nativeName;
  const res = await composeMusicWithLyrics(planFor(lyric, vibe, songLangName));
  const mp3 = new Uint8Array(await res.arrayBuffer());
  audioCache.set(cacheKey(input.code, input.trackId), mp3);

  // The caller owns the "ready" transition so it can set state + audioUrl + lyric
  // atomically — emitting "ready" here would briefly show ready with no audioUrl.
  return {
    transcript,
    lyric,
    audioUrl: `/api/sessions/${input.code}/studio?track=${input.trackId}`,
  };
}

export function getStudioAudio(code: string, trackId: number): Uint8Array | null {
  return audioCache.get(cacheKey(code, trackId)) ?? null;
}

// Drop all cached audio for a session (match end / Studio reset). Privacy + memory.
export function clearStudioAudio(code: string): void {
  const prefix = `${code}:`;
  for (const key of audioCache.keys()) {
    if (key.startsWith(prefix)) audioCache.delete(key);
  }
}
