# CriticMarkup stewardship and proposal path

**Research date:** 2026-08-12  
**Question:** Who can legitimately accept an ecosystem-level CriticMarkup metadata extension, and what public proposal path exists?

## Conclusion

CriticMarkup has a **canonical artifact but no active, documented standards process**. The de facto normative text is the README in [`CriticMarkup/CriticMarkup-toolkit`](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md), a repository owned by the GitHub **user account** [`CriticMarkup`](https://api.github.com/users/CriticMarkup), not by a foundation or GitHub organization. The README names Gabe Weatherhead and Erik Hess as the 2013 copyright holders and authors; its public history shows Hess making the first major syntax revision and Weatherhead making the last syntax change and nearly all later merges ([README authorship and license](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L374-L386), [major syntax revision](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/a42a846ac191af10ccc2336135742a02d798f9e6), [highlight syntax revision](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/b107add658092b438ebf490e0bb4df20289dc003)).

The only legitimate public upstream submission channel now visible is that repository's [issue tracker](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues), directed to historical collaborators [`@macdrifter`](https://github.com/macdrifter) (Gabe Weatherhead) and [`@themindfulbit`](https://github.com/themindfulbit) (Erik Hess). That is a channel for **asking** for canonical adoption, not a functioning acceptance mechanism: the repository has no governance or contribution policy, no release or extension process, no tags or releases, and no syntax commit since 2013; its last commit of any kind was on 2021-02-27 ([repository tree](https://github.com/CriticMarkup/CriticMarkup-toolkit/tree/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6), [commit history](https://github.com/CriticMarkup/CriticMarkup-toolkit/commits/master/), [tags](https://github.com/CriticMarkup/CriticMarkup-toolkit/tags), [releases](https://github.com/CriticMarkup/CriticMarkup-toolkit/releases)). Two directly relevant extension proposals remain open, from [2015](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35) and [2023](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50); the 2023 proposal received no public reply from an upstream collaborator.

Therefore a MarkText-proven proposal can be submitted upstream, but nobody can presently promise that it can be “accepted” there. The proposal effort should first seek an explicit, public stewardship decision from Weatherhead and Hess. If no active steward answers, the honest fallback is to publish a separately versioned, ecosystem-neutral extension specification and build implementation consensus around it—not to claim that it is canonical CriticMarkup.

## Authority map

| Authority | Who exercises it | What the evidence supports—and does not support |
| --- | --- | --- |
| Normative language | De facto: the canonical repository README, historically authored by Gabe Weatherhead and Erik Hess | The README declares the five forms and the “Three Laws,” and names Weatherhead and Hess in its copyright notice ([canonical README](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L1-L14), [forms](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L21-L31), [copyright](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L374-L386)). There is no charter, standards body, editor roster, or documented rule for changing it in the repository tree. Apache-2.0 permission to modify and redistribute the text does not make every derivative normative. |
| Repository | Formally: the GitHub user account `CriticMarkup`; historically visible maintainers: Weatherhead and Hess | GitHub identifies `CriticMarkup` as a **User** account with one public repository ([account API](https://api.github.com/users/CriticMarkup)). Issue history marks both Weatherhead and Hess as repository collaborators ([Weatherhead comment](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/39#issuecomment-451777563), [Hess comment](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/17#issuecomment-55905529)). Public GitHub data does not reveal who currently controls the shared-looking owner account or whether either person's old collaborator permission remains active, so current write authority must be confirmed rather than inferred. |
| Packages and releases | No canonical package authority was found | The canonical repository contains source tools but publishes no GitHub package, tag, or release ([repository](https://github.com/CriticMarkup/CriticMarkup-toolkit), [tags](https://github.com/CriticMarkup/CriticMarkup-toolkit/tags), [releases](https://github.com/CriticMarkup/CriticMarkup-toolkit/releases)). Registry namespaces are controlled independently: for example, PyPI's `criticmarkup` names `mrshu` as maintainer and supplies no verified upstream relationship ([PyPI project](https://pypi.org/project/criticmarkup/)); Fevol's CodeMirror parser explicitly says it is “not affiliated with the CriticMarkup maintainers” ([parser README](https://github.com/Fevol/criticmarkup-parser#readme)). Package ownership therefore proves authority over that implementation only, not over the language. |
| Community interpretation and adoption | Decentralized among implementers; no elected or delegated community steward was found | MultiMarkdown is an influential implementation, but its own documentation credits “Gabe and Erik” for CriticMarkup and describes MultiMarkdown's implementation choices rather than claiming language ownership ([MultiMarkdown guide](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html#my-philosophy-on-criticmarkup)). Fevol owns the active Obsidian/CodeMirror extension implementation, but labels the parser unaffiliated and presented the syntax publicly as a proposed superset ([proposal](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50), [implementation README](https://github.com/Fevol/obsidian-criticmarkup#syntax)). These projects are valuable reviewers and adoption partners, not canonical approvers. |

## How language changes historically happened

The public history shows founder/maintainer discretion, not a repeatable governance workflow.

1. **A brief RFC was used once, but not as a documented process.** Hess opened [“RFC: CriticMarkup Syntax v0.3a”](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/1) on 2013-01-24. The issue had no public comments and was closed about 86 minutes later. The draft was added directly to the repository that day ([draft commit](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/f9f1f610f3eb6f2fae1612b61338a23f919a9083)). Nothing in the repository turns that episode into a standing RFC policy.
2. **The canonical five-form syntax was established by direct maintainer commits.** Hess made a direct “Major Syntax Revision” on 2013-02-09 and a direct “Gold Master 1.0” commit on 2013-02-11 ([revision](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/a42a846ac191af10ccc2336135742a02d798f9e6), [Gold Master](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/be617815c14d50aeac7466d2cad7680c3447a3ff)). No version tag or release accompanies the “Gold Master” commit.
3. **The last surface-syntax change was also direct.** On 2013-02-16 Weatherhead replaced `{{ ... }}` highlights with `{== ... ==}` because of template-engine collisions, updated the bundled tools in the same commit, and called such changes something that “should be rare” ([highlight change](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/b107add658092b438ebf490e0bb4df20289dc003)).
4. **Later issues elicited interpretations and invitations, but not new language.** In 2014 Hess said the project was “essentially finished,” while inviting suggested implementations for attribution and identifying cross-markup collisions as a major constraint ([attribution discussion](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/17#issuecomment-55904027), [invitation](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/17#issuecomment-55905529)). In 2019 Weatherhead said he considered the plain-text specification “relatively complete,” had no new features planned, and would pull toolkit changes he could test ([state of project](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/39#issuecomment-451777563)).
5. **Community proposals have remained proposals.** The 2015 [referenced-comments proposal](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35) put terse references inline and definitions at the end of the document. Weatherhead engaged on design tradeoffs and suggested existing MultiMarkdown bibliography syntax, but did not adopt a form into the canonical README ([maintainer response](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35#issuecomment-75368897)). The issue remains open.
6. **A metadata-and-replies extension has already been proposed and implemented outside the canonical language.** Fevol's 2023 proposal adds inline JSON metadata for authorship, time, completedness, and other fields, plus adjacent comments as replies ([proposal](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50)). Fevol later reported a private Obsidian Discord discussion with Weatherhead and said the proposal would ship under a separate superset name to encourage broader adoption ([follow-up](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50#issuecomment-1782105968)). The current Obsidian plugin constructs JSON-plus-`@@` annotations and groups directly adjacent comments as replies ([serialization source](https://github.com/Fevol/obsidian-criticmarkup/blob/ffe0df4feea9e14233fc5e98f101f5bc01ccf001/src/editor/base/edit-util/range-create.ts#L24-L48), [reply source](https://github.com/Fevol/obsidian-criticmarkup/blob/ffe0df4feea9e14233fc5e98f101f5bc01ccf001/src/editor/base/edit-util/range-parser.ts#L27-L58)). Neither the issue nor implementation claims canonical acceptance.

This is precedent for **tool-specific extension by an explicitly named superset**, not precedent for a successful upstream language-extension process.

## Is there an active acceptance mechanism?

No public, active acceptance mechanism was found as of the research date.

That conclusion is narrower than saying nobody can ever merge a change. It means the public project gives a proposer no defined decision maker, criteria, states, schedule, or release act by which an extension becomes canonical:

- the canonical tree has no `CONTRIBUTING`, governance, maintainers, roadmap, RFC, or extension-registry document ([pinned tree](https://github.com/CriticMarkup/CriticMarkup-toolkit/tree/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6));
- there are no tags or releases to carry a language version ([tags](https://github.com/CriticMarkup/CriticMarkup-toolkit/tags), [releases](https://github.com/CriticMarkup/CriticMarkup-toolkit/releases));
- the last syntax change was in 2013 and the last repository commit was in 2021 ([syntax commit](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/b107add658092b438ebf490e0bb4df20289dc003), [latest commit](https://github.com/CriticMarkup/CriticMarkup-toolkit/commit/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6));
- the 2015 referenced-comments issue and 2023 metadata/replies issue remain open, and the latter has no public upstream-maintainer response ([referenced comments](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35), [extensions](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50)); and
- even a small implementation contribution opened in 2025 remains an unreviewed pull request ([Objective-C and Swift implementations](https://github.com/CriticMarkup/CriticMarkup-toolkit/pull/53)).

The GitHub issue tracker is consequently the best available **intake channel**, but it is not evidence that a decision will be made. The old `criticmarkup.com` address still appears on the project account, but an HTTP request returned 404 and HTTPS did not produce a response during this investigation; it is not a usable current channel ([project account](https://github.com/CriticMarkup)). No official mailing list, forum, or standards-group venue is linked from the canonical repository.

## Recommended proposal path

### 1. Ask for stewardship before asking for syntax approval

Open a new public issue in [`CriticMarkup/CriticMarkup-toolkit`](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/new) with a title such as **“RFC: referenced metadata registry and comment threads.”** Cross-link the prior [reviewer-attribution question](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/17), [referenced-comments proposal](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35), and [JSON metadata/replies proposal](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/50). A new issue is preferable to silently taking over the 2023 proposal because the registry design has a different storage model and compatibility contract; the maintainers can ask that discussion be consolidated if they prefer.

Address `@macdrifter` first because he made the last canonical syntax change, merged the last repository changes, and gave the latest public maintainer statement. Address `@themindfulbit` as co-author and author of the major 2013 syntax revision. Ask them to answer publicly:

- whether either currently acts as CriticMarkup steward and can merge normative changes;
- whether the canonical project is willing to consider language extensions at all;
- what artifact and evidence would count as acceptance; and
- whether acceptance would be represented by a README/spec merge, an explicit version, and a tag or release.

Their historical influence is well evidenced; their **current** repository permission and willingness are not. The first response needed is therefore a stewardship confirmation, not an assumption.

### 2. Submit an evidence package, not only a syntax sketch

Link from the issue to an ecosystem-neutral proposal containing:

- motivation and terminology;
- a complete grammar and JSON schema;
- the explicit CM1-to-CM2 compatibility contract;
- handling of unknown fields, duplicate/missing/orphan records, malformed JSON, copying, and merging;
- security and resource-limit considerations;
- conformance fixtures and expected projections; and
- results from the opt-in MarkText prototype.

This responds directly to the maintainers' recorded concerns about collision, broad Markdown compatibility, readability, and payoff ([Three Laws](https://github.com/CriticMarkup/CriticMarkup-toolkit/blob/ba9011ba657d5c2c7ccca0137ff831ec7a93b8f6/README.md#L6-L14), [attribution response](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/17#issuecomment-55905529), [referenced-comment response](https://github.com/CriticMarkup/CriticMarkup-toolkit/issues/35#issuecomment-75368897)). Invite Fevol as a prior-extension implementer and Fletcher Penney as a major independent implementer, but describe their reviews accurately as implementation evidence, not delegated approval.

### 3. Require an explicit acceptance act

If a steward is active and supportive, submit the canonical-repository change they request. Treat the extension as **upstream accepted** only when the canonical owners publicly state its normative status and merge a versioned specification (ideally with a tag/release and conformance corpus). A favorable issue comment, a MarkText implementation, a package publication, or an upstream link to a third-party project is useful endorsement but is not by itself unambiguous normative adoption.

This explicit act is necessary because the project has historically conflated the README, toolkit, and specification and has no existing status vocabulary.

### 4. Define the no-response path up front

If no current steward confirms an acceptance route, publish the work as an independent, clearly named profile such as **“CriticMarkup Metadata Extension 1”** or **“CM2 Draft 1.”** State that it is a backward-compatible proposal derived from CriticMarkup, not an official successor. Keep the specification outside MarkText's product documentation, while using MarkText as the reference implementation.

Then seek de facto ecosystem adoption through:

1. a public specification repository and issue tracker;
2. stable versions and changelogs;
3. an implementation-neutral conformance corpus;
4. review from authors of active CriticMarkup parsers/editors; and
5. at least one independent implementation before declaring interoperability.

This fallback cannot manufacture upstream legitimacy, but it can create the governance and evidence that the original project lacks. If the canonical maintainers later return, they can adopt or link the mature extension with much less ambiguity.

## What “accepted” should mean

The proposal should distinguish three claims:

- **Canonical adoption:** the current `CriticMarkup` repository steward incorporates and versions the extension as normative CriticMarkup.
- **Ecosystem adoption:** multiple independent tools implement the same version and pass shared fixtures, whether or not the dormant canonical repository changes.
- **Tool support:** MarkText implements an opt-in profile. This proves implementability only.

Under the current evidence, only the third can be planned unilaterally. The first depends on re-establishing upstream stewardship; the second depends on independent implementers.

## Research limits

This report uses public primary sources: the canonical repository and its Git history, GitHub issues and pull requests, implementation-owned documentation and source, and official package-registry records. GitHub does not expose private repository-admin membership, private discussions, or control of the `CriticMarkup` user credentials. The report therefore distinguishes observable historical collaborator status from unverified current authority. The private Discord conversation reported by Fevol is treated only as Fevol's first-party account of that conversation, not as a canonical decision.
