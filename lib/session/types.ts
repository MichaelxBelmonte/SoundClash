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
  | "beat_lock";
export type HostVoicePreset = "hype" | "judge" | "diva" | "custom";
export type RoundAnswerType = "text" | "choice" | "tap";

export interface SessionTrackRef {
  trackId: number;
  trackName: string;
  artistName: string;
  hasRichsync?: boolean;
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
  autopilot: boolean;
  trackPool: SessionTrackRef[];
  players: SessionPlayer[];
  currentRound: SessionRound | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicSessionState extends PartySession {
  playerCount: number;
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
