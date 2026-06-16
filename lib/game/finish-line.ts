import type { FinishLineRound, TrackingLinks } from "@/lib/types";

const LAST_WORD = /([\p{L}\p{N}][\p{L}\p{N}'’-]*)([^\p{L}\p{N}]*)$/u;

function lyricLines(lyrics: string): string[] {
  return lyrics
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 18 && line.length <= 120)
    .filter((line) => !line.includes("*******") && !/commercial use/i.test(line))
    .filter((line) => !line.startsWith("["));
}

export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function buildFinishLineRound(input: {
  trackId: number;
  seed?: number;
  lyrics: string;
  copyright: string;
  tracking: TrackingLinks;
}): FinishLineRound {
  // Build the pool of lines that yield a valid (>=3 char) last-word answer, so the
  // seed indexes directly into distinct playable rounds (consecutive seeds never collide
  // until the pool is exhausted) instead of seeding a forward-search that funnels onto
  // the same lines.
  const seen = new Set<string>();
  const playable = lyricLines(input.lyrics)
    .map((line) => {
      const answer = line.match(LAST_WORD)?.[1];
      if (!answer || normalizeAnswer(answer).length < 3) return null;
      return { line, answer };
    })
    .filter((entry): entry is { line: string; answer: string } => entry !== null)
    // Drop repeated lines (choruses) so a multi-round game never replays the same line.
    .filter((entry) => {
      const key = normalizeAnswer(entry.line);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (playable.length === 0) throw new Error("No playable lyric lines found");

  const seed = Math.max(0, input.seed ?? 0);
  const index = (input.trackId + seed) % playable.length;
  const { line, answer } = playable[index];

  return {
    trackId: input.trackId,
    seed,
    prompt: line.replace(LAST_WORD, `_____$2`),
    answer,
    copyright: input.copyright,
    tracking: input.tracking,
  };
}
