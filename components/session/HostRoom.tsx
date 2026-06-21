"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/brand/Button";
import Logo from "@/components/brand/Logo";
import Sticker from "@/components/brand/Sticker";
import AudioConsole from "@/components/session/AudioConsole";
import JoinQr from "@/components/session/JoinQr";
import MiniGameArt from "@/components/session/MiniGameArt";
import MusicPicker from "@/components/session/MusicPicker";
import { MusixmatchTracking } from "@/components/session/MusixmatchTracking";
import Avatar from "@/components/ui/Avatar";
import Icon from "@/components/ui/Icon";
import {
  buildRoastLine,
  finalLine,
  revealAnswerLine,
  revealLeaderLine,
  roundIntroLine,
  roundLabel,
  welcomeLine,
} from "@/lib/game/host-banter";
import { languageName } from "@/lib/game/languages";
import {
  ALL_MINI_GAME_IDS,
  CATEGORY_META,
  COMING_SOON_GAMES,
  MINI_GAME_CATALOG,
  MINI_GAME_CATEGORIES,
  orderMiniGames,
} from "@/lib/session/mini-games";
import type { HostVoicePreset, MiniGameId, PublicSessionState } from "@/lib/session/types";
import type { ErrorResponse, FinishLineDrop, TrackSummary } from "@/lib/types";

const ROUND_OPTIONS = [3, 6, 9];

const SETUP_STEPS = [
  { id: "games" as const, label: "Mini-games" },
  { id: "artists" as const, label: "Music" },
  { id: "lobby" as const, label: "Lobby" },
];
type SetupStep = (typeof SETUP_STEPS)[number]["id"];

// A balanced one-tap starter: one game per category.
const QUICK_SET: MiniGameId[] = ["finish_line", "the_drop", "song_mash"];

// Card styling per category tone — accent line color, banner wash, selected ring,
// category tag, and the check badge. Keeps the JSX tidy and on-brand.
const TONE_STYLES: Record<
  "magenta" | "aqua" | "tangerine",
  { line: string; grad: string; selected: string; tag: string; check: string }
> = {
  magenta: {
    line: "text-brand",
    grad: "linear-gradient(135deg, rgba(194,86,59,0.30), rgba(194,86,59,0.06) 55%, rgba(194,86,59,0) 82%)",
    selected: "border-brand ring-2 ring-brand/40",
    tag: "border-brand/40 bg-brand/10 text-brand",
    check: "bg-brand text-white",
  },
  aqua: {
    line: "text-aqua",
    grad: "linear-gradient(135deg, rgba(46,125,107,0.28), rgba(46,125,107,0.06) 55%, rgba(46,125,107,0) 82%)",
    selected: "border-aqua ring-2 ring-aqua/40",
    tag: "border-aqua/40 bg-aqua/10 text-aqua",
    check: "bg-aqua text-ink",
  },
  tangerine: {
    line: "text-tangerine-600",
    grad: "linear-gradient(135deg, rgba(217,154,60,0.28), rgba(217,154,60,0.06) 55%, rgba(217,154,60,0) 82%)",
    selected: "border-tangerine ring-2 ring-tangerine/40",
    tag: "border-tangerine/40 bg-tangerine/10 text-tangerine-600",
    check: "bg-tangerine text-ink",
  },
};

export default function HostRoom({ code }: { code: string }) {
  const [session, setSession] = useState<PublicSessionState | null>(null);
  const [loadingTrackId, setLoadingTrackId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [setupStep, setSetupStep] = useState<SetupStep>("games");
  const [showSoon, setShowSoon] = useState(false);
  const [deck, setDeck] = useState<TrackSummary[]>([]);
  const [hostVolume, setHostVolume] = useState(1);
  const [hostMuted, setHostMuted] = useState(false);
  const spokenEvents = useRef(new Set<string>());
  const speakingRef = useRef(false);
  const speechQueue = useRef<{ text: string; preset?: HostVoicePreset }[]>([]);
  // A single, reused <audio> element: at most one host-voice clip can ever play,
  // so rapid round skips can never stack two voices. The AbortController cancels
  // any in-flight /api/host/speak fetch when we interrupt.
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const speechGenRef = useRef(0);
  const hostVolumeRef = useRef(1);
  const hostMutedRef = useRef(false);

  useEffect(() => {
    hostVolumeRef.current = hostVolume;
    hostMutedRef.current = hostMuted;
    if (audioElRef.current) audioElRef.current.volume = hostMuted ? 0 : hostVolume;
  }, [hostVolume, hostMuted]);

  const joinUrl = useMemo(() => {
    if (typeof window === "undefined") return `/join?code=${code}`;
    return `${window.location.origin}/join?code=${code}`;
  }, [code]);

  const loadSession = useCallback(async () => {
    const response = await fetch(`/api/sessions/${code}`, { cache: "no-store" });
    const payload = (await response.json()) as { session?: PublicSessionState; error?: string };
    if (!response.ok || !payload.session) throw new Error(payload.error ?? "Session not found");
    setSession(payload.session);
  }, [code]);

  useEffect(() => {
    void loadSession().catch((err) => setError(err instanceof Error ? err.message : "Session not found"));
    const timer = window.setInterval(() => {
      void loadSession().catch(() => {});
    }, 1200);
    return () => window.clearInterval(timer);
  }, [loadSession]);

  // Stop the host voice when leaving the room — otherwise queued/playing lines
  // keep talking after you navigate away or close the show.
  useEffect(() => {
    return () => {
      teardownSpeech();
      window.dispatchEvent(new CustomEvent("soundclash:duck", { detail: { active: false } }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(track: TrackSummary, deckArg: TrackSummary[] = deck) {
    setLoadingTrackId(track.trackId);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${code}/round`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auto: true,
          trackId: track.trackId,
          trackName: track.trackName,
          artistName: track.artistName,
          hasRichsync: track.hasRichsync,
          deck: deckArg.map((item) => ({
            trackId: item.trackId,
            trackName: item.trackName,
            artistName: item.artistName,
            hasRichsync: item.hasRichsync,
          })),
        }),
      });
      const payload = (await response.json()) as { session?: PublicSessionState; error?: string };
      if (!response.ok || !payload.session) throw new Error(payload.error ?? "Could not start show");
      setSession(payload.session);
      speakNow(roundIntroLine(payload.session.currentRound?.title ?? "Lyric game", 0, payload.session.banter));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start show");
    } finally {
      setLoadingTrackId(null);
    }
  }

  function toggleDeck(track: TrackSummary) {
    setDeck((prev) =>
      prev.some((item) => item.trackId === track.trackId)
        ? prev.filter((item) => item.trackId !== track.trackId)
        : prev.length >= 8
          ? prev
          : [...prev, track],
    );
  }

  // Merge a batch of tracks into the setlist (dedupe by id, cap at 8).
  function addManyToDeck(tracks: TrackSummary[]) {
    setDeck((prev) => {
      const next = [...prev];
      for (const track of tracks) {
        if (next.length >= 8) break;
        if (!next.some((item) => item.trackId === track.trackId)) next.push(track);
      }
      return next;
    });
  }

  async function configureRounds(rounds: number) {
    try {
      const response = await fetch(`/api/sessions/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rounds", rounds }),
      });
      const payload = (await response.json()) as { session?: PublicSessionState };
      if (payload.session) setSession(payload.session);
    } catch {
      // Polling will resync if this fails.
    }
  }

  async function patchSession(actionName: "reveal" | "lobby") {
    const response = await fetch(`/api/sessions/${code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionName }),
    });
    const payload = (await response.json()) as { session?: PublicSessionState };
    if (payload.session) setSession(payload.session);
  }

  // Leaving a live round back to the lobby must also silence the host.
  function goToLobby() {
    stopSpeaking();
    void patchSession("lobby");
  }

  async function configureGames(next: MiniGameId[]) {
    if (next.length === 0) return;
    try {
      const response = await fetch(`/api/sessions/${code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "configure", miniGames: next }),
      });
      const payload = (await response.json()) as { session?: PublicSessionState };
      if (payload.session) setSession(payload.session);
    } catch {
      // Polling will resync the selection if this fails.
    }
  }

  async function startNextAutoRound() {
    const active = session?.currentRound;
    if (!active || !session) return;
    // Rotate through the seeded deck so each round uses a different track — this
    // varies the lyrics and makes the "which song?" rounds meaningful.
    const pool = session.trackPool;
    const next = pool.length ? pool[active.index % pool.length] : null;
    const track = next ?? {
      trackId: active.trackId,
      trackName: active.trackName,
      artistName: active.artistName,
      hasRichsync: active.hasRichsync,
    };
    const response = await fetch(`/api/sessions/${code}/round`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auto: true,
        trackId: track.trackId,
        trackName: track.trackName,
        artistName: track.artistName,
        hasRichsync: track.hasRichsync,
      }),
    });
    const payload = (await response.json()) as { session?: PublicSessionState };
    if (payload.session) {
      setSession(payload.session);
      speakNow(
        roundIntroLine(
          payload.session.currentRound?.title ?? "Lyric game",
          payload.session.currentRound?.index ?? 0,
          payload.session.banter,
        ),
      );
    }
  }

  useEffect(() => {
    const active = session?.currentRound;
    if (!active || session.status !== "playing" || active.status !== "answering") return;
    if (session.players.length === 0 || active.answers.length < session.players.length) return;
    const timer = window.setTimeout(() => void patchSession("reveal"), 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.currentRound?.answers.length, session?.currentRound?.status, session?.players.length, session?.status]);

  useEffect(() => {
    const active = session?.currentRound;
    if (!active || session.status !== "playing" || active.status !== "answering") return;
    const delay = Math.max(800, active.endsAt - Date.now() + 500);
    const timer = window.setTimeout(() => void patchSession("reveal"), delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.currentRound?.endsAt, session?.currentRound?.status, session?.status]);

  useEffect(() => {
    const active = session?.currentRound;
    if (!active || session.status !== "results" || active.status !== "revealed") return;
    if (active.index >= session.rounds) {
      void speakHost(finalLine(session.players[0]?.name, session.banter));
      return;
    }
    const timer = window.setTimeout(() => void startNextAutoRound(), 5200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.currentRound?.index, session?.currentRound?.status, session?.status]);

  useEffect(() => {
    const active = session?.currentRound;
    if (!active || session.status !== "results" || active.status !== "revealed" || speaking) return;
    const key = `reveal:${active.index}:${active.solution ?? ""}`;
    if (spokenEvents.current.has(key)) return;
    spokenEvents.current.add(key);
    // Keep it to ONE short line at the reveal — a single roast, or just the answer.
    // The leaderboard and round number are already on screen, so the host stays quiet.
    const roast = buildRoastLine(active, session.banter);
    if (roast) {
      void speakHost(roast, "judge");
    } else {
      void speakHost(revealAnswerLine(active.solution, session.banter));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.currentRound?.index, session?.currentRound?.solution, session?.status, speaking]);

  function copyJoin() {
    void navigator.clipboard?.writeText(joinUrl).then(() => setCopied(true)).catch(() => {});
  }

  // Host voice is queued, never overlapped: each line plays in turn, ducking the
  // music while it speaks and un-ducking once the queue drains. Stop clears it all.
  function finishSpeech() {
    if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
    currentUrlRef.current = null;
    speakingRef.current = false;
    setSpeaking(false);
    void playNextSpeech();
  }

  async function playNextSpeech() {
    if (speakingRef.current || !session) return;
    const next = speechQueue.current.shift();
    if (!next) {
      window.dispatchEvent(new CustomEvent("soundclash:duck", { detail: { active: false } }));
      return;
    }
    const gen = speechGenRef.current;
    speakingRef.current = true;
    setSpeaking(true);
    setSpeechError(null);
    window.dispatchEvent(new CustomEvent("soundclash:duck", { detail: { active: true } }));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/host/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset: next.preset ?? session.voice.preset,
          voiceId: next.preset ? undefined : session.voice.voiceId,
          languageCode: session.narratorLang,
          text: next.text,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Speech failed");
      const blob = await response.blob();
      if (gen !== speechGenRef.current) return; // interrupted while loading
      const url = URL.createObjectURL(blob);
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = url;
      // Reuse the single audio element. Clearing handlers + pausing before we
      // re-point .src prevents a stale "ended"/"error" from the previous clip.
      const audio = audioElRef.current ?? (audioElRef.current = new Audio());
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        // ignore: pausing a not-yet-started element is a no-op
      }
      audio.src = url;
      audio.currentTime = 0;
      audio.volume = hostMutedRef.current ? 0 : hostVolumeRef.current;
      audio.onended = () => finishSpeech();
      audio.onerror = () => finishSpeech();
      await audio.play();
      // The round may have advanced while play() was resolving; teardownSpeech
      // already paused the element, so just bail without touching playback state.
      if (gen !== speechGenRef.current) return;
    } catch (err) {
      if (controller.signal.aborted || gen !== speechGenRef.current) return;
      setSpeechError(err instanceof Error ? err.message : "Could not play host voice.");
      finishSpeech();
    }
  }

  function speakHost(text: string, presetOverride?: HostVoicePreset) {
    const clean = text.trim();
    if (!clean) return;
    speechQueue.current.push({ text: clean, preset: presetOverride });
    if (speechQueue.current.length > 3) speechQueue.current.splice(0, speechQueue.current.length - 3);
    if (!speakingRef.current) void playNextSpeech();
  }

  // Stop everything currently in the audio pipeline without un-ducking logic
  // running through finishSpeech. Shared by stop, round changes and unmount.
  function teardownSpeech() {
    speechGenRef.current += 1; // invalidates any in-flight fetch/playback
    speechQueue.current = [];
    abortRef.current?.abort();
    abortRef.current = null;
    const audio = audioElRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        // ignore
      }
    }
    if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
    currentUrlRef.current = null;
    speakingRef.current = false;
  }

  // Interrupt whatever is playing and speak this line immediately — used on round
  // changes so the host never talks over the start of the next round.
  function speakNow(text: string, presetOverride?: HostVoicePreset) {
    const clean = text.trim();
    if (!clean) return;
    teardownSpeech();
    setSpeaking(false);
    speechQueue.current = [{ text: clean, preset: presetOverride }];
    void playNextSpeech();
  }

  function stopSpeaking() {
    teardownSpeech();
    setSpeaking(false);
    window.dispatchEvent(new CustomEvent("soundclash:duck", { detail: { active: false } }));
  }

  function speakIntro() {
    if (!session) return;
    speakHost(welcomeLine(session.code, session.players.length, session.banter));
  }

  const playerCount = session?.players.length ?? 0;

  if (error && !session) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-xl flex-col items-center justify-center px-4 text-center">
        <Logo href="/" className="h-8 sm:h-10" withMark markClassName="h-10 w-10" />
        <p className="mt-6 text-sm text-brand">{error}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/host/new"
            className="flex h-11 items-center justify-center rounded-md bg-brand px-5 text-sm font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-brand-400"
          >
            Create a new room
          </Link>
          <Link
            href="/"
            className="flex h-11 items-center justify-center rounded-md border border-black/10 px-5 text-sm font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:border-black/15 hover:text-ink"
          >
            Home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-5 lg:shrink-0">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-brand">Host screen</p>
          <h1 className="mt-2">
            <Logo href="/" className="h-9 sm:h-12" withMark markClassName="h-9 w-9 sm:h-11 sm:w-11" />
          </h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-[0.55rem] uppercase tracking-[0.22em] text-black/40">Room</p>
          <p className="font-mono text-2xl font-semibold uppercase tracking-[0.2em] text-aqua sm:text-3xl">{code}</p>
        </div>
      </header>
      {speechError ? <p className="mt-3 text-xs text-brand">{speechError}</p> : null}

      <div className="mt-4 lg:shrink-0">
        <AudioConsole
          hostVolume={hostVolume}
          hostMuted={hostMuted}
          speaking={speaking}
          onHostVolume={setHostVolume}
          onToggleHostMute={() => setHostMuted((value) => !value)}
          onStopSpeech={stopSpeaking}
          onSpeakIntro={() => void speakIntro()}
        />
      </div>

      {session?.status === "playing" || session?.status === "results" ? (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr]">
          <aside>
            <section className="rounded-2xl border border-black/10 bg-paper-raised p-4">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-black/45">Scoreboard</p>
              <div className="mt-3 grid gap-2">
                {session.players.length ? (
                  session.players.map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center gap-2 rounded-md border border-black/10 bg-black/[0.04] px-2 py-2"
                    >
                      <Avatar name={player.name} emoji={player.avatar} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{player.name}</span>
                      <span className="font-mono text-xs tabular-nums text-black/55">{player.score}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-black/45">No players yet.</p>
                )}
              </div>
            </section>
          </aside>
          <section className="rounded-2xl border border-black/10 bg-paper-raised p-4 sm:p-5">
            <HostRound
              session={session}
              onReveal={() => void patchSession("reveal")}
              onNext={() => void startNextAutoRound()}
              onLobby={goToLobby}
            />
          </section>
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-2">
            {SETUP_STEPS.map((step, index) => {
              const currentIndex = SETUP_STEPS.findIndex((s) => s.id === setupStep);
              const isCurrent = step.id === setupStep;
              const done = index < currentIndex;
              const reachable = index <= currentIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  disabled={!reachable}
                  onClick={() => reachable && setSetupStep(step.id)}
                  className={[
                    "inline-flex items-center gap-2 rounded-full border px-3.5 py-2.5 transition-colors",
                    isCurrent
                      ? "border-brand bg-brand/10 text-brand"
                      : done
                        ? "border-aqua/40 text-aqua hover:border-aqua"
                        : "cursor-not-allowed border-black/10 text-black/35",
                  ].join(" ")}
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-current font-mono text-[0.65rem]">
                    {done ? "✓" : index + 1}
                  </span>
                  <span className="font-condensed text-sm uppercase tracking-[0.08em]">{step.label}</span>
                </button>
              );
            })}
          </div>

          {setupStep === "games" && session ? (
            <section className="mt-5 lg:mt-6">
              <div className="flex flex-wrap items-center gap-3">
                <Sticker tone="aqua" rotate={-4}>
                  Step 1
                </Sticker>
                <div className="min-w-0">
                  <p className="font-condensed text-xl uppercase leading-tight tracking-[0.02em] text-ink">
                    Choose mini-games
                  </p>
                  <p className="text-xs text-black/45">Tap a card to add it to the rotation. Keep at least one.</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void configureGames(ALL_MINI_GAME_IDS)}
                  className="rounded-full border border-black/10 px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-black/70 transition-colors hover:border-aqua hover:text-aqua"
                >
                  All 9
                </button>
                <button
                  type="button"
                  onClick={() => void configureGames(orderMiniGames(QUICK_SET))}
                  className="rounded-full border border-black/10 px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-black/70 transition-colors hover:border-aqua hover:text-aqua"
                >
                  Quick 3
                </button>
                <span className="ml-auto rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-brand">
                  {session.miniGames.length} of {MINI_GAME_CATALOG.length} on
                </span>
              </div>

              {/* One horizontal scrolling line of all games — ordered by category for
                  colour rhythm — keeps the picker to a single shallow row. Scrollbar is
                  hidden; the peeking cards + right-edge fade are the scroll affordance. */}
              <div className="relative mt-3 -mx-4 sm:-mx-6 lg:mx-0">
                <div data-games-row className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:px-6 lg:px-0">
                  {MINI_GAME_CATEGORIES.flatMap((category) =>
                    MINI_GAME_CATALOG.filter((game) => game.category === category),
                  ).map((game) => {
                    const meta = CATEGORY_META[game.category];
                    const tone = TONE_STYLES[meta.tone];
                    const selected = session.miniGames.includes(game.id);
                    const isLast = selected && session.miniGames.length === 1;
                    return (
                      <button
                        key={game.id}
                        type="button"
                        disabled={isLast}
                        onClick={() =>
                          void configureGames(
                            selected
                              ? session.miniGames.filter((id) => id !== game.id)
                              : [...session.miniGames, game.id],
                          )
                        }
                        aria-pressed={selected}
                        title={isLast ? "Keep at least one game in the rotation" : undefined}
                        className={[
                          "group relative flex w-32 shrink-0 snap-start flex-col overflow-hidden rounded-xl border text-left transition-all disabled:cursor-not-allowed sm:w-36",
                          selected ? tone.selected : "border-black/10 hover:border-black/15",
                        ].join(" ")}
                      >
                        <div
                          className="relative aspect-square w-full overflow-hidden bg-black/[0.03]"
                          style={{ backgroundImage: tone.grad }}
                        >
                          {game.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={game.image}
                              alt=""
                              className="h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <MiniGameArt
                              id={game.id}
                              className={[
                                "h-full w-full p-4 transition-opacity",
                                tone.line,
                                selected ? "opacity-100" : "opacity-70 group-hover:opacity-100",
                              ].join(" ")}
                            />
                          )}
                          {/* Simple explanation — revealed on hover only; the face stays title-clean. */}
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 via-ink/65 to-transparent px-2.5 pb-2 pt-7 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            <span className="block text-[0.66rem] font-medium leading-snug text-cream">
                              {game.example}
                            </span>
                          </div>
                          <span
                            className={[
                              "absolute left-2 top-2 rounded-full px-1.5 py-0.5 font-mono text-[0.5rem] uppercase tracking-[0.12em]",
                              tone.tag,
                            ].join(" ")}
                          >
                            {meta.label}
                          </span>
                          {selected ? (
                            <span
                              className={[
                                "absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full",
                                tone.check,
                              ].join(" ")}
                            >
                              <Icon name="check" size={12} />
                            </span>
                          ) : null}
                        </div>
                        <div className="p-2.5">
                          <span
                            className={[
                              "font-condensed text-sm uppercase leading-tight tracking-[0.03em]",
                              selected ? "text-ink" : "text-black/70",
                            ].join(" ")}
                          >
                            {game.name}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {/* Minimal scroll arrows — the affordance for scrolling the row without a
                    scrollbar. No edge fades: they dimmed the first/last card at rest. */}
                <button
                  type="button"
                  aria-label="Scroll games left"
                  onClick={(e) => {
                    const row = e.currentTarget.parentElement?.querySelector("[data-games-row]") as HTMLElement | null;
                    row?.scrollBy({ left: -340, behavior: "smooth" });
                  }}
                  className="absolute left-1 top-[42%] grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-black/10 bg-paper-raised/95 text-ink shadow-[0_2px_10px_-3px_rgba(0,0,0,0.3)] backdrop-blur transition hover:border-black/25 hover:bg-paper-raised active:scale-95 sm:left-2"
                >
                  <Icon name="chevronLeft" size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Scroll games right"
                  onClick={(e) => {
                    const row = e.currentTarget.parentElement?.querySelector("[data-games-row]") as HTMLElement | null;
                    row?.scrollBy({ left: 340, behavior: "smooth" });
                  }}
                  className="absolute right-1 top-[42%] grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-black/10 bg-paper-raised/95 text-ink shadow-[0_2px_10px_-3px_rgba(0,0,0,0.3)] backdrop-blur transition hover:border-black/25 hover:bg-paper-raised active:scale-95 sm:right-2"
                >
                  <Icon name="chevronLeft" size={16} className="rotate-180" />
                </button>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowSoon((value) => !value)}
                  aria-expanded={showSoon}
                  className="flex w-full items-center justify-between rounded-lg border border-dashed border-black/10 px-3 py-3 text-left transition-colors hover:border-black/15"
                >
                  <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-black/45">
                    Coming soon · {COMING_SOON_GAMES.length}
                  </span>
                  <Icon
                    name="chevronLeft"
                    size={14}
                    className={["text-black/45 transition-transform", showSoon ? "rotate-90" : "-rotate-90"].join(" ")}
                  />
                </button>
                {showSoon ? (
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                    {COMING_SOON_GAMES.map((game) => (
                      <div
                        key={game.id}
                        aria-disabled
                        className="rounded-xl border border-dashed border-black/10 bg-black/[0.03] p-3 opacity-70"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-condensed text-sm uppercase tracking-[0.03em] text-black/55">
                            {game.name}
                          </span>
                          <span className="rounded-full border border-black/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-[0.15em] text-black/45">
                            Soon
                          </span>
                        </div>
                        <p className="mt-1 text-[0.7rem] leading-tight text-black/35">{game.blurb}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div
                className="sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-black/10 bg-paper/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none"
                style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
              >
                <div className="min-w-0">
                  <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-black/45">In rotation</p>
                  <p className="font-condensed text-base uppercase leading-none tracking-[0.04em] text-ink">
                    {session.miniGames.length} {session.miniGames.length === 1 ? "game" : "games"}
                  </p>
                </div>
                <Button onClick={() => setSetupStep("artists")}>Next · Artists →</Button>
              </div>
            </section>
          ) : null}

          {setupStep === "artists" ? (
            <section className="mt-5 lg:mt-6">
              <div className="flex flex-wrap items-center gap-3">
                <Sticker tone="magenta" rotate={-4}>
                  Step 2
                </Sticker>
                <div className="min-w-0">
                  <p className="font-condensed text-xl uppercase leading-tight tracking-[0.02em] text-ink">
                    Pick the music
                  </p>
                  <p className="text-xs text-black/45">
                    Add tracks by artist, genre, or song. BEATBOT draws from these each round.
                  </p>
                </div>
                <span className="ml-auto rounded-full border border-aqua/40 bg-aqua/10 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-aqua">
                  {deck.length}/8 tracks
                </span>
              </div>

              <div className="mt-4">
                <MusicPicker
                  deck={deck}
                  selectedGames={session?.miniGames ?? []}
                  onToggle={toggleDeck}
                  onAddMany={addManyToDeck}
                />
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <Button variant="outlineLight" onClick={() => setSetupStep("games")}>
                  ← Back
                </Button>
                <Button onClick={() => setSetupStep("lobby")} disabled={deck.length === 0}>
                  Next · Lobby →
                </Button>
              </div>
            </section>
          ) : null}

          {setupStep === "lobby" ? (
            // One connected panel — JOIN + PLAYERS on top, START below — so the flow
            // reads logically (get a code → players join → start) instead of loose boxes.
            <section className="mt-5 overflow-hidden rounded-2xl border border-black/10 bg-paper-raised lg:mt-6">
              <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr]">
                {/* JOIN */}
                <div className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
                  <JoinQr url={joinUrl} size={132} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-aqua">
                      Scan to join — or enter the code
                    </p>
                    <p className="led mt-1 text-5xl font-bold leading-none tracking-[0.12em] sm:text-6xl">{code}</p>
                    <button
                      type="button"
                      onClick={copyJoin}
                      className="mt-3 inline-flex h-9 items-center rounded-lg border border-black/10 px-3.5 font-mono text-xs uppercase tracking-[0.14em] text-black/70 transition-colors hover:border-aqua hover:text-aqua"
                    >
                      {copied ? "Link copied ✓" : "Copy join link"}
                    </button>
                  </div>
                </div>

                {/* PLAYERS */}
                <div className="border-t border-black/10 p-5 sm:p-6 lg:border-l lg:border-t-0">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-black/45">In the room</p>
                    <span className="font-mono text-sm tabular-nums text-aqua">{playerCount}</span>
                  </div>
                  {playerCount ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {session?.players.map((player) => (
                        <span
                          key={player.id}
                          className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/[0.04] py-1 pl-1 pr-3"
                        >
                          <Avatar name={player.name} emoji={player.avatar} size="sm" />
                          <span className="max-w-[8rem] truncate text-sm text-ink">{player.name}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2.5 text-tangerine-600">
                      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-tangerine" aria-hidden />
                      <p className="text-sm">Waiting for players to join…</p>
                    </div>
                  )}
                </div>
              </div>

              {/* START */}
              <div className="border-t border-black/10 bg-black/[0.02] p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-black/45">Rounds</p>
                    <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-black/10">
                      {ROUND_OPTIONS.map((n, i) => {
                        const active = (session?.rounds ?? 6) === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => void configureRounds(n)}
                            aria-pressed={active}
                            className={[
                              "h-10 w-12 font-condensed text-base transition-colors",
                              i > 0 ? "border-l border-black/10" : "",
                              active ? "bg-brand/10 text-brand" : "bg-white text-black/55 hover:text-ink",
                            ].join(" ")}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-black/45">
                      {session?.miniGames.length ?? 0} mini-game{(session?.miniGames.length ?? 0) === 1 ? "" : "s"} · {deck.length}{" "}
                      track{deck.length === 1 ? "" : "s"} ready
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-64">
                    <Button
                      variant="magenta"
                      full
                      onClick={() => {
                        if (deck[0]) void start(deck[0], deck);
                      }}
                      disabled={deck.length === 0 || loadingTrackId !== null}
                    >
                      {loadingTrackId !== null ? "Starting…" : "Start show ▶"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setSetupStep("artists")}
                      className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-black/45 transition-colors hover:text-ink"
                    >
                      ← Edit setlist
                    </button>
                  </div>
                </div>

                {/* Emphasis: ideally wait for a player, but starting solo is fine for a demo. */}
                <div className="mt-4 flex items-center gap-2.5 border-t border-black/10 pt-4">
                  {playerCount === 0 ? (
                    <>
                      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-tangerine" aria-hidden />
                      <p className="text-sm text-black/60">
                        <span className="font-semibold text-tangerine-600">Wait for at least one player</span> to join before you start —
                        you can still start solo for a demo.
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="h-2 w-2 shrink-0 rounded-full bg-aqua" aria-hidden />
                      <p className="text-sm text-black/60">
                        <span className="font-semibold text-aqua">{playerCount} player{playerCount === 1 ? "" : "s"} ready</span> — start when you are.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}

function HostRound({
  session,
  onReveal,
  onNext,
  onLobby,
}: {
  session: PublicSessionState;
  onReveal: () => void;
  onNext: () => void;
  onLobby: () => void;
}) {
  const active = session.currentRound;
  const prompt = active?.prompt ?? "Loading mini-game";
  const complete = (active?.index ?? 0) >= session.rounds && active?.status === "revealed";
  const remainingMs = useRemainingMs(active?.endsAt ?? 0, active?.status === "answering");
  const durationMs = active ? Math.max(1, active.endsAt - active.startedAt) : 1;
  const remainingRatio = Math.max(0, Math.min(1, remainingMs / durationMs));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand">
            {active?.title ?? "Guided round"}
          </p>
          {active?.audioUrl ? null : (
            <>
              <h2 className="mt-2 text-2xl font-bold text-ink">{active?.trackName}</h2>
              <p className="text-sm text-black/45">{active?.artistName}</p>
            </>
          )}
          <p className="mt-2 text-sm text-black/55">{active?.instruction}</p>
        </div>
        <div className="grid gap-2 rounded-md border border-black/10 bg-black/[0.04] px-3 py-2 md:min-w-44">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-black/45">
              Round
            </p>
            <p className="font-mono text-2xl text-ink">
              {active?.index ?? 0}/{session.rounds}
            </p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
            <div className="h-full bg-brand transition-[width] duration-200" style={{ width: `${remainingRatio * 100}%` }} />
          </div>
          <p className="text-right font-mono text-xs tabular-nums text-black/45">
            {active?.status === "answering" ? `${Math.ceil(remainingMs / 1000)}s` : "reveal"}
          </p>
        </div>
      </div>

      {active?.audioUrl ? <AudioRoundStage round={active} /> : null}

      {active && active.prompt ? (
        <p className="mt-10 text-4xl font-semibold leading-tight text-ink sm:text-6xl">
          <HostPrompt round={active} />
        </p>
      ) : !active ? (
        <p className="mt-10 text-4xl font-semibold leading-tight text-ink sm:text-6xl">{prompt}</p>
      ) : null}

      {active?.answerType === "choice" && active.options?.length ? (
        <div className={active.miniGame === "mondegreen" ? "mt-6 grid gap-2" : "mt-6 grid gap-2 sm:grid-cols-2"}>
          {active.options.map((option, index) => (
            <div
              key={option}
              className={[
                "rounded-md border border-black/10 bg-black/[0.04] px-4 py-3 text-black/70",
                active.miniGame === "mondegreen" ? "text-lg sm:text-2xl" : "text-sm",
              ].join(" ")}
            >
              <span className="mr-2 font-mono text-black/35">{index + 1}</span>
              {active.status === "revealed" && option === active.solution ? (
                <span className="text-aqua-600">{option}</span>
              ) : (
                option
              )}
            </div>
          ))}
        </div>
      ) : null}

      {active?.copyright ? (
        <>
          <MusixmatchTracking roundKey={`${session.code}:${active.index}:${active.trackId}`} tracking={active.tracking} />
          <p className="mt-8 max-w-2xl text-xs leading-5 text-black/45">{active.copyright}</p>
        </>
      ) : null}

      {active?.status === "revealed" ? (
        <div className="mt-6 rounded-md border border-black/10 bg-black/[0.04] p-4">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-black/45">
            {complete ? "Final scoreboard" : "Round scoreboard"}
          </p>
          {active.solution ? (
            <p className="mt-2 text-sm text-black/55">
              Answer: <span className="text-ink">{active.solution}</span>
            </p>
          ) : null}
          <div className="mt-3 grid gap-2">
            {active.answers.map((answer) => (
              <div key={answer.playerId} className="grid grid-cols-[1fr_auto] gap-3 text-sm">
                <span className={answer.correct ? "text-aqua-600" : "text-black/55"}>
                  {answer.playerName} · {answer.guess}
                </span>
                <span className="font-mono tabular-nums text-ink">{answer.points}</span>
              </div>
            ))}
            {active.answers.length === 0 ? (
              <p className="text-sm text-black/45">No locks this round.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {active?.status === "answering" ? (
          <button
            type="button"
            onClick={onReveal}
            className="flex h-11 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-400"
          >
            <Icon name="check" size={16} />
            Reveal now
          </button>
        ) : !complete ? (
          <button
            type="button"
            onClick={onNext}
            className="flex h-11 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-400"
          >
            <Icon name="shuffle" size={16} />
            Next auto round
          </button>
        ) : null}
        <button
          type="button"
          onClick={onLobby}
          className="h-11 rounded-md border border-black/10 px-4 text-sm font-semibold text-black/70 transition-colors hover:border-black/15 hover:text-ink"
        >
          Back to lobby
        </button>
      </div>
    </div>
  );
}

// Plays the generated instrumental bed for an audio round on the shared TV.
function AudioRoundStage({ round }: { round: NonNullable<PublicSessionState["currentRound"]> }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playing = round.status === "answering";
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !round.audioUrl) return;
    if (el.getAttribute("data-src") !== round.audioUrl) {
      el.src = round.audioUrl;
      el.setAttribute("data-src", round.audioUrl);
      el.load();
    }
    el.volume = 0.7;
    if (playing) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
    return () => el.pause();
  }, [round.audioUrl, playing]);
  return (
    <div className="mt-8 flex items-center gap-4 rounded-md border border-black/10 bg-black/[0.04] px-5 py-4">
      <audio ref={audioRef} loop preload="auto" />
      <span
        aria-hidden
        className={[
          "inline-block h-6 w-6 shrink-0 rounded-full",
          round.bpm ? "bg-brand" : "border-2 border-brand border-t-transparent",
          playing ? (round.bpm ? "animate-pulse" : "animate-spin") : "",
        ].join(" ")}
      />
      <div>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-black/45">Now playing</p>
        <p className="text-lg font-semibold text-ink">
          {round.bpm ? `Tap on the beat · ${round.bpm} BPM` : "Name the vibe"}
        </p>
      </div>
    </div>
  );
}

function HostPrompt({ round }: { round: NonNullable<PublicSessionState["currentRound"]> }) {
  const hasBlank = round.prompt.includes("_____");
  const [before, after = ""] = round.prompt.split("_____");

  if (!hasBlank) return round.prompt;

  return (
    <>
      {round.drop && round.status === "answering" ? <KaraokeTokens drop={round.drop} /> : before}
      <span className="mx-2 inline-flex min-w-[5rem] justify-center rounded border-b-4 border-brand px-3 font-mono text-brand">
        {round.status === "revealed" && round.solution ? round.solution : "_____"}
      </span>
      {after}
    </>
  );
}

function useRemainingMs(endsAt: number, active: boolean): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, endsAt - Date.now()));

  useEffect(() => {
    if (!active) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, endsAt - Date.now()));
    tick();
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [active, endsAt]);

  return remaining;
}

function dropCycle(drop: FinishLineDrop): number {
  const lastOffset = drop.tokens.length ? drop.tokens[drop.tokens.length - 1].offset : 0;
  return Math.max(drop.lineDuration, drop.dropOffset + 0.6, lastOffset + 0.6);
}

function KaraokeTokens({ drop }: { drop: FinishLineDrop }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const cycle = dropCycle(drop);
    const timer = window.setInterval(() => {
      setElapsed(((Date.now() - startedAt) / 1000) % cycle);
    }, 80);
    return () => window.clearInterval(timer);
  }, [drop]);

  let activeIndex = -1;
  for (let i = 0; i < drop.tokens.length; i++) {
    if (drop.tokens[i].offset <= elapsed) activeIndex = i;
  }

  return (
    <>
      {drop.tokens.map((token, index) => (
        <span
          key={index}
          className={[
            "transition-colors duration-150",
            index === activeIndex ? "text-brand" : index < activeIndex ? "text-ink" : "text-black/35",
          ].join(" ")}
        >
          {token.text.trim()}
          {index < drop.tokens.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}
