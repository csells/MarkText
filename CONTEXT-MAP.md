# Context map

Two bounded contexts share this repository:

| Context              | Glossary                            | Covers                                                                                                                                        |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| document-core engine | `packages/document-core/CONTEXT.md` | revisions, the MarkText Markdown/CriticMarkup profiles, projections, lanes, forks, safe points, segment maps, materializers, standing closers |
| Review & Comments UX | `CONTEXT.md`                        | comments, anchors, highlights, commented spans, point comments, active comments — the sidebar and review surface                              |

Engine terms are owned by the engine context; UX entries reference them
rather than redefining them. System-wide decisions live in `docs/adr/`.
