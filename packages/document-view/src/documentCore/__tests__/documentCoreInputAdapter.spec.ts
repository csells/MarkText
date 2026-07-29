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

    // A semantic container's model range covers syntax the renderer never
    // mounts — an ATX '### ' prefix here — so a container point cannot be
    // mapped by adding a rendered-text offset to the container's model start.
    // Doing that sent typed text in front of the heading marker, turning a
    // rename of '### B1' into '### Renamed# B1'-class corruption.
    const headingHost = (): {
        host: HTMLElement
        heading: HTMLElement
    } => {
        const host = document.createElement('div');
        const heading = document.createElement('h3');
        heading.setAttribute('data-model-start', '11');
        heading.setAttribute('data-model-end', '17');
        const run = document.createElement('span');
        run.className = 'document-view-run';
        run.setAttribute('data-model-start', '15');
        run.setAttribute('data-model-end', '17');
        setDocumentCoreModelBoundaries(run, {
            kind: 'identity',
            start: 15,
            end: 17,
            textLength: 2,
        });
        run.appendChild(document.createTextNode('B1'));
        heading.appendChild(run);
        // Non-editable chrome after the content, e.g. a copy-link button; a
        // caret collapsed to (heading, childNodes.length) lands after it.
        heading.appendChild(document.createElement('button'));
        host.appendChild(heading);
        document.body.appendChild(host);
        return { host, heading };
    };

    const rangeAt = (node: Node, offset: number): Range => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        return range;
    };

    const inputEventAt = (
        host: HTMLElement,
        node: Node,
        offset: number,
    ): InputEvent => ({
        currentTarget: host,
        getTargetRanges: () => [rangeAt(node, offset)],
    } as unknown as InputEvent);

    it('maps a container point after the content to the content end', () => {
        const { host, heading } = headingHost();
        expect(documentCoreInputRange(host, inputEventAt(host, heading, 2)))
            .toEqual({ start: 17, end: 17 });
        expect(documentCoreInputRange(host, inputEventAt(host, heading, 1)))
            .toEqual({ start: 17, end: 17 });
        host.remove();
    });

    it('maps a container point before the content to the content start', () => {
        const { host, heading } = headingHost();
        expect(documentCoreInputRange(host, inputEventAt(host, heading, 0)))
            .toEqual({ start: 15, end: 15 });
        host.remove();
    });

    it('maps a point in a runless container after its unmounted syntax', () => {
        const host = document.createElement('div');
        const heading = document.createElement('h3');
        heading.setAttribute('data-model-start', '11');
        heading.setAttribute('data-model-end', '14');
        host.appendChild(heading);
        document.body.appendChild(host);
        expect(documentCoreInputRange(host, inputEventAt(host, heading, 0)))
            .toEqual({ start: 14, end: 14 });
        host.remove();
    });
});
