import "server-only";

import {
  buildArtistPickRound,
  buildFinishLineRound,
  buildMondegreenRound,
  buildNameSongRound,
  buildNextLineRound,
  buildSongMashRound,
  buildWordRushRound,
  computeDrop,
  mix,
  normalizeAnswer,
} from "@/lib/game/finish-line";
import { clampFloor, resolveDifficulty, tierForRound } from "@/lib/game/difficulty";
import type { DifficultyTier, RoundDifficultyConfig } from "@/lib/game/difficulty";
import {
  buildBeatRoundSpec,
  buildGenreRoundSpec,
  isMusicGenerationAvailable,
  prewarmBed,
  prewarmSigla,
} from "@/lib/server/music-bed";
import { ROUND_TIME_LIMIT_MS, scoreFinishLine, scoreRound } from "@/lib/game/scoring";
import { getRichsyncLines, getTrackLyrics } from "@/lib/server/musixmatch";
import { DEFAULT_BANTER_PACK, staticBanterPack, type BanterPack } from "@/lib/game/host-banter";
import { normalizeLanguage } from "@/lib/game/languages";
import { avatarForIndex, isPlayerAvatar } from "@/lib/session/avatars";
import { ALL_MINI_GAME_IDS, gameBlockers, orderMiniGames } from "@/lib/session/mini-games";
import { generateLyricChoices, type LyricGame } from "@/lib/server/anthropic";
import { gameCopy } from "@/lib/game/game-copy";
import type { FinishLineDrop, Locale, TrackSummary } from "@/lib/types";
import type {
  CreateSessionInput,
  HostVoiceConfig,
  JoinSessionInput,
  MiniGameId,
  PartySession,
  PublicSessionState,
  SessionAnswer,
  SessionPlayer,
  SessionRound,
  SessionTrackRef,
  StartRoundInput,
  StudioTrack,
  SubmitAnswerInput,
} from "@/lib/session/types";

const DEFAULT_VOICE: HostVoiceConfig = {
  preset: "hype",
  label: "Hype Host",
};

const DEFAULT_MINI_GAMES: MiniGameId[] = ALL_MINI_GAME_IDS;

// Host-selectable match lengths. Anything else normalizes to the default.
const ALLOWED_ROUNDS = [3, 6, 9];
const DEFAULT_ROUNDS = 6;
function clampRounds(value: unknown): number {
  const n = Number(value);
  return ALLOWED_ROUNDS.includes(n) ? n : DEFAULT_ROUNDS;
}

// Fisher–Yates shuffle (server-side; Math.random is fine here). Used once per
// session to randomize the mini-game play order so two shows don't run the
// identical canonical sequence.
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type Store = Map<string, PartySession>;

const globalForSessions = globalThis as typeof globalThis & {
  __soundclashSessions?: Store;
};

const sessions: Store = globalForSessions.__soundclashSessions ?? new Map();
globalForSessions.__soundclashSessions = sessions;

function now(): number {
  return Date.now();
}

function cleanCode(value: string): string {
  return value.trim().toUpperCase();
}

function code(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let i = 0; i < 4; i++) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return sessions.has(value) ? code() : value;
}

function playerId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function assertSession(sessionCode: string): PartySession {
  const session = sessions.get(cleanCode(sessionCode));
  if (!session) throw new Error("session_not_found");
  return session;
}

function publicState(session: PartySession): PublicSessionState {
  const currentRound = session.currentRound
    ? {
        ...session.currentRound,
        solution: session.currentRound.status === "revealed" ? session.currentRound.solution : undefined,
        answers: [...session.currentRound.answers].sort((a, b) => b.points - a.points),
      }
    : null;

  const complete =
    session.currentRound != null &&
    session.currentRound.index >= session.rounds &&
    session.currentRound.status === "revealed";

  return {
    ...session,
    playerCount: session.players.length,
    complete,
    players: [...session.players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt),
    currentRound,
    capabilities: {
      audioGen: isMusicGenerationAvailable(),
      stemSeparation: Boolean(process.env.LALAL_API_KEY),
      voiceClone: isMusicGenerationAvailable(),
    },
  };
}

export function createSession(input: CreateSessionInput = {}): PublicSessionState {
  const createdAt = now();
  const requestedGames = orderMiniGames(input.miniGames ?? []);
  const narratorLang = normalizeLanguage(input.language ?? input.locale);
  const session: PartySession = {
    code: code(),
    status: "lobby",
    locale: narratorLang === "it" ? "it" : ("en" satisfies Locale),
    narratorLang,
    // Static pack for en/it (instant); the POST /api/sessions route swaps in a
    // Claude-generated pack for other languages before the host gets the room.
    banter: staticBanterPack(narratorLang) ?? DEFAULT_BANTER_PACK,
    hostName: input.hostName?.trim() || "Host",
    voice: {
      ...DEFAULT_VOICE,
      ...input.voice,
      label: input.voice?.label?.trim() || DEFAULT_VOICE.label,
    },
    miniGames: requestedGames.length ? requestedGames : DEFAULT_MINI_GAMES,
    rotation: shuffle(requestedGames.length ? requestedGames : DEFAULT_MINI_GAMES),
    playedGames: [],
    rounds: clampRounds(input.rounds),
    // Per-session entropy so two shows of the same deck never match puzzle-for-puzzle.
    contentSeed: (createdAt ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
    difficultyFloor: clampFloor(input.difficultyFloor),
    usedPromptKeys: [],
    trackStems: {},
    voiceClone: null,
    voiceTracks: [],
    studioTracks: [],
    autopilot: input.autopilot ?? true,
    trackPool: [],
    players: [],
    currentRound: null,
    createdAt,
    updatedAt: createdAt,
  };
  sessions.set(session.code, session);
  return publicState(session);
}

export function getSession(sessionCode: string): PublicSessionState {
  return publicState(assertSession(sessionCode));
}

// Attach the resolved (possibly Claude-generated) narrator banter pack to a
// session after creation. No-op if the session has since vanished.
export function setSessionBanter(sessionCode: string, banter: BanterPack): void {
  const session = sessions.get(cleanCode(sessionCode));
  if (session) session.banter = banter;
}

export function joinSession(sessionCode: string, input: JoinSessionInput = {}) {
  const session = assertSession(sessionCode);
  const joinedAt = now();
  const baseName = input.name?.trim() || `Player ${session.players.length + 1}`;
  const player: SessionPlayer = {
    id: playerId(),
    name: baseName.slice(0, 24),
    avatar: isPlayerAvatar(input.avatar) ? input.avatar : avatarForIndex(session.players.length),
    score: 0,
    joinedAt,
    lastSeenAt: joinedAt,
  };
  session.players.push(player);
  session.updatedAt = joinedAt;
  return { player, session: publicState(session) };
}

export function touchPlayer(sessionCode: string, id: string): PublicSessionState {
  const session = assertSession(sessionCode);
  const player = session.players.find((item) => item.id === id);
  if (player) player.lastSeenAt = now();
  return publicState(session);
}

function toTrackSummary(track: SessionTrackRef): TrackSummary {
  return {
    trackId: track.trackId,
    trackName: track.trackName,
    artistName: track.artistName,
    hasLyrics: true,
    hasRichsync: track.hasRichsync === true,
  };
}

function cleanDeck(deck: SessionTrackRef[] | undefined): SessionTrackRef[] {
  const seen = new Set<number>();
  return (deck ?? [])
    .filter((track) => Number.isInteger(track.trackId) && track.trackId > 0)
    .filter((track) => {
      if (seen.has(track.trackId)) return false;
      seen.add(track.trackId);
      return true;
    })
    .slice(0, 8);
}

const NEEDS_RICHSYNC = new Set<MiniGameId>(["the_drop", "on_beat"]);
// Generated-audio games need ElevenLabs Music configured (no real song / no lyrics).
const GENERATED_AUDIO_GAMES = new Set<MiniGameId>(["genre_roulette", "beat_lock"]);

// Per-game minimum answering window (ms): floors the difficulty timer when a game
// needs a longer listen. Genre Roulette needs ~20s — you can't name a vibe in 8s.
const MIN_TIME_BY_GAME: Partial<Record<MiniGameId, number>> = { genre_roulette: 20_000 };

// A game is playable on a given track only if its data requirement is met:
// audio games need music generation; the_drop / on_beat need richsync timing.
function isPlayable(game: MiniGameId, hasRichsync: boolean): boolean {
  if (GENERATED_AUDIO_GAMES.has(game)) return isMusicGenerationAvailable();
  return !NEEDS_RICHSYNC.has(game) || hasRichsync;
}

function countReadyStems(session: PartySession): number {
  return Object.keys(session.trackStems).length;
}

// Session-aware readiness: Stem Heist needs lalal.ai + >=4 host-prepared stems;
// Voice Clash needs ElevenLabs + a voice clone + >=1 baked track; everything else
// falls back to the static isPlayable.
function gameReady(session: PartySession, game: MiniGameId, hasRichsync: boolean): boolean {
  if (game === "stem_heist") return Boolean(process.env.LALAL_API_KEY) && countReadyStems(session) >= 4;
  if (game === "voice_clash") {
    return isMusicGenerationAvailable() && Boolean(session.voiceClone) && session.voiceTracks.length >= 1;
  }
  if (game === "studio_session") {
    return isMusicGenerationAvailable() && session.studioTracks.some((t) => t.state === "ready" && t.audioUrl);
  }
  return isPlayable(game, hasRichsync);
}

// Deterministic seeded helpers for audio/stem rounds (mirrors finish-line's seed
// behavior without exporting its internals).
function seedIndex(seed: number, size: number): number {
  if (size <= 0) return 0;
  return Math.abs(Math.trunc(seed)) % size;
}
function seedShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.abs(Math.trunc(mix(seed, i))) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pick the next mini-game for an autopilot round. Draws from the session's
// shuffled rotation WITHOUT replacement within a cycle, so the 6-round set is
// varied and (with ≥6 games selected) never repeats. When the chosen game needs
// richsync the current track lacks, it substitutes the next *playable, unused*
// game rather than collapsing every such slot onto "finish_line".
function pickFromRotation(session: PartySession, hasRichsync: boolean): MiniGameId {
  const rotation = session.rotation.length ? session.rotation : DEFAULT_MINI_GAMES;
  const cycleLen = rotation.length;
  const lastGame = session.currentRound?.miniGame;
  // Games already played in the current cycle (one cycle = one full pass through
  // the rotation). With ≥6 games selected and 6 rounds we never wrap, so this is
  // simply "everything played so far" → no repeats across the whole show.
  const played = session.playedGames;
  const cycleStart = Math.floor(played.length / cycleLen) * cycleLen;
  const usedThisCycle = new Set<MiniGameId>(played.slice(cycleStart));

  return (
    rotation.find((g) => gameReady(session, g, hasRichsync) && !usedThisCycle.has(g) && g !== lastGame) ??
    rotation.find((g) => gameReady(session, g, hasRichsync) && !usedThisCycle.has(g)) ??
    rotation.find((g) => gameReady(session, g, hasRichsync) && g !== lastGame) ??
    rotation.find((g) => gameReady(session, g, hasRichsync)) ??
    // The setup gate guarantees readiness, so this only fires on a per-track build
    // edge — and it stays WITHIN the host's selection, never a game they didn't pick.
    rotation[0] ??
    "finish_line"
  );
}

// Pick the next mini-game for an autopilot round. A not-ready game is NEVER
// silently swapped for one outside the host's selection: the start gate blocks
// the show until every chosen game has its content, so picks here always come
// from the host's own rotation.
function nextMiniGame(session: PartySession, requested: MiniGameId | undefined, hasRichsync: boolean): MiniGameId {
  // Manual override: honor the host's pick; if it can't run on this track, fall
  // back to another SELECTED, ready game (not a hardcoded one).
  if (requested) return gameReady(session, requested, hasRichsync) ? requested : pickFromRotation(session, hasRichsync);
  return pickFromRotation(session, hasRichsync);
}

// Stable key identifying the lyric line a round was built from, for cross-round
// anti-repetition. Mirrors what each builder filters on (normalizeAnswer of the
// source line): finish_line reconstructs the line from prompt + solution.
function promptKeyFor(round: SessionRound): string {
  if (round.miniGame === "mondegreen") return normalizeAnswer(round.solution ?? "");
  if (round.miniGame === "finish_line" || round.miniGame === "the_drop" || round.miniGame === "on_beat") {
    return normalizeAnswer((round.prompt ?? "").replace(/_{3,}/, round.solution ?? ""));
  }
  return normalizeAnswer(round.prompt ?? "");
}

// Generated-audio rounds (Genre Roulette / Beat Lock): no lyrics, the puzzle is a
// freshly generated instrumental bed. Synchronous — the bed pre-warms in the
// background and the client streams it from /api/music.
function buildAudioRound(input: {
  miniGame: MiniGameId;
  track: SessionTrackRef;
  roundIndex: number;
  tier: DifficultyTier;
  diff: RoundDifficultyConfig;
  seed: number;
  startedAt: number;
}): SessionRound {
  // Floor the answering window per game (Genre Roulette needs a longer listen).
  const timeLimitMs = Math.max(input.diff.timeLimitMs, MIN_TIME_BY_GAME[input.miniGame] ?? 0);
  const common = {
    index: input.roundIndex,
    miniGame: input.miniGame,
    trackId: input.track.trackId,
    trackName: input.track.trackName,
    artistName: input.track.artistName,
    hasRichsync: input.track.hasRichsync,
    seed: input.seed,
    difficulty: input.tier,
    timeLimitMs,
    startedAt: input.startedAt,
    endsAt: input.startedAt + timeLimitMs,
    status: "answering" as const,
    answers: [],
  };
  if (input.miniGame === "genre_roulette") {
    const spec = buildGenreRoundSpec(input.seed, input.diff.optionCount, input.diff.decoySimilarity);
    prewarmBed(spec.audioUrl);
    return {
      ...common,
      title: "Genre Roulette",
      instruction: spec.instruction,
      prompt: "",
      answerType: "choice",
      options: spec.options,
      solution: spec.solution,
      audioUrl: spec.audioUrl,
    };
  }
  const spec = buildBeatRoundSpec(input.seed, input.tier);
  prewarmBed(spec.audioUrl);
  return {
    ...common,
    title: "Beat Lock",
    instruction: spec.instruction,
    prompt: "",
    answerType: "tap",
    solution: "",
    audioUrl: spec.audioUrl,
    bpm: spec.bpm,
    tapWindowMs: spec.tapWindowMs,
  };
}

// Stem Heist: play one host-prepared isolated stem (real song) and pick its track
// from the deck. Needs >=4 prepared stems (gated upstream in gameReady).
function buildStemHeistRound(input: {
  session: PartySession;
  track: SessionTrackRef;
  roundIndex: number;
  tier: DifficultyTier;
  diff: RoundDifficultyConfig;
  seed: number;
  startedAt: number;
}): SessionRound {
  const entries = Object.entries(input.session.trackStems).map(([id, value]) => ({
    trackId: Number(id),
    ...value,
  }));
  if (entries.length < 4) throw new Error("stem_heist_not_ready");
  const correct = entries[seedIndex(input.seed, entries.length)];
  const others = entries.filter((entry) => entry.trackId !== correct.trackId).map((entry) => entry.trackName);
  const distractors = seedShuffle(others, input.seed).slice(0, Math.max(1, input.diff.optionCount - 1));
  const options = seedShuffle([correct.trackName, ...distractors], input.seed + 7).slice(0, input.diff.optionCount);
  return {
    index: input.roundIndex,
    miniGame: "stem_heist",
    title: "Stem Heist",
    instruction: "Name the track from this isolated stem.",
    trackId: correct.trackId,
    trackName: correct.trackName,
    artistName: input.track.artistName,
    hasRichsync: input.track.hasRichsync,
    seed: input.seed,
    difficulty: input.tier,
    timeLimitMs: input.diff.timeLimitMs,
    prompt: "",
    answerType: "choice",
    options,
    solution: correct.trackName,
    audioUrl: correct.url,
    startedAt: input.startedAt,
    endsAt: input.startedAt + input.diff.timeLimitMs,
    status: "answering",
    answers: [],
  };
}

// Voice Clash (judge round): play a baked host-voice track (vocal over a generated
// beat) and let the crowd rate it. No correct answer — scoring happens at reveal.
function buildVoiceClashRound(input: {
  session: PartySession;
  track: SessionTrackRef;
  roundIndex: number;
  tier: DifficultyTier;
  diff: RoundDifficultyConfig;
  seed: number;
  startedAt: number;
}): SessionRound {
  const tracks = input.session.voiceTracks;
  if (!tracks.length) throw new Error("voice_clash_not_ready");
  const pick = tracks[seedIndex(input.seed, tracks.length)];
  // Give the crowd time to actually listen before rating.
  const timeLimitMs = Math.max(input.diff.timeLimitMs, 22_000);
  return {
    index: input.roundIndex,
    miniGame: "voice_clash",
    title: "Voice Clash",
    instruction: "Listen — then rate the track.",
    trackId: input.track.trackId,
    trackName: input.session.voiceClone?.label ?? "Host voice",
    artistName: pick.creatorName ?? input.session.voiceClone?.label ?? "Host voice",
    hasRichsync: false,
    seed: input.seed,
    difficulty: input.tier,
    timeLimitMs,
    prompt: "",
    answerType: "judge",
    audioUrl: pick.beatUrl,
    vocalUrl: pick.vocalUrl,
    lyric: pick.lyric,
    creatorPlayerId: pick.creatorPlayerId,
    solution: "",
    startedAt: input.startedAt,
    endsAt: input.startedAt + timeLimitMs,
    status: "answering",
    answers: [],
  };
}

// Studio Session (judge carousel): play every ready player track in sequence on
// the TV and let the crowd rate each one. No correct answer — per-track scoring
// happens at reveal. Needs >=1 ready track (gated upstream in gameReady).
function buildStudioSessionRound(input: {
  session: PartySession;
  track: SessionTrackRef;
  roundIndex: number;
  tier: DifficultyTier;
  diff: RoundDifficultyConfig;
  seed: number;
  startedAt: number;
}): SessionRound {
  const ready = input.session.studioTracks
    .filter((t) => t.state === "ready" && t.audioUrl)
    .sort((a, b) => a.id - b.id);
  if (!ready.length) throw new Error("studio_session_not_ready");
  // Listening party: enough time to play + rate each track (~16s apiece).
  const timeLimitMs = Math.max(input.diff.timeLimitMs, ready.length * 16_000);
  const refs = ready.map((t) => ({
    id: t.id,
    playerId: t.playerId,
    playerName: t.playerName,
    audioUrl: t.audioUrl as string,
    lyric: t.lyric ?? "",
  }));
  return {
    index: input.roundIndex,
    miniGame: "studio_session",
    title: "Studio Session",
    instruction: "Listen to each track — then rate them.",
    trackId: input.track.trackId,
    trackName: "Studio Session",
    artistName: "The crowd",
    hasRichsync: false,
    seed: input.seed,
    difficulty: input.tier,
    timeLimitMs,
    prompt: "",
    answerType: "judge",
    // First track seeds the TV opener; the carousel walks the full ref list.
    audioUrl: refs[0].audioUrl,
    lyric: refs[0].lyric,
    creatorPlayerId: refs[0].playerId,
    studioTracksRef: refs,
    solution: "",
    startedAt: input.startedAt,
    endsAt: input.startedAt + timeLimitMs,
    status: "answering",
    answers: [],
  };
}

// Replace the locally-generated decoys with Claude-written, context-plausible
// distractors when available (falls back to the local options on any failure or
// timeout). This is what makes the lyrics games actually hard — the wrong answers
// fit the line instead of being unrelated words.
async function logicalOptions(
  game: LyricGame,
  line: string,
  answer: string,
  fallback: string[],
  optionCount: number,
  seed: number,
): Promise<string[]> {
  const need = Math.max(1, optionCount - 1);
  const distractors = await generateLyricChoices({ game, line, answer, count: need });
  if (!distractors || distractors.length < need) return fallback;
  return seedShuffle([answer, ...distractors.slice(0, need)], seed + 31);
}

async function buildSessionRound(input: {
  session: PartySession;
  track: SessionTrackRef;
  miniGame: MiniGameId;
  seed: number;
  startedAt: number;
}): Promise<SessionRound> {
  const roundIndex = (input.session.currentRound?.index ?? 0) + 1;
  // Per-match difficulty curve: ramps from the host's floor toward the finale.
  const tier = tierForRound(roundIndex, input.session.rounds, input.session.difficultyFloor);
  const diff = resolveDifficulty(tier);
  // Round title + instruction follow the session's narrator language (it/en today,
  // English fallback otherwise) instead of always being English.
  const copy = gameCopy(input.miniGame, input.session.narratorLang);

  // Audio games carry no lyrics — build them before any Musixmatch fetch.
  if (input.miniGame === "genre_roulette" || input.miniGame === "beat_lock") {
    const audioRound = buildAudioRound({
      miniGame: input.miniGame,
      track: input.track,
      roundIndex,
      tier,
      diff,
      seed: input.seed,
      startedAt: input.startedAt,
    });
    return { ...audioRound, title: copy.title, instruction: copy.instruction };
  }

  // Stem Heist plays a host-prepared isolated stem — also lyric-free.
  if (input.miniGame === "stem_heist") {
    const stemRound = buildStemHeistRound({
      session: input.session,
      track: input.track,
      roundIndex,
      tier,
      diff,
      seed: input.seed,
      startedAt: input.startedAt,
    });
    return { ...stemRound, title: copy.title, instruction: copy.instruction };
  }

  // Voice Clash plays a baked host-voice track — lyric-free as far as Musixmatch.
  if (input.miniGame === "voice_clash") {
    const voiceRound = buildVoiceClashRound({
      session: input.session,
      track: input.track,
      roundIndex,
      tier,
      diff,
      seed: input.seed,
      startedAt: input.startedAt,
    });
    return { ...voiceRound, title: copy.title, instruction: copy.instruction };
  }

  // Studio Session plays the crowd's recorded-then-sung tracks — lyric-free here.
  if (input.miniGame === "studio_session") {
    const studioRound = buildStudioSessionRound({
      session: input.session,
      track: input.track,
      roundIndex,
      tier,
      diff,
      seed: input.seed,
      startedAt: input.startedAt,
    });
    return { ...studioRound, title: copy.title, instruction: copy.instruction };
  }

  const lyrics = await getTrackLyrics(input.track.trackId);
  const excludeKeys = new Set(input.session.usedPromptKeys);
  const base = {
    index: roundIndex,
    miniGame: input.miniGame,
    title: copy.title,
    instruction: copy.instruction,
    trackId: input.track.trackId,
    trackName: input.track.trackName,
    artistName: input.track.artistName,
    hasRichsync: input.track.hasRichsync,
    seed: input.seed,
    difficulty: tier,
    timeLimitMs: diff.timeLimitMs,
    copyright: lyrics.copyright,
    tracking: lyrics.tracking,
    startedAt: input.startedAt,
    endsAt: input.startedAt + diff.timeLimitMs,
    status: "answering" as const,
    answers: [],
  };

  if (input.miniGame === "next_line") {
    const nextLine = buildNextLineRound({
      trackId: input.track.trackId,
      seed: input.seed,
      lyrics: lyrics.body,
      copyright: lyrics.copyright,
      tracking: lyrics.tracking,
      optionCount: diff.optionCount,
      decoySimilarity: diff.decoySimilarity,
      excludeKeys,
    });
    const options = await logicalOptions(
      "next_line",
      nextLine.prompt,
      nextLine.answer,
      nextLine.options,
      diff.optionCount,
      input.seed,
    );
    return {
      ...base,
      prompt: nextLine.prompt,
      answerType: "choice",
      options,
      solution: nextLine.answer,
    };
  }

  if (input.miniGame === "name_song") {
    const deck = input.session.trackPool.length ? input.session.trackPool : [input.track];
    const nameSong = buildNameSongRound({
      track: toTrackSummary(input.track),
      seed: input.seed,
      lyrics: lyrics.body,
      copyright: lyrics.copyright,
      tracking: lyrics.tracking,
      deck: deck.map(toTrackSummary),
    });
    return {
      ...base,
      prompt: nameSong.prompt,
      answerType: "choice",
      options: nameSong.options,
      solution: nameSong.answer,
    };
  }

  if (input.miniGame === "artist_pick") {
    const deck = input.session.trackPool.length ? input.session.trackPool : [input.track];
    const artistPick = buildArtistPickRound({
      track: toTrackSummary(input.track),
      seed: input.seed,
      lyrics: lyrics.body,
      copyright: lyrics.copyright,
      tracking: lyrics.tracking,
      deck: deck.map(toTrackSummary),
    });
    return {
      ...base,
      prompt: artistPick.prompt,
      answerType: "choice",
      options: artistPick.options,
      solution: artistPick.answer,
    };
  }

  if (input.miniGame === "word_rush") {
    const wordRush = buildWordRushRound({
      track: toTrackSummary(input.track),
      seed: input.seed,
      lyrics: lyrics.body,
      copyright: lyrics.copyright,
      tracking: lyrics.tracking,
    });
    return {
      ...base,
      prompt: wordRush.prompt,
      answerType: "choice",
      options: wordRush.options,
      solution: wordRush.answer,
    };
  }

  if (input.miniGame === "mondegreen") {
    const mondegreen = buildMondegreenRound({
      trackId: input.track.trackId,
      seed: input.seed,
      lyrics: lyrics.body,
      copyright: lyrics.copyright,
      tracking: lyrics.tracking,
      excludeKeys,
    });
    const options = await logicalOptions(
      "mondegreen",
      mondegreen.answer,
      mondegreen.answer,
      mondegreen.options,
      mondegreen.options.length,
      input.seed,
    );
    return {
      ...base,
      prompt: mondegreen.prompt,
      answerType: "choice",
      options,
      solution: mondegreen.answer,
    };
  }

  if (input.miniGame === "song_mash") {
    const deck = input.session.trackPool.length ? input.session.trackPool : [input.track];
    const songMash = buildSongMashRound({
      track: toTrackSummary(input.track),
      seed: input.seed,
      lyrics: lyrics.body,
      copyright: lyrics.copyright,
      tracking: lyrics.tracking,
      deck: deck.map(toTrackSummary),
    });
    return {
      ...base,
      prompt: songMash.prompt,
      answerType: "choice",
      options: songMash.options,
      solution: songMash.answer,
    };
  }

  const generated = buildFinishLineRound({
    trackId: input.track.trackId,
    seed: input.seed,
    lyrics: lyrics.body,
    copyright: lyrics.copyright,
    tracking: lyrics.tracking,
    optionCount: diff.optionCount,
    decoySimilarity: diff.decoySimilarity,
    excludeKeys,
  });

  const prompt = generated.round.prompt;
  let drop: SessionRound["drop"];
  if (input.miniGame === "the_drop" || input.miniGame === "on_beat") {
    try {
      const richsyncLines = await getRichsyncLines(input.track.trackId);
      drop = computeDrop(generated.line, generated.answer, richsyncLines) ?? undefined;
    } catch {
      // No richsync: keep the same lyric prompt and play as a timing-lite round.
    }
  }

  const options = await logicalOptions(
    "finish_line",
    generated.line,
    generated.answer,
    generated.options,
    diff.optionCount,
    input.seed,
  );
  return {
    ...base,
    prompt,
    answerType: "choice",
    options,
    drop,
    solution: generated.answer,
  };
}

export async function startRound(sessionCode: string, input: StartRoundInput): Promise<PublicSessionState> {
  const session = assertSession(sessionCode);
  const trackId = Number(input.trackId);
  const fallbackTrack = session.currentRound
    ? {
        trackId: session.currentRound.trackId,
        trackName: session.currentRound.trackName,
        artistName: session.currentRound.artistName,
        hasRichsync: session.currentRound.hasRichsync,
      }
    : null;
  const track: SessionTrackRef | null = Number.isInteger(trackId) && trackId > 0
    ? {
        trackId,
        trackName: input.trackName?.trim() || "Selected track",
        artistName: input.artistName?.trim() || "Musixmatch",
        hasRichsync: input.hasRichsync,
      }
    : fallbackTrack;

  if (!track) throw new Error("invalid_track_id");

  const nextDeck = cleanDeck(input.deck);
  if (nextDeck.length > 0) session.trackPool = nextDeck;
  if (!session.trackPool.some((item) => item.trackId === track.trackId)) {
    session.trackPool = [track, ...session.trackPool].slice(0, 8);
  }

  // No silent fallback: every selected game must have its content ready. A game
  // that isn't ready blocks the show here (the host UI gates this upstream) rather
  // than being swapped for a different game mid-rotation.
  const blockers = gameBlockers(session.miniGames, {
    deckCount: session.trackPool.length,
    preparedStems: countReadyStems(session),
    voiceTracks: session.voiceTracks.length,
    voiceCloned: Boolean(session.voiceClone),
    studioTracksReady: session.studioTracks.filter((t) => t.state === "ready" && t.audioUrl).length,
    audioGen: isMusicGenerationAvailable(),
    stemSeparation: Boolean(process.env.LALAL_API_KEY),
  });
  if (blockers.length > 0) throw new Error(`games_not_ready:${blockers.map((b) => b.game).join(",")}`);

  const startedAt = now();
  const hasRichsync = track.hasRichsync === true;
  const miniGame = nextMiniGame(session, input.auto ? undefined : input.miniGame, hasRichsync);
  // Fold per-session entropy + round index + track into the content seed so the
  // same track at the same round number differs show-to-show (was: raw index).
  const baseIndex = Math.max(0, session.currentRound?.index ?? 0);
  const seed = mix(session.contentSeed, baseIndex, track.trackId);
  let round: SessionRound;
  try {
    round = await buildSessionRound({ session, track, miniGame, seed, startedAt });
  } catch (err) {
    if (miniGame === "finish_line") throw err;
    // Build failed (e.g. too small a track pool for a trivia round). Try one
    // different playable game before collapsing to finish_line, to keep variety.
    const alt = session.rotation.find(
      (g) => g !== miniGame && g !== "finish_line" && gameReady(session, g, hasRichsync),
    );
    try {
      if (!alt) throw err;
      round = await buildSessionRound({ session, track, miniGame: alt, seed: seed + 101, startedAt });
    } catch {
      round = await buildSessionRound({ session, track, miniGame: "finish_line", seed: seed + 202, startedAt });
    }
  }

  session.status = "playing";
  session.currentRound = round;
  // Warm the bespoke victory sigla now (no-op if already cached / not configured)
  // so it's ready by the time the winners screen mounts at game-over.
  prewarmSigla();
  session.playedGames.push(round.miniGame);
  // Remember this round's source line so the next rounds rotate to fresh lyrics.
  const usedKey = promptKeyFor(round);
  if (usedKey) session.usedPromptKeys = [usedKey, ...session.usedPromptKeys].slice(0, 24);
  session.updatedAt = startedAt;
  return publicState(session);
}

// "On The Beat" proximity: map the player's elapsed time onto the looping karaoke
// cycle and measure the (circular) distance to the drop offset, in ms. Mirrors the
// host's KaraokeTokens cycle so the timing bonus matches what players watch on the TV.
function onBeatProximityMs(drop: FinishLineDrop, elapsedMs: number): number {
  const lastOffset = drop.tokens.length ? drop.tokens[drop.tokens.length - 1].offset : 0;
  const cycle = Math.max(drop.lineDuration, drop.dropOffset + 0.6, lastOffset + 0.6);
  const loopPos = (elapsedMs / 1000) % cycle;
  const raw = Math.abs(loopPos - drop.dropOffset);
  const circular = Math.min(raw, cycle - raw);
  return circular * 1000;
}

export async function submitAnswer(sessionCode: string, input: SubmitAnswerInput) {
  const session = assertSession(sessionCode);
  const round = session.currentRound;
  const player = session.players.find((item) => item.id === input.playerId);
  const guess = input.guess?.trim() ?? "";
  if (!round || session.status !== "playing") throw new Error("round_not_active");
  if (!player) throw new Error("player_not_found");
  if (!guess) throw new Error("empty_guess");
  // Studio Session lets one player rate MANY tracks (one vote per track); every
  // other game is one answer per player. Dedup accordingly.
  const isStudioVote = round.miniGame === "studio_session";
  const sameSlot = (a: SessionAnswer) =>
    a.playerId === player.id && (!isStudioVote || voteTrackId(a.guess) === voteTrackId(guess));
  const existing = round.answers.find(sameSlot);
  if (existing) {
    return { answer: existing, session: publicState(session) };
  }

  const submittedAt = now();
  const limitMs = round.timeLimitMs || ROUND_TIME_LIMIT_MS;
  const elapsedMs = Math.min(Math.max(0, submittedAt - round.startedAt), limitMs);
  // Beat Lock submits a 0..100 timing-accuracy score (computed on the phone)
  // instead of a text/choice answer.
  const isTap = round.answerType === "tap";
  // Voice Clash: the guess is a 0..100 crowd rating. No correct answer; points are
  // tallied at reveal (critic accuracy needs the final crowd average), so 0 now.
  const isJudge = round.answerType === "judge";
  const tapAccuracy = isTap ? Math.max(0, Math.min(100, Number.parseFloat(guess) || 0)) : 0;
  const solution = round.solution ?? "";
  const correct = isTap ? tapAccuracy >= 50 : isJudge ? false : normalizeAnswer(guess) === normalizeAnswer(solution);
  const points = isJudge
    ? 0
    : isTap
      ? Math.round(tapAccuracy * 10)
      : (round.miniGame === "on_beat" || round.miniGame === "the_drop") && round.drop
        ? scoreRound({
            isCorrect: correct,
            elapsedMs,
            streak: correct ? 1 : 0,
            dropProximityMs: onBeatProximityMs(round.drop, elapsedMs),
            timeLimitMs: limitMs,
          }).total
        : scoreFinishLine(correct, elapsedMs, limitMs);
  const answer: SessionAnswer = {
    playerId: player.id,
    playerName: player.name,
    guess,
    correct,
    points,
    elapsedMs,
    submittedAt,
  };

  round.answers.push(answer);
  player.score += points;
  player.lastSeenAt = submittedAt;
  session.updatedAt = submittedAt;
  return { answer, session: publicState(session) };
}

const clampRating = (n: number): number => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

// Studio Session votes carry the rated track: "<trackId>:<rating>". Voice Clash
// votes are a bare "<rating>" (single track). These tolerate both.
function voteTrackId(guess: string): number | null {
  const i = guess.indexOf(":");
  if (i < 0) return null;
  const n = Number(guess.slice(0, i));
  return Number.isInteger(n) ? n : null;
}
function voteRating(guess: string): number {
  const i = guess.indexOf(":");
  return Number.parseFloat(i >= 0 ? guess.slice(i + 1) : guess);
}

// Pay one track's voters + author from a set of ratings: studio score = crowd
// average; each voter earns 150..500 "critic" points for landing near it; the
// author (excluded from rating their own) banks avg*7 (up to 700).
function tallyJudgeVotes(session: PartySession, votes: SessionAnswer[], authorId: string | undefined): number {
  const ratings = votes.map((a) => clampRating(voteRating(a.guess)));
  const avg = ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0;
  for (const answer of votes) {
    const rating = clampRating(voteRating(answer.guess));
    const closeness = Math.max(0, 1 - Math.abs(rating - avg) / 100); // 0..1
    const pts = 150 + Math.round(closeness * 350); // 150..500
    answer.points = pts;
    const player = session.players.find((p) => p.id === answer.playerId);
    if (player) player.score += pts;
  }
  if (authorId) {
    const author = session.players.find((p) => p.id === authorId);
    if (author) author.score += Math.round(avg * 7);
  }
  return Math.round(avg);
}

// Tally a judge round at reveal. Voice Clash = one track (round.creatorPlayerId).
// Studio Session = a carousel: group votes by trackId and score each track
// independently, filling per-track studioScore. Applied once (guarded by status).
function scoreJudgeRound(session: PartySession, round: SessionRound): void {
  const refs = round.studioTracksRef;
  if (refs && refs.length) {
    for (const ref of refs) {
      const votes = round.answers.filter(
        (a) => a.playerId !== ref.playerId && voteTrackId(a.guess) === ref.id,
      );
      ref.studioScore = tallyJudgeVotes(session, votes, ref.playerId);
    }
    // Headline score for the TV = the night's best track.
    round.studioScore = refs.reduce((max, r) => Math.max(max, r.studioScore ?? 0), 0);
    return;
  }
  const votes = round.answers.filter((a) => a.playerId !== round.creatorPlayerId);
  round.studioScore = tallyJudgeVotes(session, votes, round.creatorPlayerId);
}

export function revealRound(sessionCode: string): PublicSessionState {
  const session = assertSession(sessionCode);
  const round = session.currentRound;
  if (round && round.status !== "revealed") {
    if (round.answerType === "judge") scoreJudgeRound(session, round);
    round.status = "revealed";
  }
  session.status = "results";
  session.updatedAt = now();
  return publicState(session);
}

// ---- Voice Clash (Voice Studio) mutations ----------------------------------

// Attach the host's instant voice clone to the session (after IVC + consent).
export function setVoiceClone(
  sessionCode: string,
  entry: { voiceId?: string; label?: string; requiresVerification?: boolean },
): PublicSessionState {
  const session = assertSession(sessionCode);
  if (typeof entry.voiceId === "string" && entry.voiceId) {
    session.voiceClone = {
      voiceId: entry.voiceId,
      label: String(entry.label || "Host voice"),
      requiresVerification: Boolean(entry.requiresVerification),
    };
    session.updatedAt = now();
  }
  return publicState(session);
}

// The next track id the Voice Studio should bake into (stable, monotonic).
export function nextVoiceTrackId(sessionCode: string): number {
  const session = assertSession(sessionCode);
  return (session.voiceTracks.at(-1)?.id ?? 0) + 1;
}

// Register a baked Voice Clash track (beat + host-voice vocal already cached).
export function addVoiceTrack(
  sessionCode: string,
  track: { id: number; vibe?: string; lyric?: string; beatUrl: string; vocalUrl: string; creatorPlayerId?: string; creatorName?: string },
): PublicSessionState {
  const session = assertSession(sessionCode);
  if (track.beatUrl && track.vocalUrl) {
    session.voiceTracks.push({
      id: track.id,
      vibe: String(track.vibe || "boombap"),
      lyric: String(track.lyric || ""),
      beatUrl: track.beatUrl,
      vocalUrl: track.vocalUrl,
      creatorPlayerId: track.creatorPlayerId,
      creatorName: track.creatorName,
    });
    session.updatedAt = now();
  }
  return publicState(session);
}

// Reset the Voice Studio (drop the clone reference + baked tracks). Returns the
// voiceId so the caller can DELETE it at ElevenLabs and clear the audio cache.
export function clearVoiceStudio(sessionCode: string): { session: PublicSessionState; voiceId: string | null } {
  const session = assertSession(sessionCode);
  const voiceId = session.voiceClone?.voiceId ?? null;
  session.voiceClone = null;
  session.voiceTracks = [];
  session.updatedAt = now();
  return { session: publicState(session), voiceId };
}

// ---- Studio Session mutations ----------------------------------------------

// Next track id for a player recording (stable, monotonic across the session).
export function nextStudioTrackId(sessionCode: string): number {
  const session = assertSession(sessionCode);
  return (session.studioTracks.at(-1)?.id ?? 0) + 1;
}

// Register a fresh player recording (state "transcribing"). One track per player:
// a re-record replaces the player's previous track so the listening party never
// shows duplicates for the same person.
export function addStudioTrack(
  sessionCode: string,
  track: { id: number; playerId: string; playerName: string },
): PublicSessionState {
  const session = assertSession(sessionCode);
  session.studioTracks = session.studioTracks.filter((t) => t.playerId !== track.playerId);
  session.studioTracks.push({
    id: track.id,
    playerId: track.playerId,
    playerName: track.playerName,
    state: "transcribing",
  });
  session.updatedAt = now();
  return publicState(session);
}

// Patch a studio track as the background pipeline progresses. Tolerant (no throw):
// it runs fire-and-forget and may resolve after the session changed or vanished.
export function updateStudioTrack(sessionCode: string, id: number, patch: Partial<StudioTrack>): void {
  const session = sessions.get(cleanCode(sessionCode));
  if (!session) return;
  const track = session.studioTracks.find((t) => t.id === id);
  if (!track) return;
  Object.assign(track, patch);
  session.updatedAt = now();
}

// Drop all studio tracks (rematch / teardown). Audio cache is cleared separately
// via studio-session.clearStudioAudio by the caller (route).
export function clearStudioSession(sessionCode: string): PublicSessionState {
  const session = assertSession(sessionCode);
  session.studioTracks = [];
  session.updatedAt = now();
  return publicState(session);
}

// Attach a host-prepared isolated stem to a deck track (Stem Lab → lalal.ai).
// Once >=4 are attached, Stem Heist becomes selectable.
export function setTrackStem(
  sessionCode: string,
  entry: { trackId?: number; trackName?: string; stem?: string; url?: string },
): PublicSessionState {
  const session = assertSession(sessionCode);
  const trackId = Number(entry.trackId);
  if (Number.isInteger(trackId) && trackId > 0 && typeof entry.url === "string" && entry.url) {
    session.trackStems[trackId] = {
      stem: String(entry.stem || "stem"),
      url: entry.url,
      trackName: String(entry.trackName || "Track"),
    };
    session.updatedAt = now();
  }
  return publicState(session);
}

export function setMiniGames(sessionCode: string, ids: MiniGameId[]): PublicSessionState {
  const session = assertSession(sessionCode);
  const ordered = orderMiniGames(ids ?? []);
  if (ordered.length) {
    session.miniGames = ordered;
    // Re-shuffle the rotation to match the new selection, and reset the
    // played-this-cycle tracking so the next match draws cleanly.
    session.rotation = shuffle(ordered);
    session.playedGames = [];
  }
  session.updatedAt = now();
  return publicState(session);
}

export function setSessionRounds(sessionCode: string, rounds: number): PublicSessionState {
  const session = assertSession(sessionCode);
  session.rounds = clampRounds(rounds);
  session.updatedAt = now();
  return publicState(session);
}

export function backToLobby(sessionCode: string): PublicSessionState {
  const session = assertSession(sessionCode);
  session.status = "lobby";
  session.currentRound = null;
  session.updatedAt = now();
  return publicState(session);
}

// "Run it back": reset the scoreboard and return to the lobby for a rematch, KEEPING
// the players, the mini-game selection and any expensive prepared content (voice
// clone + baked tracks, stems). Just zero the scores, clear the finished round, and
// re-shuffle the rotation so the next show plays in a fresh order.
export function restartMatch(sessionCode: string): PublicSessionState {
  const session = assertSession(sessionCode);
  for (const player of session.players) player.score = 0;
  session.currentRound = null;
  session.playedGames = [];
  session.usedPromptKeys = [];
  session.studioTracks = [];
  session.rotation = shuffle(session.miniGames);
  session.status = "lobby";
  session.updatedAt = now();
  return publicState(session);
}
