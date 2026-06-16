"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import LiveLyricPreview from "@/components/richsync/LiveLyricPreview";
import { normalizeAnswer } from "@/lib/game/finish-line";
import { ROUND_TIME_LIMIT_MS, scoreFinishLine } from "@/lib/game/scoring";
import type { FinishLineRound, TrackSummary } from "@/lib/types";

interface FinishLineGameProps {
  round: FinishLineRound;
  track: TrackSummary;
  labels: {
    roundTitle: string;
    answerPlaceholder: string;
    submitAnswer: string;
    resetRound: string;
    correctAnswer: string;
    wrongAnswer: string;
    answerWas: string;
    scoreLabel: string;
    totalScoreLabel: string;
    roundLabel: string;
    timeLabel: string;
    pointsLabel: string;
    nextRound: string;
    richsyncTitle: string;
    richsyncLoading: string;
    richsyncUnavailable: string;
  };
  roundNumber: number;
  totalScore: number;
  onReset: () => void;
  onNextRound: () => void;
  onScored: (points: number) => void;
}

export default function FinishLineGame({
  round,
  track,
  labels,
  roundNumber,
  totalScore,
  onReset,
  onNextRound,
  onScored,
}: FinishLineGameProps) {
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<{ correct: boolean; elapsedMs: number; points: number } | null>(null);
  const startedAt = useRef(Date.now());
  const isCorrect = normalizeAnswer(answer) === normalizeAnswer(round.answer);

  useEffect(() => {
    startedAt.current = Date.now();
    setAnswer("");
    setResult(null);
  }, [round.trackId, round.prompt]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!answer.trim() || result) return;
    const elapsedMs = Math.min(Date.now() - startedAt.current, ROUND_TIME_LIMIT_MS);
    const points = scoreFinishLine(isCorrect, elapsedMs);
    setResult({ correct: isCorrect, elapsedMs, points });
    onScored(points);
  }

  return (
    <section className="rounded-md border border-neutral-850 bg-neutral-900/80 p-5">
      {round.tracking.pixel ? (
        <img alt="" className="hidden" referrerPolicy="no-referrer" src={round.tracking.pixel} />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
            {labels.roundTitle}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">{track.trackName}</h2>
          <p className="text-sm text-neutral-400">{track.artistName}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right">
          <Stat label={labels.roundLabel} value={roundNumber} />
          <Stat label={labels.totalScoreLabel} value={`${totalScore} ${labels.pointsLabel}`} />
        </div>
      </div>

      <p className="mt-6 rounded-md bg-neutral-950 p-4 text-lg leading-8 text-white">
        {round.prompt}
      </p>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          value={answer}
          onChange={(event) => {
            setAnswer(event.target.value);
          }}
          disabled={result !== null}
          placeholder={labels.answerPlaceholder}
          className="h-12 rounded-md border border-neutral-750 bg-neutral-950 px-4 text-white outline-none transition placeholder:text-neutral-500 focus:border-red-500 disabled:opacity-70"
        />
        <button
          disabled={result !== null}
          className="h-12 rounded-md bg-red-600 px-5 font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labels.submitAnswer}
        </button>
      </form>

      {result ? (
        <div className="mt-4 grid gap-3 rounded-md border border-neutral-850 bg-neutral-950 p-4 sm:grid-cols-3">
          <Stat label={labels.scoreLabel} value={`${result.points} ${labels.pointsLabel}`} />
          <Stat label={labels.timeLabel} value={`${(result.elapsedMs / 1000).toFixed(1)}s`} />
          <Stat label={result.correct ? labels.correctAnswer : labels.wrongAnswer} value={round.answer} />
        </div>
      ) : null}

      <div className="mt-5 flex items-end justify-between gap-4 border-t border-neutral-850 pt-4">
        <p className="text-xs leading-5 text-neutral-500">{round.copyright}</p>
        <div className="flex shrink-0 gap-3">
          {result ? (
            <button
              type="button"
              onClick={onNextRound}
              className="text-sm font-semibold text-red-200 hover:text-white"
            >
              {labels.nextRound}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReset}
            className="text-sm font-medium text-neutral-300 hover:text-white"
          >
            {labels.resetRound}
          </button>
        </div>
      </div>

      <div className="mt-5">
        <LiveLyricPreview trackId={track.trackId} enabled={track.hasRichsync} labels={labels} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
