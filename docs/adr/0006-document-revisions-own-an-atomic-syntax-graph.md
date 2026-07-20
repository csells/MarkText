# Document revisions own an atomic syntax graph

A document revision publishes one atomic syntax graph containing a lossless
canonical token tape, the canonical Markdown concrete syntax tree, the
CriticMarkup syntax forest, and the Original and Revised Markdown concrete
syntax trees with shared provenance maps. We reject one combined AST because
block-spanning CriticMarkup can cross Markdown containment and projections can
produce different Markdown structures. “One parser” means one authority and
one indivisible artifact, not one physical pass.
