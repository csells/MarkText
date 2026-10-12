Label: wayfinder:map
# Chart a CriticMarkup metadata extension
## Destination
Produce an excellent, self-contained CriticMarkup Metadata Extension proposal
ready to post as an issue in the canonical CriticMarkup repository, together
with a MarkText branch that implements it and an executable conformance corpus
that supports its claims.
## Notes
This map explicitly carries execution through the destination: it resolves the
language decisions, implements them on a dedicated MarkText branch, builds the
conformance evidence, and writes the complete proposal. Posting the issue and
work after the maintainers respond are not part of this effort.

Every session should use the `domain-modeling` skill. Grilling tickets also use the `grilling` skill, research tickets use the `research` skill, and the MarkText experiment uses the `prototype` skill. Syntax and module-boundary decisions should also consult `codebase-design`.

Standing constraints established before charting:

- CM2 is a backward-compatible superset: every CM1 document remains valid and
  unchanged. CM1 tools parse and handle the containing annotation exactly as
  ordinary CM1; the trailing HTML metadata marker has no CM1 meaning and is
  normally invisible when Markdown is rendered.
  
- Additions, deletions, substitutions, and comments may carry metadata; Highlights do not.
  
- An Addition, Deletion, Substitution, or Comment may be followed on the same
  line by `<!--cmid:ID-->`, with zero or more intervening ASCII spaces or tabs.
  The whitespace remains ordinary document content; a line ending or any other
  character breaks association. Writers emit the gapless canonical form. `ID`
  is a compact, durable, document-local opaque hexadecimal identifier. The
  corresponding one-line Markdown definition is `[ID]: <JSON>`. The marker and
  definition contain the same identifier; identifier allocation is an
  implementation detail outside the specification.
  
- All human-authored annotation and reply text remains inline CriticMarkup.
  Each reply is an ordinary inline Comment with its own metadata marker and
  definition; its JSON relates it to the original annotation. Metadata augments
  CM1 content rather than replacing it.
  
- Records describe current state, not an event history. They may contain
  creation and Comment-resolution provenance, but never edit provenance:
  extension-aware WYSIWYG editing does not offer cross-author Comment edits,
  while unrestricted source edits cannot be detected or attributed reliably.
  Removing a live annotation removes its record; reopening a Comment removes
  its resolution.
  
- Attribution is one optional, self-asserted editor-configured string. Missing attribution or time fields are omitted. Times use RFC 3339 with an explicit offset and may include fractional seconds.

- An extension-aware WYSIWYG editor permits only the original author to edit
  an attributed Addition, Deletion, Substitution, Comment, or reply body.
  Accepting, rejecting, replying, and resolving are distinct actions; source
  mode remains unrestricted.

- If `by` is absent or invalid, authorship is unknown and WYSIWYG body editing
  is unrestricted. Editing never adds creation attribution retroactively;
  `by` is recorded only when a new contribution is created.

- Resolution is current state on a root Comment and applies to its entire
  reply conversation. Replies are not individually resolvable; reopening
  clears the root's resolution metadata. Changes use accept/reject instead.

- Adding a Reply to a resolved conversation reopens it by removing `resolved`;
  previous resolution provenance is not retained as history.

- Any participant may resolve or reopen a Comment conversation. Resolution
  provenance records the self-asserted actor and time without changing
  authorship.

- Metadata JSON uses top-level `by` and `at` for creation provenance, `re` on a
  Reply for its root Comment ID, and optional nested `resolved` provenance on
  the root. Missing provenance members are omitted; `"resolved":{}` is valid.

- JSON never repeats the annotation kind. Addition, Deletion, Substitution, or
  Comment identity comes exclusively from the associated CM1 syntax.

- Metadata records carry no schema-version member. Evolution is monotonically
  additive: existing member meanings and types remain stable, new members are
  optional with defined absence behavior, and readers ignore and preserve
  unknown members. A breaking design requires a separately recognizable
  extension revision.

- Valid JSON objects are interpreted field by field. Invalid known members are
  ignored and diagnosed without disabling valid members; invalid and unknown
  members are preserved. A definition is wholly uninterpretable only when its
  value is invalid JSON or not an object.

- A Comment whose valid `re` points to a missing annotation, itself, another
  Reply, or a Change remains an unresolved Reply with visible inline content
  and preserved metadata. It is diagnosed, never silently promoted.

- Removing a root Comment in an extension-aware WYSIWYG editor removes its
  complete inline conversation and all associated definitions. Removing one
  Reply removes only that Reply and its definition. Direct source edits may
  leave recoverable orphans.

- `re` alone determines flat conversation membership. Replies need not be
  adjacent; Replies for the same root are presented in source order. Writers
  normally keep a conversation together for CM1 and source readability.
  
- Copies are new annotations with new IDs and copied current metadata. Duplicate definitions follow Markdown reference semantics: the first matching record wins and later definitions remain source.
  
- Malformed JSON, missing records, orphan records, and duplicate IDs remain ordinary editable source; an aware tool recovers where possible. Only resource and safety limits may reject a revision.
  
- A CM2-aware editor preserves unknown JSON fields when changing known ones.
  
- Existing CM1 annotations are never upgraded automatically.
  
- Implementation occurs in an opt-in MarkText profile on a dedicated proposal
  branch. Roughdraft product changes, production MarkText integration and
  polished UI, authenticated identity, signatures, complete edit history, and
  automatic CM1 migration are out of scope.
  
## Decisions so far
- [Identify CriticMarkup stewardship and the proposal path](issues/01-identify-stewardship-and-proposal-path.md) — No active formal acceptance mechanism exists; the canonical repository's issue tracker is the only evidenced public upstream venue.
- [Survey prior CriticMarkup extensions and metadata conventions](issues/02-survey-prior-extensions-and-metadata.md) — No accepted CM2 exists; incompatible shipping dialects and a prior MarkText registry validate the need while exposing delimiter, adjacency, malformed-data, and same-line merge hazards.
- [Test Markdown-native carriers for CM2 records](issues/03-test-markdown-metadata-carriers.md) — No existing carrier satisfies all requirements; CM2 needs its own bounded grammar and association semantics even if it borrows a Markdown-hidden construct.
- [Choose the proposal posture and submission package](issues/04-decide-proposal-posture-and-route.md) — Submit the complete, provisionally named CriticMarkup Metadata Extension 1 as the canonical issue, backed by its MarkText implementation branch and conformance corpus; do not pre-plan the maintainers' response.
- [Select the inline reference and metadata-definition grammar](issues/05-select-reference-and-registry-grammar.md) — Attach `<!--cmid:ID-->` to unchanged CM1 annotations and store augmentation JSON in the matching hidden `[ID]: <JSON>` Markdown definition; reply bodies remain inline Comments with their own IDs.
- [Define the metadata record model and lifecycle](issues/06-define-record-model-and-lifecycle.md) — Use one unversioned additive `{by, at, re, resolved}` object that augments but never duplicates CM1 kind or body; preserve unknowns and recover field-by-field while applying the settled conversation and ownership lifecycles.
## Not yet specified
<!-- The currently visible route to the destination is fully ticketed. -->
  
## Out of scope
- Roughdraft changes or compatibility.
  
- Production MarkText integration, settings, or polished review UI.
  
- Cryptographic identity, authentication, signatures, or trust claims.
  
- Full edit history or event sourcing.
  
- Metadata for Highlights.
  
- Automatic conversion of existing CM1 annotations.

- Posting the proposal issue or opening an upstream MarkText pull request.

- Predicting or deciding how the CriticMarkup maintainers will respond.

- Canonical acceptance, independent publication or governance, ecosystem
  adoption, and a second independent implementation after submission.
