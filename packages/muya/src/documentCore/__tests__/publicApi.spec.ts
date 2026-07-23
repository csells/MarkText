// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import * as muya from '../../index';

/**
 * The document-engine view must be reachable from the package entry point.
 *
 * Increment 5 migrates the editor onto the engine flow by flow, which it can
 * only do if the shell can select this view behind the new-engine flag. muya's
 * `src/index.ts` is the single export hub, so an adapter that is not exported
 * there is not actually integrable, however well it works internally.
 */

describe('document-core view public API', () => {
    it('exports the view factory and the block renderer', () => {
        expect(typeof muya.createDocumentCoreView).toBe('function');
        expect(typeof muya.renderDocumentCoreBlocks).toBe('function');
    });
});
