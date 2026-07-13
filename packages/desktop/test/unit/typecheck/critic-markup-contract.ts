import type { Muya } from '@muyajs/core'

declare const editor: Muya

// These compile-time failures prove desktop consumes Muya's real public
// CriticMarkup surface instead of an `any`-typed ambient shadow.
// @ts-expect-error substitutions require explicit replacement text
editor.createCriticMarkup({ type: 'substitution' })
// @ts-expect-error CriticMarkup decisions are accept or reject
editor.resolveCriticMarkup('merge')
// @ts-expect-error projections are marked, original, or revised
editor.setOptions({ criticMarkupProjection: 'draft' })
