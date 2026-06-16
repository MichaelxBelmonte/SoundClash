export const ROUND_TIME_LIMIT_MS = 15_000;
const BASE_POINTS = 700;
const SPEED_POINTS = 300;

export function scoreFinishLine(isCorrect: boolean, elapsedMs: number): number {
  if (!isCorrect) return 0;
  const speedRatio = Math.max(0, 1 - elapsedMs / ROUND_TIME_LIMIT_MS);
  return BASE_POINTS + Math.round(SPEED_POINTS * speedRatio);
}
