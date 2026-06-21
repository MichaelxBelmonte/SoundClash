"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Button from "@/components/brand/Button";
import JCard from "@/components/brand/JCard";
import Sticker from "@/components/brand/Sticker";
import Avatar from "@/components/ui/Avatar";
import { MusixmatchCredit } from "@/components/session/MusixmatchTracking";
import type { PublicSessionState, SessionAnswer } from "@/lib/session/types";

const FIELD =
  "h-14 w-full rounded-xl border border-black/15 bg-white px-4 text-xl text-[#15120E] outline-none transition-colors placeholder:text-black/35 focus:border-[#C2563B] focus:shadow-[0_0_0_3px_rgba(194,86,59,0.15)]";

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

  async function submitGuess(value: string) {
    const cleanGuess = value.trim();
    if (!playerId || !cleanGuess || submitting || answer) return;
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
        <div className="rounded-lg border border-black/10 bg-black/[0.03] px-3 py-1.5 text-right">
          <p className="font-mono text-[0.55rem] uppercase tracking-[0.2em] text-aqua">Score</p>
          <p className="font-mono text-2xl tabular-nums text-ink">{me?.score ?? 0}</p>
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

        {!session || session.status === "lobby" ? (
          <Waiting title="Waiting for host" body="Keep this controller open. The next round drops in here." />
        ) : null}

        {session?.status === "playing" && session.currentRound ? (
          <JCard spine="LOCK IN · SIDE B" contentClassName="p-6">
            <Sticker tone="magenta" rotate={-3}>
              {session.currentRound.title}
            </Sticker>
            <h1 className="mt-4 font-condensed text-3xl uppercase leading-tight tracking-tight text-[#15120E]">
              {session.currentRound.instruction}
            </h1>
            <p className="mt-2 text-sm text-black/55">
              Watch the main screen. Lock once before the host reveals.
            </p>

            {answer ? (
              <div className="mt-6 rounded-xl border border-black/12 bg-white/70 p-5 text-center">
                <p
                  className={
                    session.currentRound.status === "revealed"
                      ? answer.correct
                        ? "font-condensed text-sm uppercase tracking-[0.12em] text-[#0a7d55]"
                        : "font-condensed text-sm uppercase tracking-[0.12em] text-[#A2452E]"
                      : "font-condensed text-sm uppercase tracking-[0.12em] text-black/55"
                  }
                >
                  {session.currentRound.status === "revealed"
                    ? answer.correct
                      ? "Correct"
                      : "Not quite"
                    : "Locked in"}
                </p>
                <p className="mt-1 font-condensed text-5xl tabular-nums text-[#15120E]">
                  {session.currentRound.status === "revealed" ? answer.points : "Ready"}
                </p>
              </div>
            ) : session.currentRound.answerType === "tap" ? (
              <BeatTapPad
                round={session.currentRound}
                submitting={submitting}
                onLock={(score) => void submitGuess(String(score))}
              />
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

        {session?.status === "results" && session.currentRound ? (
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

        {session?.currentRound?.copyright ? (
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
