# Shared input policy

Pure typing decisions shared by MarkText's document model and Muya's existing
editing entry points. The caller supplies its owned syntax context; this package
never parses text or owns document state. Unknown context permits only decisions
that do not depend on Markdown syntax.

Run `pnpm build` to produce ESM, CommonJS and TypeScript declarations. Published
exports point to those artifacts; workspace development uses the same source.
