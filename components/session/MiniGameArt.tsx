import type { ReactNode } from "react";
import type { MiniGameId } from "@/lib/session/types";

// Built-in line-art per mini-game, drawn on a 120×72 banner grid in the brand's
// stroke style. The accent shapes use `currentColor` (set by the card to the
// category tone); context shapes use a faint white so they read on any tint.
// These are the default visuals; a game's `image` field overrides them when set.

const FAINT = "rgba(255,255,255,0.16)";

const ART: Record<MiniGameId, ReactNode> = {
  // Genre Roulette — a spinning disc + needle: name the vibe of the bed.
  genre_roulette: (
    <>
      <circle cx="56" cy="36" r="20" fill="none" stroke={FAINT} strokeWidth="3" />
      <circle cx="56" cy="36" r="4" fill="currentColor" />
      <path d="M70 22 84 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  // Beat Lock — evenly spaced beat ticks with one locked accent.
  beat_lock: (
    <>
      <rect x="20" y="40" width="6" height="16" rx="3" fill={FAINT} />
      <rect x="40" y="32" width="6" height="24" rx="3" fill={FAINT} />
      <rect x="60" y="24" width="6" height="32" rx="3" fill="currentColor" />
      <rect x="80" y="36" width="6" height="20" rx="3" fill={FAINT} />
    </>
  ),
  // Finish the Line — lyric bars with the last word as a blank.
  finish_line: (
    <>
      <rect x="16" y="16" width="58" height="6" rx="3" fill={FAINT} />
      <rect x="16" y="31" width="80" height="6" rx="3" fill={FAINT} />
      <rect x="16" y="46" width="28" height="6" rx="3" fill={FAINT} />
      <rect x="50" y="42" width="34" height="14" rx="3" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 4" />
    </>
  ),
  // Misheard — two near-identical waves: which is the real lyric?
  mondegreen: (
    <>
      <path d="M18 46q9-18 18 0t18 0 18 0 18 0" fill="none" stroke={FAINT} strokeWidth="3" strokeLinecap="round" />
      <path d="M18 34q9-18 18 0t18 0 18 0 18 0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  // The Drop — rising meter with a marked landing point.
  the_drop: (
    <>
      <rect x="14" y="44" width="6" height="12" rx="2" fill={FAINT} />
      <rect x="24" y="38" width="6" height="18" rx="2" fill={FAINT} />
      <rect x="34" y="30" width="6" height="26" rx="2" fill={FAINT} />
      <rect x="44" y="22" width="6" height="34" rx="2" fill={FAINT} />
      <rect x="82" y="48" width="6" height="8" rx="2" fill={FAINT} />
      <rect x="92" y="44" width="6" height="12" rx="2" fill={FAINT} />
      <circle cx="66" cy="14" r="3" fill="currentColor" />
      <path d="M66 16v28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M59 38l7 8 7-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // On The Beat — metronome.
  on_beat: (
    <>
      <path d="M48 54l12-38 12 38z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M44 54h32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M60 50l9-26" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="69" cy="24" r="3.5" fill="currentColor" />
      <path d="M84 30v14M94 26v22" stroke={FAINT} strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  // Who Said It — speech bubble with quote marks.
  song_mash: (
    <>
      <path
        d="M24 16h60a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8H46l-12 10v-10h-2a8 8 0 0 1-8-8V24a8 8 0 0 1 8-8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M40 27v9a4 4 0 0 1-4 4M52 27v9a4 4 0 0 1-4 4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M66 27v9a4 4 0 0 1-4 4M78 27v9a4 4 0 0 1-4 4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
    </>
  ),
  // Next Line — which line comes next.
  next_line: (
    <>
      <rect x="22" y="12" width="64" height="6" rx="3" fill={FAINT} />
      <rect x="22" y="25" width="48" height="6" rx="3" fill={FAINT} />
      <path d="M54 36v12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M48 43l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="22" y="52" width="64" height="9" rx="4" stroke="currentColor" strokeWidth="2.5" />
    </>
  ),
  // Name That Song — vinyl + note.
  name_song: (
    <>
      <circle cx="42" cy="38" r="22" fill="none" stroke={FAINT} strokeWidth="2.5" />
      <circle cx="42" cy="38" r="10" fill="none" stroke={FAINT} strokeWidth="2.5" />
      <circle cx="42" cy="38" r="3" fill="currentColor" />
      <path d="M74 20v22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M74 20l10-3v10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="69" cy="44" r="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="79" cy="42" r="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
    </>
  ),
  // Artist Lock — microphone.
  artist_pick: (
    <>
      <rect x="50" y="12" width="20" height="30" rx="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M42 36a18 18 0 0 0 36 0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M60 54v8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M50 62h20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M56 22h8M56 28h8" stroke={FAINT} strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  // Word Rush — stopwatch + motion lines.
  word_rush: (
    <>
      <circle cx="58" cy="42" r="18" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M58 42v-9M58 42l7 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M54 18h8M58 18v6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 34h16M14 42h18M22 50h12" stroke={FAINT} strokeWidth="3" strokeLinecap="round" />
    </>
  ),
};

export default function MiniGameArt({ id, className }: { id: MiniGameId; className?: string }) {
  return (
    <svg viewBox="0 0 120 72" fill="none" preserveAspectRatio="xMidYMid meet" className={className} aria-hidden="true">
      {ART[id]}
    </svg>
  );
}
