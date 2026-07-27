import type { ICriticMarkupReviewEditor } from '@marktext/document-view'

declare const editor: ICriticMarkupReviewEditor

// These compile-time failures prove desktop consumes the direct view's public
// CriticMarkup surface instead of an `any`-typed ambient shadow.
// @ts-expect-error substitutions require explicit replacement text
editor.createCriticMarkup({ type: 'substitution' })
// @ts-expect-error CriticMarkup decisions are accept or reject
editor.resolveCriticMarkup('merge')
// @ts-expect-error projections are marked, original, or revised
editor.configure({ criticMarkupProjection: 'draft' })
