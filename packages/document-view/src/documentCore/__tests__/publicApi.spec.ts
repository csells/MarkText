// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import * as documentView from '../../index';

/**
 * The document-engine view must be reachable from the package entry point.
 *
 * Increment 5 migrates the editor onto the engine flow by flow, which it can
 * `src/index.ts` is the single export hub, so an adapter that is not exported
 * there is not actually integrable, however well it works internally.
 */

describe('document-core view public API', () => {
    it('exports the view factory and the block renderer', () => {
        expect(typeof documentView.createDocumentCoreView).toBe('function');
        expect(typeof documentView.renderDocumentCoreBlocks).toBe('function');
        expect(documentView).not.toHaveProperty(
            'createStandaloneDocumentCoreSession',
        );
        expect(documentView).not.toHaveProperty('wordCount');
    });
});
