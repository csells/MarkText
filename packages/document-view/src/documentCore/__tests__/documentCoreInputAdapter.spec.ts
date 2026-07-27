// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
    documentCoreInputRange,
    setDocumentCoreModelBoundaries,
} from '../documentCoreInputAdapter';

describe('document-core input coordinates', () => {
    it('maps a single wrapped run without materializing its full text', () => {
        const host = document.createElement('div');
        const carrier = document.createElement('span');
        carrier.className = 'document-view-run';
        carrier.setAttribute('data-model-start', '0');
        carrier.setAttribute('data-model-end', '32000000');
        setDocumentCoreModelBoundaries(carrier, {
            kind: 'identity',
            start: 0,
            end: 32_000_000,
            textLength: 32_000_000,
        });
        const addition = document.createElement('ins');
        addition.setAttribute('data-model-start', '0');
        addition.setAttribute('data-model-end', '32000000');
        const text = document.createTextNode('xxx');
        addition.appendChild(text);
        carrier.appendChild(addition);
        host.appendChild(carrier);
        document.body.appendChild(host);

        const range = document.createRange();
        range.setStart(text, 2);
        range.collapse(true);
        const event = {
            currentTarget: host,
            getTargetRanges: () => [range],
        } as unknown as InputEvent;
        const materialize = vi.spyOn(Range.prototype, 'toString')
            .mockImplementation(() => {
                throw new Error('Input mapping materialized the rendered run');
            });

        expect(documentCoreInputRange(host, event)).toEqual({
            start: 2,
            end: 2,
        });
        expect(materialize).not.toHaveBeenCalled();
    });
});
