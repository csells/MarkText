# CriticMarkup syntax versioning and metadata evolution

## Finding

CriticMarkup 1 has no evidenced language-version mechanism: no version field in a
document or mark, no numbered specification releases, no feature declaration or
negotiation syntax, and no repository tags or GitHub releases.

The canonical README calls its unnumbered forms simply "The Basic Syntax" and defines
the five marks directly. It does not identify a grammar version or describe how a
reader selects one.
([canonical README](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L29-L38))
The complete canonical tree at that commit contains the README and implementation
toolkits, but no separate versioned specification, schema, or version registry.
([repository tree](https://github.com/CriticMarkup/CriticMarkup-toolkit/tree/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6))
GitHub reported zero repository tags and zero releases when checked on 2026-08-14.
([tags](https://github.com/CriticMarkup/CriticMarkup-toolkit/tags),
[releases](https://github.com/CriticMarkup/CriticMarkup-toolkit/releases))

The repository history shows how a real syntax change was handled. In 2013 the
maintainers replaced the original `{{ }}` Highlight with `{== ==}` because the former
collided with static-site templates. The commit calls this a change to "the existing
CriticMarkup syntax," says such changes should be rare, and updates the README and
toolkits together. It does not add a document discriminator, retain parallel numbered
grammars, or negotiate old versus new behavior.
([Highlight syntax change](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/b107add658092b438ebf490e0bb4df20289dc003))

Thus the evidence-supported CM1 evolution model is an unversioned syntax changed by
community convention and coordinated implementation updates—not a protocol with
per-document or per-record version negotiation. This historical model is evidence,
not a requirement that a new extension repeat the breaking Highlight replacement.

## Recommendation for the JSON metadata schema

Use a **monotonic additive schema**, without a required `v` member in every metadata
record:

```markdown
{>>Needs a source.<<}<!--cmid:1-->

[1]: <{"by":"alice@example.test","at":"2026-08-14T09:00:00-07:00"}>
```

The proposal should make these evolution rules normative:

1. Every defined member keeps its meaning and JSON type permanently.
2. New revisions may add optional members; they do not make existing records invalid.
3. Readers ignore members they do not understand while preserving them whenever they
   rewrite the record.
4. Writers omit unavailable or inapplicable members.
5. No particular set of optional members is required merely to recognize the record
   as belonging to this extension.

This matches the extension's intended backwards-compatible-superset posture and the
already selected behaviors for optional attribution and unknown-field preservation.
It also keeps each one-line record smaller and avoids creating mixed `v` values that
look meaningful but provide no actual negotiation mechanism.

A required per-record version such as `"v":1` would be justified only if the proposal
intends to support mutually incompatible record grammars in one document. There is no
current requirement or canonical CriticMarkup precedent for that. It would instead:

- repeat the same constant on every metadata line;
- increase diff and merge surface;
- permit version skew between records in one document;
- force a policy for unknown versions before there is a second schema; and
- still fail to make an old implementation understand a future incompatible meaning.

If a future change cannot obey the additive rules—for example, it must reinterpret an
existing member or change the association grammar—it should be proposed as a distinct
extension revision with its own recognizable syntax or explicitly documented
compatibility boundary. A speculative `v` member should not reserve that decision now.

The proposal itself may be named **CriticMarkup Metadata Extension 1** for human
reference. That proposal-level name does not imply that every JSON object must carry
`"v":1`; the fixed `<!--cmid:ID-->` carrier already identifies the extension whose
record rules apply.
