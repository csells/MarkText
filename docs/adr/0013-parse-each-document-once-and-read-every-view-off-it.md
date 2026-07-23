# The engine parses each document once and reads every view off it

The engine parses a document **once** and reads Original, Revised, and the
editing (Markup) view off that single parse. Outside CriticMarkup marker
regions the three views are byte-identical and share identical block and inline
structure; they diverge only inside marker regions and reconverge at the next
safe point after (see below). So the parse runs over the real source with every CriticMarkup marker as
a zero-width grammar event, and where eliding a marker's content would change
Markdown structure it records the **fork** — the alternative block or inline
shape each view takes — rather than committing to one. Reading a view is arm
selection over that one structure: reject-all yields Original, accept-all
yields Revised, show-all yields the editing surface. No view is reparsed, no
per-view string is flattened, and no structure is reconstructed after the fact.

This supersedes an earlier draft of this decision that had the engine run one
independent Markdown parse per view over a boundary-safe flattened string. That
still parsed the shared text once per view and still required the flattening and
boundary-safe codec machinery to make each per-view string safe to reparse. A
CriticMarkup-free document — where the views are identical and nothing changed —
parsed twice under that design; here it parses once. The per-view-reparse design
was a workaround for not recording the fork during the one parse.

The architecture is forced by a proven constraint together with the parse-once
requirement. The constraint: per-view projections are **irreducible per-view
results** — eliding a marker changes character adjacency, hence block structure
(`{--# --}Title` is a heading in Original where the `# ` survives and a
paragraph in Revised where it does not; `a{++\n\n++}b` is one paragraph in
Original and two in Revised). So no view's finished tree can be derived from
another's by tree transformation, and there is no single canonical tree the
others project from by transform. The parse-once requirement forbids
re-traversing the shared text once per view. The only shape satisfying both is a
single parse that carries the per-view alternatives inline as forks; each view
is read, not re-derived and not re-parsed.

Not flattening removes a class of hazard rather than adding one. The boundary
concern that the per-view-reparse design solved with codecs — a substitution's
old-arm tail and new-arm head concatenating into false Markdown syntax
(`` {~~`~>plain~~}{++literal++}` ``) — cannot arise when the parser reads the
real source and never concatenates arms into a string. The semantic rule that
arms are self-contained fragments still holds and is enforced in the fork logic,
but it needs no string codec. "One authority" therefore means one parse with no
private re-recognition, no per-view reparse, and no post-hoc reconstruction —
not one finished tree everything else derives from, which the irreducibility
constraint forbids.

The hard core of this rebuild is that constraint meeting CommonMark's
non-locality: lazy continuation, reference definitions, and setext underlines
mean a marker's elision-consequence is not always local to the marker, so the
single parse must maintain forked block, inline, and definition state across a
divergent region and reconverge. A fork reconverges at the next **safe point**:
a top-level blank line at which no resolution has an open fenced-code or HTML
block — the only CommonMark leaf blocks a blank line does not close. At a safe
point both resolutions are in the identical document-root, nothing-open block
state, so the remaining source parses identically in both and is parsed once.
An inline marker changes no block structure; a block-structural marker
reconverges within a block or two; the sole divergence that reaches end of
document is an *unclosed* fenced-code or HTML block, which runs to EOF under
plain CommonMark regardless of CriticMarkup — degenerate input, not the common
case. This is measured, not asserted, in
`specs/research/0002-criticmarkup-view-fork-reconvergence.md`, which reads the
reconvergence points off correct Original/Revised trees.

The editing view is exempt from the clean-projection verification that Original
and Revised must pass, and the asymmetry is principled. That verification proves
a projection parses the same with and without the parser-owned Substitution-arm
scopes, because Original and Revised can be **materialized as canonical bytes**
(Accept All / Reject All) and reparsed with no scopes at all — so for them,
scoped must equal unscoped, and boundary-safe escaping exists to make it so. The
editing view is never materialized: the marker-bearing canonical source is what
is saved. It is also the only view that shows **both** Substitution arms
adjacent, which makes arm scoping load-bearing rather than incidental — ADR-0010
requires matching state created inside an arm to finish inside it, so
`a{~~*x*~>*y*~~}b` renders as `a*x**y*b` with one emphasis per arm, never one
span pairing `*` across the junction. Demanding the unscoped reading agree would
demand exactly the cross-arm pairing ADR-0010 forbids. For the same reason the
editing view carries no protective escapes: it shows the author's exact content,
run-for-run identical to the session's model text.

The safe-point detector — a position of canonical, nothing-open block state — is
the same primitive an incremental parse needs to choose a restart boundary after
an edit (the fragment-reuse boundary). Cross-view reconvergence and cross-edit
fragment reuse are one problem: find a position where block-parser state is known
and empty. It is built once and serves both.

The migration is measured by parse count per document: a CriticMarkup-free
document parses once; a marker that does not change block structure (an addition
inside a paragraph) parses once with the views differing only by inline arm
selection; a marker that does change block structure parses once and records a
block fork that reconverges at the next safe point. The editing view is the parse
that always runs — it is the surface the user types into — so it is the natural
home of the single structure, with Original and Revised as reads of its forks.
