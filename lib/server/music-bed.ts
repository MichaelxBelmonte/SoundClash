import "server-only";

import { composeMusic } from "@/lib/server/elevenlabs";
import type { DecoySimilarity } from "@/lib/game/difficulty";

// Generated instrumental beds for the audio mini-games (Genre Roulette + Beat
// Lock). Everything here is ORIGINAL audio from ElevenLabs Music — no real song,
// no licensing. Beds are generated lazily and cached in-process (the ElevenLabs
// call takes seconds, so rounds pre-warm at build time and the client streams the
// cached bytes via /api/music).

export interface Vibe {
  id: string;
  label: string;
  /** Prompt fragment fed to ElevenLabs Music (instrumental is forced separately). */
  prompt: string;
}

// Distinct, recognizable vibes so "name the genre" is a real call.
export const VIBES: Vibe[] = [
  { id: "boombap", label: "90s Boom-Bap", prompt: "dusty 90s boom-bap hip-hop, vinyl crackle, head-nod groove" },
  { id: "lofi", label: "Lo-Fi Chill", prompt: "mellow lo-fi chillhop, warm keys, relaxed swing" },
  { id: "synthwave", label: "80s Synthwave", prompt: "retro 80s synthwave, neon arpeggios, gated drums" },
  { id: "house", label: "Festival House", prompt: "uplifting festival EDM house, four-on-the-floor, big synth stabs" },
  { id: "trap", label: "Trap", prompt: "modern trap beat, rolling 808s, crisp hi-hats" },
  { id: "reggaeton", label: "Reggaeton", prompt: "reggaeton dembow groove, latin percussion, club energy" },
  { id: "country", label: "Country", prompt: "modern country, acoustic guitar, brushed drums, warm bass" },
  { id: "cinematic", label: "Cinematic Score", prompt: "epic orchestral cinematic score, sweeping strings, timpani" },
  { id: "jazz", label: "Jazz Lounge", prompt: "smooth jazz lounge trio, upright bass, brushed drums, piano" },
  { id: "dnb", label: "Drum & Bass", prompt: "fast drum and bass, breakbeats, deep sub bass" },
  { id: "afrobeats", label: "Afrobeats", prompt: "afrobeats groove, syncopated percussion, bright marimba" },
  { id: "metal", label: "Metal", prompt: "heavy metal, distorted power chords, double-kick drums" },
];

const BED_LENGTH_MS = 14_000;

export function isMusicGenerationAvailable(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

// ---- tiny deterministic seeded helpers (kept local to avoid coupling) ----
function seededIndex(seed: number, size: number, salt = 0): number {
  if (size <= 0) return 0;
  return Math.abs(Math.trunc(seed) * 37 + salt * 17) % size;
}
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = seededIndex(seed + i, i + 1, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- spec builders (called from session-store at round build) ----

export interface GenreRoundSpec {
  solution: string;
  options: string[];
  audioUrl: string;
  instruction: string;
}

export function buildGenreRoundSpec(
  seed: number,
  optionCount: number,
  _similarity: DecoySimilarity,
): GenreRoundSpec {
  const correct = VIBES[seededIndex(seed, VIBES.length)];
  const others = VIBES.filter((v) => v.id !== correct.id).map((v) => v.label);
  const distractors = seededShuffle(others, seed).slice(0, Math.max(1, optionCount - 1));
  const options = seededShuffle([correct.label, ...distractors], seed + 7).slice(0, optionCount);
  return {
    solution: correct.label,
    options,
    audioUrl: `/api/music?vibe=${encodeURIComponent(correct.id)}&seed=${seed >>> 0}`,
    instruction: "Listen — name the vibe.",
  };
}

export interface BeatRoundSpec {
  bpm: number;
  tapWindowMs: number;
  audioUrl: string;
  instruction: string;
}

const BEAT_BPMS = [90, 100, 112, 124, 140];
const BEAT_WINDOWS_MS = [240, 200, 160, 120, 95];

export function buildBeatRoundSpec(seed: number, tier: number): BeatRoundSpec {
  const idx = Math.min(5, Math.max(1, tier)) - 1;
  const bpm = BEAT_BPMS[idx];
  return {
    bpm,
    tapWindowMs: BEAT_WINDOWS_MS[idx],
    audioUrl: `/api/music?bpm=${bpm}&seed=${seed >>> 0}`,
    instruction: "Tap on the beat on your phone.",
  };
}

// ---- generation + in-process cache (used by /api/music) ----
const cache = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<Uint8Array>>();

function promptForKey(key: string): string {
  if (key.startsWith("beat:")) {
    const bpm = Number(key.slice(5)) || 110;
    return `minimal percussive backing beat at ${bpm} BPM, steady 4/4 kick and hi-hats, clean seamless loop`;
  }
  const vibe = VIBES.find((v) => v.id === key.slice(2)) ?? VIBES[0];
  return `${vibe.prompt}, clean seamless loop`;
}

async function getBedByKey(key: string): Promise<Uint8Array> {
  const cached = cache.get(key);
  if (cached) return cached;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const job = (async () => {
    const res = await composeMusic({ prompt: promptForKey(key), musicLengthMs: BED_LENGTH_MS, forceInstrumental: true });
    const bytes = new Uint8Array(await res.arrayBuffer());
    cache.set(key, bytes);
    pending.delete(key);
    return bytes;
  })();
  pending.set(key, job.catch((err) => {
    pending.delete(key);
    throw err;
  }) as Promise<Uint8Array>);
  return job;
}

// Resolve the cache key from the /api/music query params.
export function bedKeyFromQuery(params: URLSearchParams): string | null {
  const vibe = params.get("vibe");
  if (vibe && VIBES.some((v) => v.id === vibe)) return `g:${vibe}`;
  const bpm = Number(params.get("bpm"));
  if (Number.isFinite(bpm) && bpm > 0) return `beat:${Math.round(bpm)}`;
  return null;
}

export async function getBed(params: URLSearchParams): Promise<Uint8Array> {
  const key = bedKeyFromQuery(params);
  if (!key) throw new Error("invalid_bed_spec");
  return getBedByKey(key);
}

// Fire-and-forget pre-generation so the bed is likely cached by the time the
// client plays it. Parses the same query the client will request.
export function prewarmBed(audioUrl: string): void {
  if (!isMusicGenerationAvailable()) return;
  const qIndex = audioUrl.indexOf("?");
  if (qIndex < 0) return;
  const key = bedKeyFromQuery(new URLSearchParams(audioUrl.slice(qIndex + 1)));
  if (key) void getBedByKey(key).catch(() => {});
}
