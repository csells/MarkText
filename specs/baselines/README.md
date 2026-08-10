# CriticMarkup integration baselines

This directory contains generated observations about the recorded upstream MarkText baseline. A
baseline is an oracle input, not a product specification.

`criticmarkup-upstream-parity.json` is generated from Git objects at the commit recorded in the
file, so integration-branch additions cannot silently enlarge or shrink the upstream denominator.
It inventories commands, preferences, editor plugins, routes, menu entries, application and Muya
README promises, desktop and Muya tests, disabled tests and commands, backlog items, and manual OS
integration checks.

`criticmarkup-parity-dispositions.json` is the separate, human-owned review overlay. Each generated
item must map to a parity row, an unaffected rationale, or an approved compatibility decision. The
generator never rewrites that file. Keeping observations and decisions separate makes stale review
entries and upstream additions visible instead of silently carrying them forward.

Regenerate it at an explicit upstream rebase checkpoint:

```bash
pnpm criticmarkup:parity -- --write <upstream-commit>
```

Check that the committed inventory still matches that Git commit:

```bash
pnpm criticmarkup:parity:check
```

`pnpm criticmarkup:parity:validate` also requires every item to have a `parity-row`, `unaffected`,
or `approved-decision` disposition, with a supporting reference or rationale. It is expected to
fail while Phase 0 review is incomplete.
