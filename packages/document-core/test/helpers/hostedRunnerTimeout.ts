/**
 * A hang guard sized for the machine it runs on. Explicit test timeouts in
 * this package are scaffolding — the requirements live in the assertions —
 * and were sized on owner hardware; hosted CI runners execute the same
 * bounded work about four times slower with wide run-to-run variance
 * (measured: a 22.5s green and a 33.4s breach of one 30s ceiling on
 * identical code, one hour apart, on windows-2025).
 */
export function hostedRunnerTimeout(milliseconds: number): number {
  return process.env.CI === 'true' ? milliseconds * 4 : milliseconds
}
