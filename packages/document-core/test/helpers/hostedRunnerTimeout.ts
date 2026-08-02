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

/**
 * Owner ruling 2026-08-02 (option c of the G24 hosted-budget report): a
 * Section 3 time budget binds unscaled on idle owner hardware — the G23
 * idle matrix — and scales by the same declared hosted-hardware factor
 * when a closure surface runs it on a hosted CI runner. The repository
 * already committed both the factor and the pattern
 * (`process.env.CI ? 200 : 50` in the snapshot codec guard). Memory and
 * byte budgets never scale.
 */
export function hostedRunnerBudgetMs(milliseconds: number): number {
  return process.env.CI === 'true' ? milliseconds * 4 : milliseconds
}
