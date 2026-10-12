Status: resolved
Type: grilling
Blocked by: 02

# Define the metadata record model and lifecycle

## Question

What minimal, versionable JSON object model augments the current state of a
Change or Comment without duplicating its inline human-authored content?

The decision must define Change, Comment, and reply record shapes; reply
relationships; creation and resolution fields; optional attribution and time;
unknown-field preservation; creation, copy,
accept/reject, remove, resolve/reopen, and orphan lifecycles; and malformed or
partially understood record behavior. All annotation and reply bodies remain
inline CriticMarkup. The JSON must avoid duplicating that content, encoding full
history, or storing editor-specific UI state.

## Decisions

- Every reply body remains inline as an ordinary CriticMarkup Comment. It has
  its own metadata marker and definition; its metadata relates it to the
  original annotation. Adding a reply therefore adds a new definition instead
  of rewriting the parent's JSON line.
- Metadata records creation provenance, not edit provenance. An
  extension-aware WYSIWYG editor does not offer one author the ability to edit
  another author's Comment. Source mode remains unrestricted, so the extension
  cannot reliably detect or attribute direct source edits and must not claim to
  do so.
- The same WYSIWYG ownership rule applies to every attributed Addition,
  Deletion, Substitution, Comment, and reply: only its original author may edit
  its body. Accepting, rejecting, replying, and resolving are separate actions
  and do not constitute editing another author's contribution.
- Resolution is current state on a root Comment and applies to its complete
  reply conversation. Replies cannot be resolved individually. Reopening
  clears the root's resolution metadata. Additions, Deletions, and
  Substitutions use accept/reject rather than resolution.
- Any participant may resolve or reopen a Comment conversation. Resolution
  records the self-asserted identity of the participant who performed the
  action and when it occurred; it does not change authorship of the root or its
  Replies.
- The minimal JSON schema uses top-level `by` and `at` for creation provenance,
  `re` on a Reply to identify its root Comment, and a nested `resolved` object
  on the root for resolution provenance. The presence of `resolved` means the
  conversation is resolved; reopening removes it. Missing provenance members
  are omitted, so `"resolved":{}` is valid. For example:

  ```json
  {"by":"alice","at":"2026-08-14T09:00:00-07:00","resolved":{"by":"carol","at":"2026-08-14T10:00:00-07:00"}}
  ```

  ```json
  {"by":"bob","at":"2026-08-14T09:30:00-07:00","re":"1"}
  ```
- Records have no per-record version member. The schema evolves monotonically:
  defined member meanings and JSON types remain stable; new members are
  optional and define behavior when absent; readers ignore unknown members and
  preserve them whenever rewriting a record; writers omit unavailable or
  inapplicable members. A future incompatible design requires a separately
  recognizable extension revision rather than reinterpretation of this schema.
- A syntactically valid JSON object is interpreted field by field. An invalid
  known member is ignored and diagnosed without disabling other valid members.
  Invalid known members and unknown members are preserved when the record is
  rewritten. The complete definition is uninterpretable only when its value is
  invalid JSON or is not a JSON object.
- When `by` is absent or invalid, authorship is unknown and an
  extension-aware WYSIWYG editor permits any participant to edit the body.
  Editing does not add `by` retroactively because that would misattribute
  creation; attribution is recorded only when a new contribution is created.
- A Comment with a syntactically valid `re` whose target is missing, itself, a
  Reply, or a Change remains an unresolved Reply. Its inline body and `re` are
  preserved and a diagnostic is reported; it is never silently promoted to a
  root Comment.
- Adding a Reply to a resolved conversation automatically reopens it by removing
  the root's `resolved` member. Previous resolution provenance is not retained
  as history.
- Removing a root Comment through an extension-aware WYSIWYG editor removes
  the complete inline conversation and all of its metadata definitions.
  Removing one Reply removes only that inline Reply and its definition. Direct
  source edits may leave recoverable orphans.
- `re` alone determines flat conversation membership; Replies need not be
  adjacent to the root or to one another. Replies with the same root are
  presented in source order. Writers normally place a conversation together
  for CM1 and source readability, but readers do not require it.
- Records do not repeat the CM1 annotation kind. Addition, Deletion,
  Substitution, and Comment identity comes exclusively from the annotation
  syntax to which the marker is associated.

The versioning decision is grounded in
`specs/research/criticmarkup-metadata-extension/criticmarkup-versioning.md`.
Canonical CriticMarkup has no language version field, numbered specification,
tags, releases, or negotiation syntax; the additive rule avoids repeating a
constant that would provide no actual negotiation mechanism.

## Answer

Every annotation uses the same small, unversioned, additive JSON object. The
optional `by` and `at` members record creation provenance. A Reply is an inline
Comment whose `re` member contains its root Comment ID. A root Comment's
optional `resolved` object records the current conversation-resolution
provenance. Bodies and annotation kinds remain exclusively in inline CM1
syntax; the JSON never duplicates them.

Known members are independently recoverable, unknown members survive rewrites,
and future schema evolution adds only optional fields with defined absence
behavior. The lifecycle and ownership rules in the decisions above preserve
authored content, make direct source damage recoverable, and make no claims of
authentication, source-edit attribution, or event history.
