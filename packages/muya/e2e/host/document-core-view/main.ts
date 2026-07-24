import { createSourceSnapshot } from '@marktext/document-core';
import { createDocumentCoreView } from '../../../src/documentCore/documentCoreView';

/**
 * Mounts the PRODUCTION document-core view — the same `createDocumentCoreView`
 * the editor would use — so the browser proof exercises shipped code rather
 * than a harness-only rendering path.
 */
const host = document.querySelector<HTMLElement>('#document-core-view')!;

const view = await createDocumentCoreView({
    host,
    source: createSourceSnapshot(
        new URLSearchParams(location.search).get('source') ?? '# Title\n\nHello {++world++}.\n',
    ),
    parseConfiguration: {
        criticMarkupProfile: 'marktext-profile-1',
        markdownProfile: 'markdown-profile-1',
        liveHtmlSafetyProfile: 'live-html-safety-profile-1',
        executionBudget: {
            limitsProfile: 'test-unbounded',
            accountingSchema: 'syntax-accounting-1',
        },
    },
});

// A tiny bridge so the spec can drive edits the way the editor will: through
// typed intents against the engine, never by writing into the DOM.
Object.assign(window as unknown as Record<string, unknown>, {
    __documentCoreView: {
        modelText: () => view.modelText(),
        typeText: (offset: number, text: string) => view.typeText(offset, text),
        undo: () => view.undo(),
    },
});
host.setAttribute('data-ready', 'true');
