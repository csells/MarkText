export function measuredDoublingRatio(
  lowerElapsedMs: number,
  upperElapsedMs: number
): number {
  if (
    !Number.isFinite(lowerElapsedMs) ||
    !Number.isFinite(upperElapsedMs) ||
    lowerElapsedMs < 0 ||
    upperElapsedMs < 0
  ) {
    throw new RangeError('Performance durations must be finite and nonnegative')
  }
  return lowerElapsedMs === 0
    ? Number.POSITIVE_INFINITY
    : upperElapsedMs / lowerElapsedMs
}
