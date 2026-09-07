# CriticMarkup candidate verification — 6 September 2026

**Historical candidate:** This report describes `index-CtQxlysF.js`. The current frozen candidate and remaining blockers are recorded in [plan 0011](../plans/0011-criticmarkup-editable-review.md#current-completion-blockers--macos-product-correction-6-september); the results below do not certify its changed inputs.

Release verification remains incomplete. [Plan 0011](../plans/0011-criticmarkup-editable-review.md) retains the full scope. The Source activation repair, full integrated suites, repeated input/recovery checks and distribution workflows pass on the frozen candidate. Final sustained and cold-open performance checks also pass, measured with competing task-owned validation stopped. Windows and native OS interaction checks remain open.

## Candidate and repairs

The frozen runtime is renderer `index-CtQxlysF.js`, including working changes on `feat/criticmarkup-core-integration`, whose HEAD is `f1c2008e322d26587a30ed75cff28b341ced16aa`. HEAD alone does not identify the uncommitted implementation. The candidate records 880 compiled file hashes and 1,041 runtime source hashes.

Latest repairs, each covered by red-green regression evidence:

- Source activation focuses its textarea after native focus listeners, selection and Core bindings are installed. A repeated recovery run exposed constructor autofocus accepting DOM focus before CodeMirror could poll input. Delaying that initialization reproduced actual lost initial typing; the packaged repair preserves immediate typing through save, undo, redo and handoff. Evidence: `/tmp/marktext-sep06-source-ready-{red,green}.log`.
- Source Review selections reconcile against original annotation coordinates before cumulative shifts. Muya distinguishes element child offsets from text offsets, including image token width.
- The document actor edits visible nested Comments through hierarchical lookup and keeps hidden Comment subdocuments inside their outer raw-payload editor.
- Worker failure notifies the document owner even when idle. Active views preserve recovery drafts; inactive documents recover without switching the visible tab. Acknowledged unsaved source and undo/redo survive.
- CodeMirror receives independently owned selection positions. Recovery copies scalar coordinates, preventing reactive proxies from blocking durable backup IPC.
- Packaging excludes test sources, consumes frozen compiled inputs, and explicitly includes the encoding addon at its loader path. Preflight checks archive integrity and rejects a missing required addon before Electron launches.
- Autolink recognition checks its existing eligibility condition before scanning. CPU profiling showed quadratic rescanning of long words; the bounded-work regression failed at 8.4 million candidate characters for 4,109 source characters. Reordering the guard preserves recognition and passes all 56 inline-renderer cases.

Candidate root: `/var/folders/6k/xzgngnms6jg4_z2l40y0_9vh0000gn/T/marktext-sep06-source-ready-candidate-x5oer7c4`.

Mac package: `mac-package-native/mac-arm64/marktext.app` beneath that root. Linux package: `/tmp/marktext-linux-validation.dvvBbM/sep06-source-ready-l8r7egww/dist/linux-arm64-unpacked`. Both verify default Core enablement and all 880 compiled files. The DMG and AppImage were built from those frozen inputs; provenance also verifies the application actually loaded from each distribution artifact.

## Functional verification

| Check | Current candidate |
| --- | --- |
| Desktop units | 1,856 passed in 192 files |
| Muya units | 1,484 passed in 223 files |
| Document Core units, unchanged source | 290 passed |
| CommonMark/GFM baseline checks | 1,347 passed; expected-failure inventory unchanged from pinned upstream |
| Chromium interactions | 244 passed |
| Broad packaged macOS compatibility | 345 passed |
| macOS packaged editorial, clipboard, anchors and images | 134 passed |
| Linux packaged Review, clipboard, editorial and images | 129 passed |
| Repeated input and recovery | 90 passed: ten repetitions of all nine scenarios |
| macOS DMG scratch installation | 28 Review + nine input/recovery cases passed |
| Linux AppImage extract-and-run | 28 Review + nine input/recovery cases passed |
| Types and lint | Types, changed-file lint and final root lint pass; root lint reports 322 warnings, no errors |

The CommonMark/GFM runner retains 78 CommonMark and 90 GFM expected failures, exactly matching pinned upstream. A passing baseline run preserves compatibility; it does not mean complete compliance with either specification.

One earlier Linux Review workflow timed out after its expected source was saved. The exact shutdown cause remains unexplained; its isolated traced run, 20 repetitions and complete traced reruns passed. Passing repetitions do not erase the observation. All failed runs and superseded artifacts, including the Source activation failure during recovery repetition, remain preserved.

Earlier incomplete packages are preserved: one macOS archive was corrupted by editing included test sources during packaging; one Linux archive omitted the encoding addon at the loader's `build/Release` path. Packaging now owns those inputs explicitly. Preflight rejected the incomplete artifacts and accepted the repaired packages.

Current logs: `/tmp/marktext-sep06-source-ready-{red,green,desktop,types,lint,final-root-lint,workflow-lint,broad,mac-all,linux-traced,recovery-repeats,dmg-workflows,appimage-workflows}.log`. Unchanged-source checks: `/tmp/marktext-sep06-autolink-{muya,conformance,browser}.log`. The separate deferred-selection ownership experiment passed; it required no additional runtime change (`/tmp/marktext-sep06-source-recovery-selection.log`).

## Sustained performance

All six 1,200-key workloads pass the initial p95 targets: DOM echo 16.7 ms, dispatch 8 ms, acknowledgement and reconciliation 50 ms. Each has eight warmup keys and 20 ms deliberate pacing, with no authority barrier between measured keys. All 7,200 measured inputs pair with authority transactions, receive acknowledgement/reconciliation, and preserve exact saved source. Comparisons use upstream `e52106fd1cdcbd33c1258b7b0cdc7013c4c5d86c`, matching documents and pacing.

| Workload | Candidate echo p95 | Upstream echo p95 | Dispatch p95 | Ack p95 | Reconcile p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plain, 1,000 paragraphs | 4.0 ms | 13.6 ms | 5.3 ms | 8.7 ms | 12.4 ms |
| Dense CM, 80 sections, ordinary | 3.7 ms | 12.6 ms | 4.1 ms | 8.8 ms | 10.1 ms |
| Dense CM, 80 sections, tracked | 3.7 ms | 12.6 ms | 4.2 ms | 8.9 ms | 10.5 ms |
| Unicode, 80 sections, tracked | 3.7 ms | 3.9 ms | 4.1 ms | 5.4 ms | 7.2 ms |
| Mixed blocks, 80 sections, tracked | 4.5 ms | 14.3 ms | 5.4 ms | 10.4 ms | 14.0 ms |
| Diagrams/images/math, 20 sections, tracked | 3.9 ms | 12.9 ms | 4.3 ms | 8.9 ms | 10.4 ms |

Upstream treats CriticMarkup as literal text and has no tracking/authority API; its values are an ordinary-editing baseline, not equivalent tracked functionality. All five upstream workloads preserve exact source. Before the autolink repair, the candidate's large plain workload failed dispatch p95 at 14.2 ms and grew progressively slower. The failed run and CPU profile are retained in `/tmp/marktext-sep06-final-performance.log` and `/tmp/marktext-sep06-plain-profile.log`.

The maximum transient queue depth was six in mixed blocks. All transactions drained, but that workload had a 199.1 ms reconciliation outlier despite passing p95; it is not a claim that every event meets 50 ms. Renderer retained heap rose by 1.28–1.78 MB per typing workload after explicit GC, including undo history and bounded diagnostic traces. These before/after observations do not prove absence of leaks.

The 200-cycle editorial session passed native paste, deletion, navigation, Review accept and undo, with exact saves every ten cycles. Editing/review wall-time p95 was 271/469 ms, including automation, assertions and deliberate pacing; these are not individual-input latencies. Retained renderer heap rose 4.73 MB. Its diagnostic trace reached the bounded 4,096-event capacity; cycle timings and source checks continued through all 200 cycles.

## Cold opening

Five fresh Electron processes and isolated profiles per workload, loading the frozen compiled bundles through the same external hidden-window facade for both builds. The warm/session measurements above use the packaged app. Values below measure host launch to exact editable DOM, including automation overhead. All 30 launches preserved exact source. Core open time was at most 92.5 ms and first editable binding at most 198.0 ms, meeting the 500/1,500 ms targets.

| Workload | Candidate median / maximum | Upstream median / maximum |
| --- | ---: | ---: |
| Plain, 80 paragraphs | 638 / 925 ms | 569 / 574 ms |
| Dense CM, 80 sections | 690 / 702 ms | 573 / 576 ms |
| Plain, 1,000 paragraphs | 1,047 / 1,114 ms | 892 / 1,045 ms |

The candidate adds cold-start cost while staying within the stated Core targets. Five samples are diagnostic, not a stable tail estimate; disk caches and unrelated host activity are uncontrolled. The presentation observation is editable DOM intersecting a hidden viewport, not compositor paint or physical input-to-photon latency. All task-owned competing validation was stopped during timing. Hardware: Apple M5 Max, 18 logical CPUs, macOS arm64, Darwin 25.6.0.

Raw candidate artifacts are listed in `performance-artifacts.json` beneath the candidate root. Logs: `/tmp/marktext-sep06-source-ready-performance.log`, `/tmp/marktext-sep06-final-upstream-{warm,cold}.log`. Those logs identify every raw sample file; build/source hashes and metadata are preserved alongside them.

## Distribution and unverified release behavior

The unsigned macOS disk image was checksum-verified, mounted without opening Finder, copied into a fresh scratch installation, then unmounted. All 123 application files/symlinks match the tested package. That installation passed default-enabled provenance, 28 Review and nine input/recovery cases. Gatekeeper download/quarantine, signing and notarization remain unverified.

The Linux AppImage passed archive/native-addon preflight, then launched through its actual runtime with `APPIMAGE_EXTRACT_AND_RUN=1` in the isolated container. Provenance verifies all 880 compiled files from the running application's archive. Its 28 Review and nine input/recovery cases passed. FUSE mounting and desktop integration remain unverified. The tested macOS and Linux artifacts are arm64.

Windows x64/arm64 execution remains open; CI includes installed editorial, clipboard, idle/pending recovery and immediate Source input. No local Windows runtime or reachable Windows test peer is available. Native OS IME panels and the interactive macOS screenshot picker remain unverified under the non-focus-stealing constraint. Chromium composition and completed screenshot IPC have automated coverage.

Local review covered the complete working-change inventory and critical ownership boundaries. Independent review was unavailable because the agent quota was exhausted. This report does not declare the branch production ready or the plan complete.
