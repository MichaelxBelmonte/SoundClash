"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Button from "@/components/brand/Button";
import JCard from "@/components/brand/JCard";
import Sticker from "@/components/brand/Sticker";
import Avatar from "@/components/ui/Avatar";
import CountdownRing from "@/components/session/CountdownRing";
import PlayerResultCard from "@/components/session/PlayerResultCard";
import StudioRecordPad from "@/components/session/StudioRecordPad";
import { MusixmatchCredit } from "@/components/session/MusixmatchTracking";
import { needsPlayerVoice } from "@/lib/session/mini-games";
import { useCountUp } from "@/lib/client/useCountUp";
import { copy } from "@/lib/i18n";
import type { PublicSessionState, SessionAnswer } from "@/lib/session/types";

const FIELD =
  "h-14 w-full rounded-xl border border-black/15 bg-white px-4 text-xl text-[#15120E] outline-none transition-colors placeholder:text-black/35 focus:border-[#C2563B] focus:shadow-[0_0_0_3px_rgba(194,86,59,0.15)]";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// A short buzz for tactile feedback. A harmless no-op where Vibration isn't
// supported (iOS Safari, desktop), and silenced under prefers-reduced-motion.
function haptic(pattern: number | number[]): void {
  if (prefersReducedMotion()) return;
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

export default function PlayerRoom({ code }: { code: string }) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [session, setSession] = useState<PublicSessionState | null>(null);
  const [guess, setGuess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlayerId(window.localStorage.getItem(`soundclash-player-${code}`));
  }, [code]);

  const loadSession = useCallback(async () => {
    const suffix = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
    const response = await fetch(`/api/sessions/${code}${suffix}`, { cache: "no-store" });
    const payload = (await response.json()) as { session?: PublicSessionState; error?: string };
    if (!response.ok || !payload.session) throw new Error(payload.error ?? "Session not found");
    setSession(payload.session);
  }, [code, playerId]);

  useEffect(() => {
    if (!playerId) return;
    void loadSession().catch((err) => setError(err instanceof Error ? err.message : "Session not found"));
    const timer = window.setInterval(() => {
      void loadSession().catch(() => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loadSession, playerId]);

  const me = useMemo(
    () => session?.players.find((player) => player.id === playerId) ?? null,
    [playerId, session?.players],
  );
  const answer = useMemo<SessionAnswer | null>(
    () => session?.currentRound?.answers.find((item) => item.playerId === playerId) ?? null,
    [playerId, session?.currentRound?.answers],
  );
  // The player's own Studio Session track (booth recording → AI track).
  const myStudioTrack = useMemo(
    () => session?.studioTracks?.find((t) => t.playerId === playerId) ?? null,
    [playerId, session?.studioTracks],
  );
  // Studio Session: which tracks this player has already rated (trackId → rating),
  // parsed from their "<trackId>:<rating>" answers.
  const myStudioVotes = useMemo(() => {
    const map: Record<number, number> = {};
    const round = session?.currentRound;
    if (round?.miniGame !== "studio_session") return map;
    for (const a of round.answers) {
      if (a.playerId !== playerId) continue;
      const i = a.guess.indexOf(":");
      if (i < 0) continue;
      const tid = Number(a.guess.slice(0, i));
      if (Number.isInteger(tid)) map[tid] = Number(a.guess.slice(i + 1));
    }
    return map;
  }, [playerId, session?.currentRound]);

  // Live placement from the pre-sorted players list (no extra work server-side).
  const myRank = useMemo(() => {
    if (!session || !playerId) return null;
    const index = session.players.findIndex((p) => p.id === playerId);
    return index >= 0 ? { rank: index + 1, total: session.players.length } : null;
  }, [playerId, session?.players]);

  // One buzz on the answering→revealed edge for MY answer — tracked by round index
  // so it fires exactly once, not on every 1s poll.
  const revealedRef = useRef<number | null>(null);
  useEffect(() => {
    const round = session?.currentRound;
    if (!round || round.status !== "revealed" || !answer) return;
    if (revealedRef.current === round.index) return;
    revealedRef.current = round.index;
    haptic(answer.correct ? [0, 40, 40, 80] : 120);
  }, [session?.currentRound?.status, session?.currentRound?.index, answer]);

  async function submitGuess(value: string) {
    const cleanGuess = value.trim();
    // Studio Session lets a player rate many tracks, so don't block on a prior
    // answer; the server dedups per (player, track).
    const isStudio = session?.currentRound?.miniGame === "studio_session";
    if (!playerId || !cleanGuess || submitting || (answer && !isStudio)) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${code}/round`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, guess: cleanGuess }),
      });
      const payload = (await response.json()) as { session?: PublicSessionState; error?: string };
      if (!response.ok || !payload.session) throw new Error(payload.error ?? "Could not submit answer");
      setSession(payload.session);
      setGuess("");
      haptic(15);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit answer");
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guess.trim()) return;
    await submitGuess(guess);
  }

  if (!playerId) {
    return (
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <JCard spine="PLAYER · SIDE B" contentClassName="p-7 text-center">
          <div className="flex justify-center">
            <Sticker tone="magenta" rotate={-3}>
              Controller
            </Sticker>
          </div>
          <h1 className="mt-4 font-condensed text-3xl uppercase tracking-tight text-[#15120E]">
            Join required
          </h1>
          <p className="mt-2 text-sm leading-6 text-black/55">
            Enter the room again to bind this phone to the show.
          </p>
          <div className="mt-6 grid gap-2">
            <Button href={`/join?code=${code}`} variant="magenta" full>
              Join room
            </Button>
            <Button href="/" variant="outlineDark" full>
              Home
            </Button>
          </div>
        </JCard>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between gap-3 border-b border-black/10 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" aria-label="Soundclash — home" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logomark.png"
              alt=""
              aria-hidden
              className="h-9 w-9 rounded-lg border border-black/10 transition-opacity hover:opacity-80"
            />
          </Link>
          <Avatar name={me?.name ?? "Player"} emoji={me?.avatar} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{me?.name ?? "Player"}</p>
            <p className="font-mono text-xs text-black/45">Room {code}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {myRank && (session?.status === "playing" || session?.status === "results") ? (
            <span
              key={myRank.rank}
              className="animate-pop-in rounded-lg border border-aqua/40 bg-aqua/10 px-2.5 py-1 text-center"
            >
              <span className="block font-mono text-[0.5rem] uppercase tracking-[0.18em] text-aqua">Rank</span>
              <span className="block font-mono text-lg leading-none tabular-nums text-ink">
                #{myRank.rank}
                <span className="text-xs text-black/40">/{myRank.total}</span>
              </span>
            </span>
          ) : null}
          <div className="rounded-lg border border-black/10 bg-black/[0.03] px-3 py-1.5 text-right">
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-aqua">Score</p>
            <p className="font-mono text-2xl tabular-nums text-ink">{me?.score ?? 0}</p>
          </div>
        </div>
      </header>

      <section className="flex flex-1 flex-col justify-center py-6">
        {error ? (
          <div className="mb-3 rounded-xl border border-[#C2563B]/30 bg-[#C2563B]/10 p-3 text-sm text-[#A2452E]">
            <p>{error}</p>
            <Link
              href="/"
              className="mt-2 inline-block font-semibold uppercase tracking-[0.1em] text-ink underline underline-offset-4"
            >
              Back home
            </Link>
          </div>
        ) : null}

        {session?.status === "lobby" && needsPlayerVoice(session.miniGames) ? (
          <JCard spine="STUDIO · SIDE B" contentClassName="p-6">
            <StudioRecordPad
              code={code}
              playerId={playerId}
              playerName={me?.name ?? "Player"}
              track={myStudioTrack}
              onSession={setSession}
            />
            <p className="mt-4 border-t border-black/10 pt-3 text-center text-xs text-black/45">
              The host starts the show once tracks are in.
            </p>
          </JCard>
        ) : !session || session.status === "lobby" ? (
          <Waiting title="Waiting for host" body="Keep this controller open. The next round drops in here." />
        ) : null}

        {session?.status === "playing" && session.currentRound ? (
          <JCard spine="LOCK IN · SIDE B" contentClassName="p-6">
            <div className="flex items-start justify-between gap-3">
              <Sticker tone="magenta" rotate={-3}>
                {session.currentRound.title}
              </Sticker>
              {!answer && session.currentRound.status === "answering" ? (
                <CountdownRing
                  endsAt={session.currentRound.endsAt}
                  startedAt={session.currentRound.startedAt}
                />
              ) : null}
            </div>
            <h1 className="mt-4 font-condensed text-3xl uppercase leading-tight tracking-tight text-[#15120E]">
              {session.currentRound.instruction}
            </h1>
            <p className="mt-2 text-sm text-black/55">
              Watch the main screen. Lock once before the host reveals.
            </p>

            {session.currentRound.miniGame === "studio_session" ? (
              <StudioRatePad
                round={session.currentRound}
                playerId={playerId}
                submitting={submitting}
                myVotes={myStudioVotes}
                onRate={(trackId, score) => void submitGuess(`${trackId}:${score}`)}
              />
            ) : answer ? (
              <AnswerFeedback
                key={`${session.currentRound.index}-${session.currentRound.status}`}
                round={session.currentRound}
                answer={answer}
                t={copy[session.locale]}
              />
            ) : session.currentRound.answerType === "tap" ? (
              <BeatTapPad
                round={session.currentRound}
                submitting={submitting}
                onLock={(score) => void submitGuess(String(score))}
              />
            ) : session.currentRound.answerType === "judge" ? (
              <JudgePad submitting={submitting} onRate={(score) => void submitGuess(String(score))} />
            ) : session.currentRound.answerType === "choice" ? (
              <div className="mt-6 grid gap-2">
                {session.currentRound.options?.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => void submitGuess(option)}
                    disabled={submitting}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-black/15 bg-white px-4 py-3 text-left text-base font-semibold text-[#15120E] transition-colors hover:border-[#C2563B] active:border-[#C2563B] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="shrink-0 font-mono text-sm text-black/40">{index + 1}</span>
                    <span className="min-w-0 break-words">{option}</span>
                  </button>
                ))}
              </div>
            ) : (
              <form onSubmit={submit} className="mt-6 space-y-3">
                <input
                  value={guess}
                  onChange={(event) => setGuess(event.target.value)}
                  autoComplete="off"
                  autoFocus
                  placeholder="Missing word"
                  className={FIELD}
                />
                <Button type="submit" variant="magenta" full disabled={!guess.trim() || submitting}>
                  {submitting ? "Submitting…" : "Lock answer"}
                </Button>
              </form>
            )}
          </JCard>
        ) : null}

        {/* Game over → the personal placement card, instead of the last round's
            answer list (revealRound flips status to "results" every round, so this
            must be gated on `complete`, not just status). */}
        {session?.complete && session.currentRound && playerId ? (
          <PlayerResultCard session={session} playerId={playerId} />
        ) : null}

        {session?.status === "results" && session.currentRound && !session.complete ? (
          <JCard spine="ROUND · SIDE B" contentClassName="p-6">
            <Sticker tone="tangerine" rotate={-3}>
              Round results
            </Sticker>
            <div className="mt-4 grid gap-2">
              {session.currentRound.answers.map((item, index) => {
                const mine = item.playerId === playerId;
                return (
                  <div
                    key={item.playerId}
                    className={[
                      "grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2",
                      mine ? "border-[#C2563B]/40 bg-[#C2563B]/10" : "border-black/10 bg-white/60",
                    ].join(" ")}
                  >
                    <span className="font-mono text-xs text-black/40">{index + 1}</span>
                    <span className={mine ? "truncate font-semibold text-[#15120E]" : "truncate text-black/70"}>
                      {item.playerName}
                    </span>
                    <span className="font-mono text-sm tabular-nums text-[#15120E]">{item.points}</span>
                  </div>
                );
              })}
            </div>
          </JCard>
        ) : null}

        {/* When complete, PlayerResultCard renders its own credit — avoid duplicating. */}
        {session?.currentRound?.copyright && !session.complete ? (
          <MusixmatchCredit
            roundKey={`${session.code}:${session.currentRound.index}:${session.currentRound.trackId}`}
            copyright={session.currentRound.copyright}
            tracking={session.currentRound.tracking}
            className="mt-6 text-center text-[0.62rem] leading-4 text-black/45"
          />
        ) : null}
      </section>
    </main>
  );
}

// Voice Clash: rate the host's track 0..100. No correct answer — the crowd average
// becomes the studio score, and you earn "critic" points for landing near it.
function JudgePad({
  submitting,
  onRate,
}: {
  submitting: boolean;
  onRate: (score: number) => void;
}) {
  const [value, setValue] = useState(50);
  const PRESETS: [string, number][] = [
    ["Cursed", 12],
    ["Mid", 50],
    ["Banger", 92],
  ];
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border-2 border-black/15 bg-white p-5 text-center">
        <p className="font-condensed text-6xl tabular-nums text-[#15120E]">{value}</p>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-black/45">your rating</p>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        disabled={submitting}
        className="w-full accent-[#C2563B]"
        aria-label="Rate the track"
      />
      <div className="flex gap-2">
        {PRESETS.map(([label, preset]) => (
          <button
            key={label}
            type="button"
            onClick={() => setValue(preset)}
            disabled={submitting}
            className="flex-1 rounded-lg border border-black/15 py-2 font-condensed text-xs uppercase tracking-[0.04em] text-black/70 transition-colors hover:border-[#C2563B] disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
      <Button type="button" variant="magenta" full disabled={submitting} onClick={() => onRate(value)}>
        {submitting ? "Locking…" : "Lock my rating"}
      </Button>
    </div>
  );
}

// Studio Session: rate every track (except your own) on the phone while the TV
// plays them. Each track is a separate "<trackId>:<rating>" vote; locked tracks
// show their value. At reveal, shows each track's crowd score.
function StudioRatePad({
  round,
  playerId,
  submitting,
  myVotes,
  onRate,
}: {
  round: NonNullable<PublicSessionState["currentRound"]>;
  playerId: string;
  submitting: boolean;
  myVotes: Record<number, number>;
  onRate: (trackId: number, score: number) => void;
}) {
  const tracks = (round.studioTracksRef ?? []).filter((t) => t.playerId !== playerId);
  const revealed = round.status === "revealed";
  const [draft, setDraft] = useState<Record<number, number>>({});

  if (!tracks.length) {
    return (
      <div className="mt-6 rounded-xl border-2 border-black/15 bg-white p-5 text-center">
        <p className="font-condensed text-2xl uppercase tracking-tight text-[#15120E]">Your track is on 🎤</p>
        <p className="mt-2 text-sm text-black/55">Watch the big screen — the crowd is rating it.</p>
      </div>
    );
  }

  if (revealed) {
    return (
      <div className="mt-6 grid gap-2">
        {tracks.map((t) => (
          <div
            key={t.id}
            className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-black/10 bg-white/60 px-3 py-2"
          >
            <span className="truncate text-black/70">{t.playerName}</span>
            <span className="font-mono tabular-nums text-[#15120E]">{t.studioScore ?? 0}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <p className="text-sm text-black/55">Rate each track as it plays on the big screen.</p>
      {tracks.map((t) => {
        const locked = t.id in myVotes;
        const value = locked ? myVotes[t.id] : draft[t.id] ?? 50;
        return (
          <div
            key={t.id}
            className={["rounded-xl border-2 p-4", locked ? "border-[#0a7d55]/40 bg-[#0a7d55]/5" : "border-black/15 bg-white"].join(" ")}
          >
            <div className="flex items-center justify-between">
              <span className="font-condensed text-base uppercase tracking-[0.03em] text-[#15120E]">{t.playerName}</span>
              <span className="font-condensed text-2xl tabular-nums text-[#15120E]">{value}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={value}
              onChange={(e) => setDraft((d) => ({ ...d, [t.id]: Number(e.target.value) }))}
              disabled={locked || submitting}
              className="mt-2 w-full accent-[#C2563B] disabled:opacity-60"
              aria-label={`Rate ${t.playerName}'s track`}
            />
            {locked ? (
              <p className="mt-1 text-center font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[#0a7d55]">locked ✓</p>
            ) : (
              <Button type="button" variant="magenta" full disabled={submitting} onClick={() => onRate(t.id, value)}>
                Lock rating
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Beat Lock: tap to an on-screen metronome. The pulse runs on a LOCAL clock at
// the round's BPM, so accuracy is self-consistent (phone tap vs phone pulse) and
// independent of the TV audio or the 1s poll. Submits a 0..100 timing score.
function BeatTapPad({
  round,
  submitting,
  onLock,
}: {
  round: NonNullable<PublicSessionState["currentRound"]>;
  submitting: boolean;
  onLock: (score: number) => void;
}) {
  const bpm = round.bpm ?? 110;
  const windowMs = round.tapWindowMs ?? 160;
  const period = 60000 / bpm;
  const startRef = useRef<number | null>(null);
  const tapsRef = useRef<number[]>([]);
  const [count, setCount] = useState(0);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    startRef.current = performance.now();
    let raf = 0;
    const tick = () => {
      const t0 = startRef.current ?? performance.now();
      const phase = ((performance.now() - t0) % period) / period;
      setPulse(phase < 0.18);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [period]);

  function tap() {
    if (submitting) return;
    const t0 = startRef.current ?? performance.now();
    tapsRef.current.push(performance.now() - t0);
    setCount(tapsRef.current.length);
  }

  function lock() {
    const taps = tapsRef.current;
    if (taps.length < 3 || submitting) return;
    const errs = taps.map((t) => {
      const m = ((t % period) + period) % period;
      return Math.min(m, period - m);
    });
    const meanErr = errs.reduce((a, b) => a + b, 0) / errs.length;
    const score = Math.round(Math.max(0, Math.min(1, 1 - meanErr / windowMs)) * 100);
    onLock(score);
  }

  return (
    <div className="mt-6 space-y-4">
      <button
        type="button"
        onClick={tap}
        disabled={submitting}
        className={[
          "flex aspect-square w-full items-center justify-center rounded-3xl border-4 transition-colors",
          pulse ? "border-[#C2563B] bg-[#C2563B]/15" : "border-black/15 bg-white",
        ].join(" ")}
      >
        <span className="font-condensed text-3xl uppercase tracking-tight text-[#15120E]">
          {count < 3 ? "Tap the beat" : `${count} taps`}
        </span>
      </button>
      <Button type="button" variant="magenta" full disabled={count < 3 || submitting} onClick={lock}>
        {submitting ? "Locking…" : count < 3 ? "Tap at least 3 times" : "Lock my timing"}
      </Button>
    </div>
  );
}

// The locked/revealed feedback tile. The parent keys it by round+status so it
// remounts (slam-in) exactly once on reveal, and the points count up from zero.
function AnswerFeedback({
  round,
  answer,
  t,
}: {
  round: NonNullable<PublicSessionState["currentRound"]>;
  answer: SessionAnswer;
  t: Record<string, string>;
}) {
  const revealed = round.status === "revealed";
  const points = useCountUp(revealed ? answer.points : 0);
  const labelClass = !revealed ? "text-black/55" : answer.correct ? "text-[#0a7d55]" : "text-[#A2452E]";
  const boxClass = !revealed
    ? "border-black/12 bg-white/70"
    : answer.correct
      ? "border-[#0a7d55]/40 bg-[#0a7d55]/10"
      : "border-[#C2563B]/40 bg-[#C2563B]/10";
  return (
    <div className={["mt-6 animate-slam-in rounded-xl border p-5 text-center", boxClass].join(" ")}>
      <p className={["font-condensed text-sm uppercase tracking-[0.12em]", labelClass].join(" ")}>
        {revealed ? (answer.correct ? t.correctLabel : t.missedLabel) : t.lockedInLabel}
      </p>
      <p className="mt-1 font-condensed text-5xl tabular-nums text-[#15120E]">
        {revealed ? points : t.readyLabel}
      </p>
    </div>
  );
}

function Waiting({ title, body }: { title: string; body: string }) {
  return (
    <JCard contentClassName="p-7 text-center">
      <div className="flex justify-center">
        <Sticker tone="aqua" rotate={-3}>
          Standby
        </Sticker>
      </div>
      <h2 className="mt-4 font-condensed text-3xl uppercase tracking-tight text-[#15120E]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-black/55">{body}</p>
    </JCard>
  );
}
