import {
    createDocumentSession,
    createSourceSnapshot,
    type EditorIntent,
    type ParseConfiguration,
} from '@marktext/document-core';
import { bindDocumentSession } from './browserAdapter';

const CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    liveHtmlSafetyProfile: 'live-html-safety-profile-1',
    executionBudget: {
        limitsProfile: 'test-unbounded',
        accountingSchema: 'syntax-accounting-1',
    },
};

const editor = document.querySelector<HTMLElement>('#document-core-editor');
if (editor === null)
    throw new Error('Document core tracer host is missing its editor');

const fixture = new URLSearchParams(window.location.search).get('fixture');
if (fixture !== null && fixture !== 'empty')
    throw new Error(`Unknown document-core tracer fixture: ${fixture}`);
const openingSource = fixture === 'empty' ? '' : 'a{++new++}b';
const openingCaret = fixture === 'empty' ? 0 : 5;

const session = await createDocumentSession({
    source: createSourceSnapshot(openingSource),
    parseConfiguration: CONFIGURATION,
    configuration: { authoringTextPolicy: 'nearest-owner-eol-v1' },
    initialView: 'markup',
    trackChanges: false,
    initialSelection: {
        anchor: { offset: openingCaret, affinity: 'next' },
        focus: { offset: openingCaret, affinity: 'next' },
    },
});

const adapter = bindDocumentSession(editor, Object.freeze({
    snapshot: session.snapshot,
    dispatch: session.dispatch,
    subscribe: session.subscribe,
}));

async function dispatchCommand(intent: EditorIntent): Promise<void> {
    const result = await session.dispatch(intent).completion;
    if (result.kind !== 'committed')
        throw new Error(`Tracer command did not commit: ${result.kind}`);
}

async function saveCanonicalSource(): Promise<'released' | 'already-terminal'> {
    const persist = window.persistDocumentCoreSnapshot;
    if (persist === undefined)
        throw new Error('The test-owned persistence binding is unavailable');

    const prepared = await session.preparePersistence('save').completion;
    if (prepared.kind !== 'flushed')
        throw new Error(`Tracer persistence is blocked: ${prepared.reason}`);

    const chunks: string[] = [];
    let expectedOffset = 0;
    let persistenceFailure: { readonly error: unknown } | undefined;
    try {
        for await (const chunk of prepared.source.readChunks()) {
            if (chunk.offset !== expectedOffset)
                throw new Error('Canonical source lease yielded non-contiguous chunks');
            chunks.push(chunk.text);
            expectedOffset += chunk.text.length;
        }
        await persist(chunks);
    }
    catch (error: unknown) {
        persistenceFailure = { error };
    }

    const release = await prepared.source.release('consumer-finished').completion;
    if (persistenceFailure !== undefined)
        throw persistenceFailure.error;
    return release.kind;
}

window.documentCoreTracer = Object.freeze({
    undo: () => dispatchCommand({ kind: 'undo' }),
    redo: () => dispatchCommand({ kind: 'redo' }),
    save: saveCanonicalSource,
    generations: adapter.generations,
});
