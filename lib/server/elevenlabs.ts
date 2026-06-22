import "server-only";

import type { HostVoicePreset } from "@/lib/session/types";

const BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George

// Distinct public ElevenLabs library voices per preset, so the host actually
// changes voice when you pick a personality — even with no ELEVENLABS_VOICE_* env
// set. Override any of them via env to use a custom voice from your library.
const PRESET_VOICE_IDS: Record<HostVoicePreset, string> = {
  hype: "pNInz6obpgDQGcFmaJgB", // Adam — punchy, energetic announcer
  judge: "onwK4e9ZLuTAKqWW03F9", // Daniel — calm, deadpan authority
  diva: "XB0fDUnXU5powFXDhCwa", // Charlotte — warm, dramatic
  custom: DEFAULT_VOICE_ID,
};

function envVoice(preset: HostVoicePreset): string | undefined {
  if (preset === "hype") return process.env.ELEVENLABS_VOICE_HYPE;
  if (preset === "judge") return process.env.ELEVENLABS_VOICE_JUDGE;
  if (preset === "diva") return process.env.ELEVENLABS_VOICE_DIVA;
  return process.env.ELEVENLABS_VOICE_CUSTOM;
}

// More natural, less robotic delivery: lower stability = more expressive/varied,
// style adds personality. Judge stays steadier (deadpan); hype/diva loosen up.
function voiceSettings(preset: HostVoicePreset = "hype") {
  if (preset === "judge") {
    return { stability: 0.55, similarity_boost: 0.8, style: 0.12, use_speaker_boost: true };
  }
  if (preset === "diva") {
    return { stability: 0.3, similarity_boost: 0.82, style: 0.6, use_speaker_boost: true };
  }
  return { stability: 0.4, similarity_boost: 0.82, style: 0.45, use_speaker_boost: true };
}

export interface SpeechInput {
  text: string;
  preset?: HostVoicePreset;
  voiceId?: string;
  // Any language code supported by eleven_multilingual_v2 (see lib/game/languages.ts).
  languageCode?: string;
}

export interface MusicInput {
  prompt: string;
  musicLengthMs?: number;
  modelId?: string;
  forceInstrumental?: boolean;
}

class ElevenLabsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElevenLabsProviderError";
  }
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new ElevenLabsProviderError("ELEVENLABS_API_KEY is not set");
  return key;
}

export function voiceIdForPreset(preset: HostVoicePreset = "hype"): string {
  return (
    envVoice(preset)?.trim() ||
    PRESET_VOICE_IDS[preset] ||
    process.env.ELEVENLABS_VOICE_DEFAULT?.trim() ||
    DEFAULT_VOICE_ID
  );
}

export async function createSpeech(input: SpeechInput): Promise<Response> {
  const text = input.text.trim().slice(0, 420);
  if (!text) throw new ElevenLabsProviderError("Speech text is required");

  const voiceId = input.voiceId?.trim() || voiceIdForPreset(input.preset);
  const response = await fetch(
    `${BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        language_code: input.languageCode ?? undefined,
        voice_settings: voiceSettings(input.preset),
      }),
      cache: "no-store",
    },
  );

  if (!response.ok || !response.body) {
    throw new ElevenLabsProviderError(`ElevenLabs HTTP ${response.status}`);
  }

  return response;
}

export interface VoiceCloneResult {
  voiceId: string;
  requiresVerification: boolean;
}

// Instant Voice Cloning (IVC): near-instant, no training. The sample conditions
// the voice at inference. Used by Voice Clash to clone the HOST's own voice (with
// in-app consent); the clone is deleted at match end. `requires_verification`
// mirrors ElevenLabs' voice-captcha — the voice is still usable for TTS meanwhile.
export async function cloneInstantVoice(
  name: string,
  sample: Blob,
  filename = "sample.webm",
): Promise<VoiceCloneResult> {
  const form = new FormData();
  form.append("name", name.trim().slice(0, 60) || "Soundclash host");
  form.append("remove_background_noise", "true");
  form.append("files", sample, filename);
  // No explicit Content-Type — fetch sets the multipart boundary for FormData.
  const response = await fetch(`${BASE}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
    cache: "no-store",
  });
  if (!response.ok) throw new ElevenLabsProviderError(`ElevenLabs IVC HTTP ${response.status}`);
  const data = (await response.json()) as { voice_id?: string; requires_verification?: boolean };
  if (!data.voice_id) throw new ElevenLabsProviderError("ElevenLabs IVC: no voice_id returned");
  return { voiceId: data.voice_id, requiresVerification: Boolean(data.requires_verification) };
}

// Privacy teardown: purge a cloned voice from the ElevenLabs account. Best-effort.
export async function deleteVoice(voiceId: string): Promise<void> {
  if (!voiceId) return;
  await fetch(`${BASE}/voices/${encodeURIComponent(voiceId)}`, {
    method: "DELETE",
    headers: { "xi-api-key": apiKey() },
    cache: "no-store",
  }).catch(() => {});
}

export async function composeMusic(input: MusicInput): Promise<Response> {
  const prompt = input.prompt.trim().slice(0, 4100);
  if (!prompt) throw new ElevenLabsProviderError("Music prompt is required");

  const response = await fetch(`${BASE}/music?output_format=auto`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      prompt,
      music_length_ms: input.musicLengthMs ?? 45000,
      // Use || (not ??) so an EMPTY-STRING env var (e.g. ELEVENLABS_MUSIC_MODEL=""
      // set blank on Railway) still falls back to the default — ?? would forward the
      // empty string as model_id and the Music API rejects it with HTTP 422.
      model_id: input.modelId?.trim() || process.env.ELEVENLABS_MUSIC_MODEL?.trim() || "music_v2",
      force_instrumental: input.forceInstrumental ?? true,
    }),
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    throw new ElevenLabsProviderError(`ElevenLabs Music HTTP ${response.status}`);
  }

  return response;
}
