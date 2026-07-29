// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createTestDocumentCoreView } from './testDocumentCoreSession'
import {
    createSourceSnapshot,
    type ParseConfiguration,
} from '@marktext/document-core'

const CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
        schema: 'markdown-options-1',
        gfm: true,
        frontMatter: true,
        math: true,
        gitLabMath: false,
        footnotes: false,
        subscriptAndSuperscript: true,
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'desktop-v1',
        accountingSchema: 'syntax-accounting-1',
    },
}

describe('dispatchIntent outcome', () => {
    // Non-negotiable 10: a command that could not mutate the document must not
    // report that it did. The view surfaces a refused intent by throwing, so a
    // caller cannot mistake a rejection for a commit — this pins that contract,
    // because a silent resolve here would let every Review command report
    // success for an edit the engine refused.
    it('surfaces a refused intent instead of resolving silently', async () => {
        const host = document.createElement('div')
        document.body.append(host)
        const view = await createTestDocumentCoreView({
            host,
            source: createSourceSnapshot('alpha target omega\n'),
            parseConfiguration: CONFIGURATION,
        })

        await expect(
            view.dispatchIntent({
                kind: 'remove-comment',
                target: 'node:does-not-exist',
            } as never),
        ).rejects.toThrow(/target-not-found/)

        expect(view.getMarkdownSync()).toBe('alpha target omega\n')

        view.destroy()
        host.remove()
    })
})
