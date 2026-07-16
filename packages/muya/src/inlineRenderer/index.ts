import type Format from '../block/base/format';
import type ParagraphContent from '../block/content/paragraphContent';
import type { Muya } from '../muya';
import type { IRenderCursor } from '../selection/types';
import type { TMarkdownStatePath } from '../state/markdownSourceMap';
import type { IParagraphState } from '../state/types';
import type { IHighlight, Labels } from './types';
import { MappedPathIndex } from '../mapped-range';
import { localRange } from '../mappedText';
import { markdownStatePath } from '../state/markdownSourceMap';
import logger from '../utils/logger';
import { criticMarkupFragmentsForPath } from './criticMarkupFragments';
import { tokenizer } from './lexer';
import {
    collectReferenceDefinitions,
    referenceDefinitionLabelInfo,
} from './referenceDefinitions';
import Renderer from './renderer';

const debug = logger('inlineRenderer:');

class InlineRenderer {
    public labels: Labels = new Map();
    private _labelsDocumentVersion = -1;
    public renderer: Renderer;

    private _criticMarkupFragmentPaths = new MappedPathIndex<TMarkdownStatePath, true>();

    constructor(public muya: Muya) {
        this.renderer = new Renderer(muya, this);
    }

    private _tokenizer(block: Format, highlights: IHighlight[]) {
        const { options } = this.muya;
        const { text } = block;
        const { labels } = this;

        // TODO: different content block should have different rules.
        // eg: atxheading.content has no soft|hard line break
        // setextheading.content has no heading rules.
        const hasBeginRules
            = /thematicbreak\.content|paragraph\.content|atxheading\.content/.test(
                block.blockName,
            );

        const criticMarkupDocumentFragments = criticMarkupFragmentsForPath(
            this.muya,
            block.path,
        );
        const criticMarkupDocument = this.muya.editor.criticMarkupDocument.get();

        return tokenizer(text, {
            hasBeginRules,
            labels,
            options: {
                ...options,
                criticMarkupDocumentFragments,
                criticMarkupProjectLocalRange:
                    options.criticMarkupProjection === 'marked'
                    && criticMarkupDocumentFragments.length > 0
                        ? (start, end, projection) =>
                                criticMarkupDocument.projectLocalRange(
                                    markdownStatePath(block.path),
                                    localRange(start, end),
                                    projection,
                                )
                        : undefined,
            },
            highlights,
        });
    }

    /**
     * Flush every cached image and force inline images to reload.
     *
     * The renderer memoises loaded images in `loadImageMap` (keyed by src,
     * skipped on the next render once `isSuccess` is true) and resolved URLs
     * in `urlMap`. When an image file changes on disk the cached entry would
     * otherwise keep the stale bitmap, so clearing both maps and re-rendering
     * every content block re-runs `loadImageAsync`, which loads the source
     * afresh.
     */
    invalidateImageCache() {
        this.renderer.loadImageMap.clear();
        this.renderer.urlMap.clear();

        const { scrollPage } = this.muya.editor;
        if (!scrollPage)
            return;

        scrollPage.breadthFirstTraverse((node) => {
            if (node.isContent())
                node.update();
        });
    }

    refreshCriticMarkupDocumentFragments() {
        const { editor } = this.muya;
        const { scrollPage } = editor;
        if (!scrollPage)
            return;
        this._refreshStructuralCriticMarkupNodes();
        const nextPaths = new MappedPathIndex<TMarkdownStatePath, true>();
        if (this.muya.options.criticMarkupProjection === 'marked') {
            for (const path of editor.criticMarkupDocument.get().pathsWithFragments())
                nextPaths.set(path, true);
        }
        const affectedPaths = new MappedPathIndex<TMarkdownStatePath, true>();
        for (const path of this._criticMarkupFragmentPaths.paths())
            affectedPaths.set(path, true);
        for (const path of nextPaths.paths())
            affectedPaths.set(path, true);
        this._criticMarkupFragmentPaths = nextPaths;
        if (!affectedPaths.size)
            return;

        // `getSelection()` resolves DOM offsets against the live tree, which
        // is O(block text) for large blocks. Right after a whole-tree rebuild
        // both the active block and the cached selection were cleared, so
        // there is nothing to preserve — skip the resolution entirely.
        const selection = editor.activeContentBlock || editor.selection.anchorBlock
            ? editor.selection.getSelection()
            : null;
        let renderedSelectionEndpoint = false;
        scrollPage.breadthFirstTraverse((node) => {
            if (
                !node.isContent()
                || !affectedPaths.has(markdownStatePath(node.path))
            ) {
                return;
            }

            const cursor = selection?.isSelectionInSameBlock
                && selection.anchor.block === node
                ? {
                        anchor: selection.anchor,
                        focus: selection.focus,
                        block: node,
                    }
                : undefined;
            if (
                selection
                && (selection.anchor.block === node || selection.focus.block === node)
            ) {
                renderedSelectionEndpoint = true;
            }
            node.update(cursor);
        });
        if (selection && renderedSelectionEndpoint) {
            editor.selection.setSelection(
                selection.anchor,
                selection.focus,
            );
        }
    }

    private _refreshStructuralCriticMarkupNodes(): void {
        const { editor } = this.muya;
        const { scrollPage } = editor;
        if (!scrollPage)
            return;
        scrollPage.bindCriticMarkupDocument(
            this.muya.options.criticMarkupProjection === 'marked'
                ? editor.criticMarkupDocument.get()
                : null,
        );
    }

    patch(block: Format, cursor?: IRenderCursor, highlights: IHighlight[] = []) {
        this._collectReferenceDefinitions();
        const { domNode } = block;
        if (block.isParent())
            debug.error('Patch can only handle content block');

        const tokens = this._tokenizer(block, highlights);
        const html = this.renderer.output(
            tokens,
            block,
            cursor && cursor.block === block ? cursor : {},
        );
        domNode!.innerHTML = html;
    }

    private _collectReferenceDefinitions() {
        // Every state mutation bumps documentVersion, so one collection per
        // version is exact. Recollecting per patched block cloned the whole
        // document O(blocks²) during full-tree rebuilds.
        const { jsonState } = this.muya.editor;
        if (jsonState.documentVersion === this._labelsDocumentVersion)
            return;
        this.labels = collectReferenceDefinitions(jsonState.getState());
        this._labelsDocumentVersion = jsonState.documentVersion;
    }

    getLabelInfo(blockOrState: ParagraphContent | IParagraphState) {
        return referenceDefinitionLabelInfo(blockOrState.text);
    }
}

export default InlineRenderer;
