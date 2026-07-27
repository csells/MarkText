# TypeScript

MarkText product source is TypeScript. Each package uses strict compiler
settings and owns its public boundary.

## Package boundaries

| Package | Responsibility |
| --- | --- |
| `@marktext/document-core` | Language, source, revisions, intents, history, materializers |
| `@marktext/document-view` | DOM mounting, browser input, browser selection |
| `marktext` | Electron host and Vue application |
| `marktext-website` | Documentation site |

Document-core cannot import document-view, Vue, Pinia, Electron, or browser
ambient libraries. Document-view depends inward on document-core. Desktop may
depend on both and must use the typed preload bridge for process boundaries.

## Source layout

Desktop TypeScript lives under:

- `packages/desktop/src/main`
- `packages/desktop/src/preload`
- `packages/desktop/src/renderer`
- `packages/desktop/src/shared`
- `packages/desktop/src/common`

Cross-process DTOs belong in `src/shared/types`. Browser-only declarations
belong in `src/types`. Avoid broad ambient shims for workspace packages;
import their exported types directly.

## Path aliases

Desktop aliases are mirrored in `electron.vite.config.ts`,
`vitest.config.ts`, and `tsconfig.base.json`:

| Alias | Target |
| --- | --- |
| `@` | renderer source |
| `common` | shared common utilities |
| `@shared` | cross-process desktop types |
| `@marktext/document-view` | direct view package entry point |

## Type rules

- Use `unknown` at untrusted boundaries and narrow it explicitly.
- Keep IPC request and response types serializable.
- Prefer exported package contracts to local lookalike interfaces.
- Do not cast DOM text into model coordinates; use parser-issued ranges.
- Keep browser, Node, and Electron ambient libraries out of document-core.
- Run package typechecks before broad desktop verification.

```bash
pnpm -C packages/document-core check
pnpm -C packages/document-view typecheck
pnpm -C packages/desktop typecheck
```
