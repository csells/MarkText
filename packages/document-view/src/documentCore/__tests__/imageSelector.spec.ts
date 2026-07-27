// @vitest-environment happy-dom

import type { ParseConfiguration } from '@marktext/document-core';
import { createSourceSnapshot } from '@marktext/document-core';
import { describe, expect, it, vi } from 'vitest';
import {
    createTestDocumentCoreView as createDocumentCoreView,
} from './testDocumentCoreSession';

const PARSE_CONFIGURATION: ParseConfiguration = {
    criticMarkupProfile: 'marktext-profile-1',
    markdownProfile: 'markdown-profile-1',
    markdownOptions: {
        schema: 'markdown-options-1',
        gfm: true,
        frontMatter: true,
        math: true,
        gitLabMath: false,
        footnotes: true,
        subscriptAndSuperscript: true,
    },
    liveHtmlSafetyProfile: 'live-html-sanitized-v1',
    executionBudget: {
        limitsProfile: 'test-unbounded',
        accountingSchema: 'syntax-accounting-1',
    },
};

async function mount(source: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = await createDocumentCoreView({
        host,
        source: createSourceSnapshot(source),
        parseConfiguration: PARSE_CONFIGURATION,
    });
    return { host, view };
}

describe('Image selector', () => {
    it('does not interpret a form-control selection as a document selection', async () => {
        const { host, view } = await mount('See ');
        try {
            view.setCursorByOffset(4);
            await view.settled();
            await view.openImageSelector();

            const src = host.querySelector<HTMLInputElement>(
                '.document-view-image-selector input.src',
            );
            if (src === null)
                throw new Error('Expected the Image source control');

            const range = document.createRange();
            range.setStart(src, 0);
            range.collapse(true);
            const selection = document.getSelection();
            if (selection === null)
                throw new Error('Expected a browser selection');
            selection.removeAllRanges();
            selection.addRange(range);

            expect(() => document.dispatchEvent(
                new Event('selectionchange'),
            )).not.toThrow();
            await expect(view.settled()).resolves.toBeUndefined();
            expect(view.getSelection()).toEqual({ start: 4, end: 4 });
        }
        finally {
            await view.destroy();
            host.remove();
        }
    });

    it('keeps every Image selector action inside the viewport', async () => {
        const previousWidth = window.innerWidth;
        const previousHeight = window.innerHeight;
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 800,
        });
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 400,
        });
        const rect = vi.spyOn(
            HTMLElement.prototype,
            'getBoundingClientRect',
        ).mockImplementation(function (this: HTMLElement): DOMRect {
            if (this.classList.contains('document-view-float-wrapper')) {
                return new DOMRect(
                    Number.parseFloat(this.style.left || '0'),
                    Number.parseFloat(this.style.top || '0'),
                    320,
                    268,
                );
            }
            return new DOMRect(100, 100, 600, 800);
        });
        const { host, view } = await mount('See ');
        try {
            await view.openImageSelector();
            const wrapper = host.querySelector<HTMLElement>(
                '.document-view-float-wrapper',
            );
            if (wrapper === null)
                throw new Error('Expected the Image selector wrapper');

            expect(wrapper.getBoundingClientRect().bottom)
                .toBeLessThanOrEqual(window.innerHeight - 8);
        }
        finally {
            await view.destroy();
            host.remove();
            rect.mockRestore();
            Object.defineProperty(window, 'innerWidth', {
                configurable: true,
                value: previousWidth,
            });
            Object.defineProperty(window, 'innerHeight', {
                configurable: true,
                value: previousHeight,
            });
        }
    });
});
