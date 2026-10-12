Status: resolved
Type: research
Blocked by:

# Identify CriticMarkup stewardship and the proposal path

## Question

Who currently exercises normative, repository, package, and community authority
over CriticMarkup, how have language changes historically been proposed and
accepted, and through which person, repository, issue tracker, mailing list, or
other channel could an ecosystem-level metadata extension legitimately be
submitted now?

Use primary sources and distinguish formal authority from historical influence,
inactive ownership, and tool-specific adoption. Record any evidence that there
is no active acceptance mechanism.

## Research artifact

Planned branch: `research/cm2-stewardship`

## Answer

CriticMarkup has a canonical artifact but no active, documented standards
process. The de facto normative text is the README in the personal-account
repository `CriticMarkup/CriticMarkup-toolkit`. Gabe Weatherhead and Erik Hess
are the historically evidenced authors and maintainers, but public data does
not establish who currently controls the repository or whether either still
has write authority. There is no canonical package authority, elected
community steward, contribution policy, RFC process, release process, or other
formal acceptance mechanism.

The legitimate first step is a new, public, cross-linked RFC issue in the
canonical repository that asks Weatherhead and Hess to confirm current
stewardship and define what explicit act would constitute acceptance. Canonical
adoption requires a public normative decision plus a versioned specification
merge, ideally accompanied by a tag or release; a favorable comment, MarkText
support, or third-party package is not enough.

If no steward confirms an upstream route, publish a separately named,
ecosystem-neutral extension with its own versions, governance, conformance
corpus, and issue tracker. In that route, distinguish ecosystem adoption by
independent conforming implementations from tool support by MarkText alone.

Direct precedent reinforces this conclusion: the canonical tracker contains a
2015 referenced-comments proposal and a 2023 JSON metadata/replies proposal.
Neither was canonically accepted; the latter became Fevol's separately named,
tool-specific superset.

Research artifact: `specs/research/criticmarkup-metadata-extension/stewardship-and-proposal-path.md`
on branch `research/cm2-stewardship`, commit
`dbfe63e620d7bfb09f5fa1595e89f4c54a096a4b`.
