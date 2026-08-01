#!/bin/sh
# The one remaining local window for plan 0009: the scoped-budget
# performance matrix and the two proofs gated on it. Budgets presume an
# idle machine, so this refuses to produce load-tainted evidence.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOAD="$(sysctl -n vm.loadavg | awk '{print $2}' | cut -d. -f1)"
if [ "$LOAD" -ge 3 ]; then
  echo "load average ${LOAD} is not idle; refusing a tainted matrix run" >&2
  exit 1
fi
cd "$REPO/packages/desktop"
PERF_TESTING=true npx -y pnpm@10.33.4 exec playwright test \
  --config test/e2e/playwright.config.ts \
  test/e2e/document-core-max-document-perf.spec.ts \
  test/e2e/critic-markup-perf.spec.ts
echo "idle matrix green: record it in the plan's G23 entry, then author"
echo "A29/A37 mutations against these green baselines and run:"
echo "  node scripts/mutationProof.mjs A29 && node scripts/mutationProof.mjs A37"
