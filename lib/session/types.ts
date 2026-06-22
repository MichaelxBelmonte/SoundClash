import type { DifficultyFloor, DifficultyTier } from "@/lib/game/difficulty";
import type { BanterPack } from "@/lib/game/host-banter";
import type { FinishLineDrop, Locale, TrackingLinks } from "@/lib/types";

export type SessionStatus = "lobby" | "playing" | "results";
export type MiniGameId =
  | "finish_line"
  | "the_drop"
  | "next_line"
  | "artist_pick"
  | "word_rush"
  | "name_song"
  | "mondegreen"
  | "song_mash"
  | "on_beat"
  // Generated-audio games (no lyrics, no licensing — ElevenLabs Music beds).
  | "genre_roulette"
  | "beat_lock"
  // Real-song stem game (host-uploaded audio separated via lalal.ai).
  | "stem_heist"
  // Host clones their voice → app bakes a track (voice over a generated beat) →
  // the crowd rates it. Uses the "judge" answer type. ElevenLabs IVC + Music + TTS.
  | "voice_clash"
  // Each player records a line on their phone → STT → AI sings it over a beat →
  // the crowd rates every track (judge carousel). ElevenLabs STT + Music v1.
  | "studio_session";
export type HostVoicePreset = "hype" | "judge" | "diva" | "custom";
// "judge" = subjective crowd rating (0..100 / stars). No correct answer; the
// track's score is the aggregate of player ratings (see Voice Clash).
export type RoundAnswerType = "text" | "choice" | "tap" | "judge";

export interface SessionTrackRef {
  trackId: number;
  trackName: string;
  artistName: string;
  hasRichsync?: boolean;
}

// A prepared, isolated stem for one deck track (host BYO-upload → lalal.ai).
// Stored on the session keyed by trackId; the URL points to lalal's CDN and is
// ephemeral (expires with the source). Powers Stem Heist.
export interface TrackStem {
  stem: string;
  url: string;
  trackName: string;
}

// A baked Voice Clash track: the host's cloned voice (spoken/rap bars) over a
// freshly generated instrumental. Both audio parts are served from the in-memory
// store via /api/sessions/[code]/voice. The crowd rates the finished track.
export interface VoiceTrack {
  id: number;
  vibe: string;
  lyric: string;
  /** URL of the generated instrumental bed. */
  beatUrl: string;
  /** URL of the host-voice vocal (TTS in the cloned voice). */
  vocalUrl: string;
  /** Player who authored the theme/lyric, if any (excluded from rating their own). */
  creatorPlayerId?: string;
  creatorName?: string;
}

// Studio Session: one player's recorded line turned into an AI-sung track. The
// raw recording is consumed by the pipeline (STT) and never persisted; only the
// generated mp3 lives in the in-process audio cache, served via /studio. `state`
// drives the TV "loading bay" while the track is still cooking. Scored as a
// "judge" round (crowd rating); solo play falls back to an AI-host verdict.
export type StudioTrackState =
  | "transcribing"
  | "writing"
  | "composing"
  | "ready"
  | "failed";

export interface StudioTrack {
  id: number;
  playerId: string;
  playerName: string;
  state: StudioTrackState;
  /** Speech-to-text of what the player said (ElevenLabs Scribe). */
  transcript?: string;
  /** Polished bars the AI sings (Claude); falls back to the raw transcript. */
  lyric?: string;
  /** URL of the generated, fully-mixed sung mp3 (ElevenLabs Music v1). */
  audioUrl?: string;
  /** Crowd-average rating, set at reveal. */
  studioScore?: number;
  error?: string;
}

// The host's instant voice clone for this session (ElevenLabs IVC). Deleted at
// match end / teardown for privacy. `requiresVerification` mirrors ElevenLabs'
// voice-captcha flag; the clone is still usable for TTS while it clears.
export interface VoiceClone {
  voiceId: string;
  label: string;
  requiresVerification: boolean;
}

export interface HostVoiceConfig {
  preset: HostVoicePreset;
  label: string;
  voiceId?: string;
}

export interface SessionPlayer {
  id: string;
  name: string;
  avatar: string;
  score: number;
  joinedAt: number;
  lastSeenAt: number;
}

export interface SessionAnswer {
  playerId: string;
  playerName: string;
  guess: string;
  correct: boolean;
  points: number;
  elapsedMs: number;
  submittedAt: number;
}

export interface SessionRound {
  index: number;
  miniGame: MiniGameId;
  title: string;
  instruction: string;
  trackId: number;
  trackName: string;
  artistName: string;
  hasRichsync?: boolean;
  seed: number;
  // Resolved difficulty tier for this round (drives option count, decoys, timer).
  difficulty: DifficultyTier;
  // Answering window for this round, in ms (varies by difficulty tier).
  timeLimitMs: number;
  prompt: string;
  answerType: RoundAnswerType;
  options?: string[];
  drop?: FinishLineDrop;
  // Audio games: URL of the generated instrumental bed the TV plays.
  audioUrl?: string;
  // Beat Lock: target tempo + the on-beat tap tolerance (ms), both tier-scaled.
  bpm?: number;
  tapWindowMs?: number;
  // Voice Clash (judge round): the host-voice vocal played over `audioUrl`, the
  // lyric shown karaoke-style, the track's author, and the crowd score at reveal.
  vocalUrl?: string;
  lyric?: string;
  creatorPlayerId?: string;
  studioScore?: number;
  // Studio Session: the pool of player tracks played in sequence on the TV and
  // rated individually by the crowd. Per-track studioScore is filled at reveal.
  studioTracksRef?: {
    id: number;
    playerId: string;
    playerName: string;
    audioUrl: string;
    lyric: string;
    studioScore?: number;
  }[];
  solution?: string;
  copyright?: string;
  tracking?: TrackingLinks;
  startedAt: number;
  endsAt: number;
  status: "answering" | "revealed";
  answers: SessionAnswer[];
}

export interface PartySession {
  code: string;
  status: SessionStatus;
  locale: Locale;
  // Narrator language code (any SUPPORTED_LANGUAGES code) — drives banter + TTS.
  narratorLang: string;
  // Localized narrator lines for this session's language.
  banter: BanterPack;
  hostName: string;
  voice: HostVoiceConfig;
  miniGames: MiniGameId[];
  // Shuffled play order for this session (a permutation of miniGames), so the
  // mini-game sequence varies between sessions instead of following the fixed
  // catalog order. playedGames tracks what actually ran, for no-repeat draws.
  rotation: MiniGameId[];
  playedGames: MiniGameId[];
  // How many rounds the match runs (host-chosen: 3 / 6 / 9).
  rounds: number;
  // Per-session entropy folded into every round's content seed, so two shows of
  // the same deck never generate identical puzzles.
  contentSeed: number;
  // Host-chosen starting difficulty band; the per-match curve ramps up from here.
  difficultyFloor: DifficultyFloor;
  // Recently-used prompt keys (normalized lines) for cross-round anti-repetition.
  usedPromptKeys: string[];
  // Prepared isolated stems per deck trackId (host Stem Lab → lalal.ai). Powers
  // Stem Heist, which is only playable once >=4 are ready.
  trackStems: Record<number, TrackStem>;
  // Voice Clash: the host's instant voice clone + the tracks baked from it. The
  // game is only playable once a clone exists and >=1 track is baked.
  voiceClone: VoiceClone | null;
  voiceTracks: VoiceTrack[];
  // Studio Session: per-round player recordings turned into AI-sung tracks. The
  // generated mp3s live in the in-process audio cache; this holds only metadata.
  // Ephemeral — cleared on rematch / teardown.
  studioTracks: StudioTrack[];
  autopilot: boolean;
  trackPool: SessionTrackRef[];
  players: SessionPlayer[];
  currentRound: SessionRound | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicSessionState extends PartySession {
  playerCount: number;
  // True once the final round has been revealed (currentRound.index >= rounds &&
  // status === "revealed"). One source of truth for the winners screen so both the
  // TV and the phone branch identically — the phone can't derive this on its own.
  complete: boolean;
  // Server-side capability flags so the host UI can gate the setup flow (which
  // games are playable, what content to prepare) without a round-trip.
  capabilities: {
    /** ELEVENLABS_API_KEY present → Genre Roulette / Beat Lock can generate audio. */
    audioGen: boolean;
    /** LALAL_API_KEY present → Stem Heist can prepare stems. */
    stemSeparation: boolean;
    /** ELEVENLABS_API_KEY present → Voice Clash can clone the host voice + bake tracks. */
    voiceClone: boolean;
  };
}

export interface CreateSessionInput {
  locale?: Locale;
  /** Narrator language code (any SUPPORTED_LANGUAGES code). */
  language?: string;
  hostName?: string;
  voice?: Partial<HostVoiceConfig>;
  autopilot?: boolean;
  miniGames?: MiniGameId[];
  rounds?: number;
  /** Host-chosen starting difficulty band (1 chill / 2 standard / 3 brutal). */
  difficultyFloor?: DifficultyFloor;
}

export interface JoinSessionInput {
  name?: string;
  avatar?: string;
}

export interface StartRoundInput {
  miniGame?: MiniGameId;
  auto?: boolean;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  hasRichsync?: boolean;
  deck?: SessionTrackRef[];
}

export interface SubmitAnswerInput {
  playerId?: string;
  guess?: string;
}
