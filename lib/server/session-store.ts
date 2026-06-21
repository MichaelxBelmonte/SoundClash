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
} from "@/lib/server/music-bed";
import { ROUND_TIME_LIMIT_MS, scoreFinishLine, scoreRound } from "@/lib/game/scoring";
import { getRichsyncLines, getTrackLyrics } from "@/lib/server/musixmatch";
import { DEFAULT_BANTER_PACK, staticBanterPack, type BanterPack } from "@/lib/game/host-banter";
import { normalizeLanguage } from "@/lib/game/languages";
import { avatarForIndex, isPlayerAvatar } from "@/lib/session/avatars";
import { ALL_MINI_GAME_IDS, orderMiniGames } from "@/lib/session/mini-games";
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

  return {
    ...session,
    playerCount: session.players.length,
    players: [...session.players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt),
    currentRound,
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

// A game is playable on a given track only if its data requirement is met:
// audio games need music generation; the_drop / on_beat need richsync timing.
function isPlayable(game: MiniGameId, hasRichsync: boolean): boolean {
  if (GENERATED_AUDIO_GAMES.has(game)) return isMusicGenerationAvailable();
  return !NEEDS_RICHSYNC.has(game) || hasRichsync;
}

// Pick the next mini-game for an autopilot round. Draws from the session's
// shuffled rotation WITHOUT replacement within a cycle, so the 6-round set is
// varied and (with ≥6 games selected) never repeats. When the chosen game needs
// richsync the current track lacks, it substitutes the next *playable, unused*
// game rather than collapsing every such slot onto "finish_line".
function nextMiniGame(session: PartySession, requested: MiniGameId | undefined, hasRichsync: boolean): MiniGameId {
  // Manual override: honor the host's pick (degrading only on richsync mismatch).
  if (requested) return isPlayable(requested, hasRichsync) ? requested : "finish_line";

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
    rotation.find((g) => isPlayable(g, hasRichsync) && !usedThisCycle.has(g) && g !== lastGame) ??
    rotation.find((g) => isPlayable(g, hasRichsync) && !usedThisCycle.has(g)) ??
    rotation.find((g) => isPlayable(g, hasRichsync) && g !== lastGame) ??
    rotation.find((g) => isPlayable(g, hasRichsync)) ??
    "finish_line"
  );
}

function labelsFor(miniGame: MiniGameId) {
  if (miniGame === "name_song") {
    return {
      title: "Name That Song",
      instruction: "Pick the track that contains this lyric.",
    };
  }
  if (miniGame === "next_line") {
    return {
      title: "Next Line",
      instruction: "Pick the line that comes next.",
    };
  }
  if (miniGame === "artist_pick") {
    return {
      title: "Artist Lock",
      instruction: "Pick the artist behind this lyric.",
    };
  }
  if (miniGame === "word_rush") {
    return {
      title: "Word Rush",
      instruction: "Pick the recurring keyword.",
    };
  }
  if (miniGame === "the_drop") {
    return {
      title: "The Drop",
      instruction: "Tap the missing word as the lyric lands.",
    };
  }
  if (miniGame === "on_beat") {
    return {
      title: "On The Beat",
      instruction: "Lock the word right as the beat hits — timing scores.",
    };
  }
  if (miniGame === "mondegreen") {
    return {
      title: "Misheard",
      instruction: "One line is the real lyric. The rest are mondegreens.",
    };
  }
  if (miniGame === "song_mash") {
    return {
      title: "Who Said It",
      instruction: "Which track dropped this line?",
    };
  }
  return {
    title: "Finish the Line",
    instruction: "Tap the missing word.",
  };
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
  const common = {
    index: input.roundIndex,
    miniGame: input.miniGame,
    trackId: input.track.trackId,
    trackName: input.track.trackName,
    artistName: input.track.artistName,
    hasRichsync: input.track.hasRichsync,
    seed: input.seed,
    difficulty: input.tier,
    timeLimitMs: input.diff.timeLimitMs,
    startedAt: input.startedAt,
    endsAt: input.startedAt + input.diff.timeLimitMs,
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

  // Audio games carry no lyrics — build them before any Musixmatch fetch.
  if (input.miniGame === "genre_roulette" || input.miniGame === "beat_lock") {
    return buildAudioRound({
      miniGame: input.miniGame,
      track: input.track,
      roundIndex,
      tier,
      diff,
      seed: input.seed,
      startedAt: input.startedAt,
    });
  }

  const lyrics = await getTrackLyrics(input.track.trackId);
  const labels = labelsFor(input.miniGame);
  const excludeKeys = new Set(input.session.usedPromptKeys);
  const base = {
    index: roundIndex,
    miniGame: input.miniGame,
    title: labels.title,
    instruction: labels.instruction,
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
    return {
      ...base,
      prompt: nextLine.prompt,
      answerType: "choice",
      options: nextLine.options,
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
    return {
      ...base,
      prompt: mondegreen.prompt,
      answerType: "choice",
      options: mondegreen.options,
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

  return {
    ...base,
    prompt,
    answerType: "choice",
    options: generated.options,
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
      (g) => g !== miniGame && g !== "finish_line" && isPlayable(g, hasRichsync),
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
  if (round.answers.some((answer) => answer.playerId === player.id)) {
    return { answer: round.answers.find((answer) => answer.playerId === player.id), session: publicState(session) };
  }

  const submittedAt = now();
  const limitMs = round.timeLimitMs || ROUND_TIME_LIMIT_MS;
  const elapsedMs = Math.min(Math.max(0, submittedAt - round.startedAt), limitMs);
  // Beat Lock submits a 0..100 timing-accuracy score (computed on the phone)
  // instead of a text/choice answer.
  const isTap = round.answerType === "tap";
  const tapAccuracy = isTap ? Math.max(0, Math.min(100, Number.parseFloat(guess) || 0)) : 0;
  const solution = round.solution ?? "";
  const correct = isTap ? tapAccuracy >= 50 : normalizeAnswer(guess) === normalizeAnswer(solution);
  const points = isTap
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

export function revealRound(sessionCode: string): PublicSessionState {
  const session = assertSession(sessionCode);
  if (session.currentRound) session.currentRound.status = "revealed";
  session.status = "results";
  session.updatedAt = now();
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
