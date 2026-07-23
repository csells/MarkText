# Document revisions own an atomic syntax graph

A Complete document revision publishes one atomic parser artifact containing a lossless
canonical token tape and a graph of intrinsic Markdown and CriticMarkup syntax
nodes, including typed Substitution-arm subgraphs. It also owns Original and
Revised Markdown concrete syntax trees derived by recursive arm selection from
that graph with shared provenance maps. We reject one conventional containment-only AST because block-spanning
CriticMarkup can cross Markdown containment and projections can produce
different Markdown structures. Multiple parser phases are permitted only when
they directly build or refine that same parser-owned graph; a separate CM
recognizer, post-hoc forest/CST join, or flattened-projection parse is not “one
parser.” See ADR-0009 and ADR-0010.

A Source-only revision owns exact canonical source, configuration, identity,
and one fatal diagnostic but publishes no syntax graph, projection, or semantic
view.
