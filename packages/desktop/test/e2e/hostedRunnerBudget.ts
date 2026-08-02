// Owner ruling 2026-08-02 (option c of the G24 hosted-budget report): a
// Section 3 time budget binds unscaled on idle owner hardware — the G23
// idle matrix — and scales by the repository's declared hosted-hardware
// factor when a closure surface runs it on a hosted CI runner ("hosted
// runners execute the same bounded work about four times slower than the
// owner hardware", measured again at open 5.9s against the mini's 1.5s
// and structured toggles 820ms against 235ms). Memory and byte budgets
// never scale.
export function hostedRunnerBudgetMs(milliseconds: number): number {
  return process.env.CI === 'true' ? milliseconds * 4 : milliseconds
}
