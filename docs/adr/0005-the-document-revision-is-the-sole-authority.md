# The document revision is the sole authority

One document actor owns the decoded canonical Markdown source and its unified
Markdown/CriticMarkup interpretation for an open document. The DOM, editor
block tree, Review surfaces, projections, exports, and file bytes are derived
or hosted state. They do not become competing document authorities.

Accepted commands publish a new revision atomically. Durable recovery data may
record enough source and transition information to restore that revision, but
it is not a second semantic model. The concrete revision types, hashes,
journaling, rematerialization protocol, and worker-loss behavior are
implementation decisions governed by plan 0010's observable recovery and
latency requirements.
