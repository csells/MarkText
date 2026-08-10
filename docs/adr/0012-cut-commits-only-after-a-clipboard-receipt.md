# Cut commits only after a clipboard receipt

> **Status:** Historical plan-0009 clipboard protocol. Plan 0010 retains the observable rule that
> clipboard failure must not delete document content; candidate IDs, receipts, digests, fencing,
> and journal mechanics are not target requirements.

Cut is a copy-first cross-boundary transaction. The document session prepares,
but does not commit, a revision-bound Cut candidate containing the exact
selection, clipboard bundle, semantic deletion intent, base revision, and a
digest over those identities. The desktop clipboard adapter writes every
required flavor from that pinned bundle before any document deletion can
commit. A clipboard receipt means the platform accepted the complete bundle;
it is bound to the preparation ID and digest and does not promise that another
application will preserve the clipboard forever.

Only a matching receipt may authorize the session's fenced Cut commit. The
session revalidates or proves the prepared target through intervening revision
transitions, applies the semantic deletion once, and journals the receipt
identity with that commit. A missing, failed, mismatched, replayed-for-another-
preparation, or stale receipt cannot authorize deletion. Operation IDs make
both preparation and commit idempotent.

Failure favors retaining document content. If clipboard writing fails, Cut
returns a visible failure and the revision is unchanged. If the clipboard write
succeeds but the prepared deletion becomes stale or the process stops before
durable commit, the result is copy-only: the clipboard may contain the bundle,
but the document remains unchanged and recovery must not invent or retry the
deletion. If the durable Cut commit wins before acknowledgement, normal session
recovery republishes that one committed deletion. There is no state in which
MarkText first deletes content and then attempts a best-effort clipboard write.

This ordering makes the unavoidable external clipboard side effect fail safe
without pretending it participates in the document journal's atomic commit.
Tests freeze clipboard rejection, partial-flavor rejection, stale revision,
duplicate messages, and crashes before and after clipboard acceptance and the
durable Cut record.
