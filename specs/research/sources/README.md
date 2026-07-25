# Research source materials

Raw inputs behind research docs 0004 and 0005 and the Profile 1 language specification
(`specs/language/marktext-markdown-profile-1.md`). The numbered research docs are the
synthesized, cross-checked conclusions; these files preserve the underlying reports verbatim
for provenance.

| File                                                   | What it is                                                                                                                                                                                                                                                      | Feeds         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `claude-deep-research-rust-parsers.json`               | Full verified findings of the Claude deep-research run on Rust OSS markdown parsers (10 findings, 25 claims 3-vote adversarially verified, refuted claims and caveats included)                                                                                 | 0004          |
| `gemini-rust-markdown-parsers-evaluation.pdf` / `.txt` | Google Gemini Deep Research report on the same question (independent run; PDF is the original artifact, txt is the extraction)                                                                                                                                  | 0004          |
| `claude-deep-research-cm-semantics.json`               | Full verified findings of the Claude deep-research run on CriticMarkup ecosystem semantics (11 findings, 24 claims verified incl. one refuted 0-3; one verifier compiled MultiMarkdown-6 to confirm behavior empirically)                                       | 0005          |
| `gemini-criticmarkup-semantics-analysis.pdf` / `.txt`  | Gemini Deep Research report on the same question (independent run)                                                                                                                                                                                              | 0005          |
| `claude-deep-research-build-vs-adopt.json`             | Full verified findings of the Claude deep-research run on building Profile 1 atop existing engines (12 findings, 22 claims 3-vote verified, 3 refuted)                                                                                                          | 0006 §7–§9    |
| `gemini-headless-engines-evaluation.md`                | Gemini Deep Research report on the same build-vs-adopt question (independent run; markdown as delivered)                                                                                                                                                        | 0006 §8       |
| `claude-deep-research-wide-sweep.json`                 | Full verified findings of the final wide engine sweep against the ratified R-1…R-7 set (12 findings, 21 claims verified — 19 at 3-0, 4 sub-claims refuted; markdig/goldmark/intellij-markdown walls verified to source)                                         | 0008          |
| `claude-deep-research-closeout-four-families.json`     | Close-out pass on flexmark-java, commonmark-java, swift-markdown, mistune: 25 claims 3-0 verified (flexmark + commonmark-java) plus 25 extracted source-quoted claims (swift-markdown + mistune, spot-verified by hand — synthesis agent died on a usage limit) | 0008 addendum |

Caution: the Gemini reports are the _unverified_ runs. Research 0005 documents specific
Gemini claims that failed primary-source verification (MMD-6-rendering-as-prepass, the
single-block "consensus", Fevol nesting support). Where a Gemini report and a numbered
research doc disagree, the numbered doc's verified finding governs.
