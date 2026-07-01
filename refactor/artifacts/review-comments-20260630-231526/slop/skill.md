# AI slop scan — review-comments-20260630-231526-skill

Generated 2026-07-01T06:17:02Z
Scope: `skills/markdown-comments/src`

(See references/VIBE-CODED-PATHOLOGIES.md for P1-P40 catalog.)


## P1 over-defensive try/catch (Python: ≥3 except Exception per file)

_none found_

## P1 over-defensive try/catch (TS: catch blocks per file)

_none found_

## P2 long nullish/optional chains (three+ `?.`)

_none found_

## P2 double-nullish coalescing

_none found_

## P3 orphaned _v2/_new/_old/_improved/_copy files

_none found_

## P4 utils/helpers/misc/common files > 500 LOC

_none found_

## P5 abstract Base/Abstract class hierarchy

_none found_

## P5 abstract class in Rust (rare idiom; often AI-generated)

_none found_

## P6 feature flags (review each for whether it is still toggling)

_none found_

## P7 re-export barrel files (`export * from`)

_none found_

## P8 pass-through wrappers (function whose sole body returns another call)

_none found_

## P9 functions with ≥5 optional parameters

_none found_

## P10 swallowed catch (empty or `return null`)

_none found_

## P10 Python: except ... : pass

_none found_

## P11 Step/Phase/TODO comments (per-file counts)

_none found_

## P12 many-import files (top 20)

_none found_

## P14 mocks (jest.mock, vi.mock, sinon.stub, __mocks__)

_none found_

## P15 TS `any` usage (per-file counts, top 20)

_none found_

## P16 *Error enums in Rust (often duplicate variants)

_none found_

## P17 heavily drilled props (top 10 most-passed via JSX)

_none found_

## P18 everything hook (custom hook file with many useState/useEffect)

_none found_

## P19 N+1 pattern (await inside for loop)

_none found_

## P19 Python N+1 (for ... : await)

_none found_

## P20 config files (candidates for unification)

_none found_

## P22 stringly-typed status/state comparisons

_none found_

## P22 Rust stringly-typed status/state comparisons

_none found_

## P23 reflex trim/lower/upper normalization

```
skills/markdown-comments/src/cli.ts:90:    ? options.authors.split(',').map(author => author.trim()).filter(Boolean)
```

## P24 testability wrappers / mutable deps seams

_none found_

## P25 docstrings/comments that may contradict implementation

_none found_

## P26 TypeScript type assertions

_none found_

## P27 addEventListener sites (audit for cleanup)

_none found_

## P28 timers (audit for clearTimeout/clearInterval cleanup)

_none found_

## P29 regex construction in functions/loops

_none found_

## P30 debug print/log leftovers

_none found_

## P31 JSON.stringify used as key/hash/memo identity

_none found_

## P32 money-like arithmetic (audit integer cents/decimal)

_none found_

## P33 local time / UTC drift candidates

```
skills/markdown-comments/src/edit.ts:35:  const createdAt = reply.createdAt ?? new Date().toISOString()
skills/markdown-comments/src/edit.ts:109:  updatedAt = new Date().toISOString()
```

## P34 detailed internal errors exposed

_none found_

## P35 suspicious ambiguous imports

_none found_

## P36 infra/config surfaces that should not ride with refactor commits

```
./pnpm-lock.yaml
./package.json
./packages/muyajs/package.json
./packages/website/package.json
./packages/desktop/package.json
./packages/muya/package.json
./.github/workflows/muya-e2e.yml
./.github/workflows/release.yml
./.github/workflows/muya-circular.yml
./.github/workflows/lint.yml
./.github/workflows/test.yml
./.github/workflows/muya-build.yml
./.github/workflows/muya-spec.yml
./.github/workflows/muya-test.yml
./.github/workflows/claude.yml
./.github/workflows/muya-lint.yml
./.github/workflows/validate-licenses.yml
./.github/workflows/e2e.yml
./.github/workflows/website-deploy.yml
./.github/workflows/build.yml
./skills/markdown-comments/package.json
```

## P37 unpinned dependency snippets

_none found_

## P38 wildcard/glob imports

_none found_

## P39 async functions returning Promise (audit for real await)

_none found_

## P40 await/then in nearby non-async contexts (manual audit)

_none found_

---

## Next steps

1. Review each section; confirm which hits are real vs. false positives.
2. File beads for accepted patterns (one per pathology class).
3. Proceed to `./scripts/dup_scan.sh` for structural duplication.
4. Score candidates via `./scripts/score_candidates.py`.
5. For each accepted candidate: fill isomorphism card, edit, verify, ledger.

Full P1-P40 pathology catalog: `references/VIBE-CODED-PATHOLOGIES.md`.
Attack order (cheap wins first): the "AI-slop refactor playbook" in that file.
