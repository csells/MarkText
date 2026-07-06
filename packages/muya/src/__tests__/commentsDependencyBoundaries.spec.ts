import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('comment feature dependency boundaries', () => {
    it('keeps inline rendering on the authoritative analyzer instead of the parser internals', () => {
        const source = readFileSync(new URL('../inlineRenderer/index.ts', import.meta.url), 'utf8');

        expect(source).not.toContain('from \'../comments/parse\'');
        expect(source).not.toContain('from "../comments/parse"');
    });

    it('keeps metadata source edits on analyzer source maps instead of the raw source-index builder', () => {
        const source = readFileSync(new URL('../comments/edit.ts', import.meta.url), 'utf8');

        expect(source).not.toContain('from \'./source\'');
        expect(source).not.toContain('buildCommentSourceIndex');
    });

    it('keeps markdown import restoration on analyzer source maps instead of the raw source-index builder', () => {
        const source = readFileSync(new URL('../state/markdownToState.ts', import.meta.url), 'utf8');

        expect(source).not.toContain('from \'../comments/source\'');
        expect(source).not.toContain('buildCommentSourceIndex');
    });

    it('keeps HTML export stripping on analyzer source maps instead of the raw strip helper', () => {
        const asyncExportSource = readFileSync(new URL('../state/markdownToHtml.ts', import.meta.url), 'utf8');
        const staticExportSource = readFileSync(new URL('../state/renderToStaticHTML.ts', import.meta.url), 'utf8');

        expect(asyncExportSource).not.toContain('stripCommentSyntaxFromMarkdown');
        expect(staticExportSource).not.toContain('stripCommentSyntaxFromMarkdown');
    });

    it('keeps paste id remapping on analyzer source maps instead of raw id/source-index helpers', () => {
        const source = readFileSync(new URL('../clipboard/paste.ts', import.meta.url), 'utf8');

        expect(source).not.toContain('collectSourceCommentIds');
        expect(source).not.toContain('buildCommentSourceIndex');
    });
});
