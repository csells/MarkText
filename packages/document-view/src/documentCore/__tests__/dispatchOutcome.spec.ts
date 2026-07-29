// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
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

    // Non-negotiable 10, browser-input side: a refused gesture is stashed for
    // settled(), but the desktop only settles on flush/save boundaries — so
    // without a host report the user's keystroke vanishes without a trace.
    it('reports a refused browser input to the host as it happens', async () => {
        const host = document.createElement('div')
        document.body.append(host)
        const failures: unknown[] = []
        const view = await createTestDocumentCoreView({
            host,
            source: createSourceSnapshot('alpha target omega\n'),
            parseConfiguration: CONFIGURATION,
            onBrowserInputFailure: (error: unknown) => {
                failures.push(error)
            },
        })

        const detached = document.createElement('div')
        const orphan = document.createTextNode('x')
        detached.appendChild(orphan)
        const range = document.createRange()
        range.setStart(orphan, 0)
        range.collapse(true)
        const event = new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: 'x',
            bubbles: true,
            cancelable: true,
        })
        Object.defineProperty(event, 'getTargetRanges', {
            value: () => [range],
        })
        host.dispatchEvent(event)

        await vi.waitFor(() => {
            expect(failures).toHaveLength(1)
        })
        expect(String(failures[0])).toMatch(/outside the document-core view/)
        expect(view.getMarkdownSync()).toBe('alpha target omega\n')

        view.destroy()
        host.remove()
    })
})
