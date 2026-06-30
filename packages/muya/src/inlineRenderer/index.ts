import type Format from '../block/base/format';
import type ParagraphContent from '../block/content/paragraphContent';
import type { TBlockPath } from '../block/types';
import type { ICommentRange, IParsedMarkdownComments } from '../comments/types';
import type { Muya } from '../muya';
import type { IRenderCursor } from '../selection/types';
import type { IParagraphState, TContainerState, TState } from '../state/types';
import type { IHighlight, Labels } from './types';
import { parseMarkdownComments } from '../comments/parse';
import { isCommentMetadataReference } from '../comments/syntax';
import logger from '../utils/logger';
import { tokenizer } from './lexer';
import Renderer from './renderer';
import { beginRules } from './rules';

const debug = logger('inlineRenderer:');

interface IRenderSelectionRange {
    anchorPath: TBlockPath;
    focusPath: TBlockPath;
    begin: number;
    end: number;
}

class InlineRenderer {
    public labels: Labels = new Map();
    public renderer: Renderer;

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

        return tokenizer(text, { hasBeginRules, labels, options, highlights });
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

    patch(block: Format, cursor?: IRenderCursor, highlights: IHighlight[] = []) {
        this._collectReferenceDefinitions();
        const { domNode } = block;
        if (block.isParent())
            debug.error('Patch can only handle content block');

        const tokens = this._tokenizer(block, [
            ...this._commentHighlights(block, cursor),
            ...highlights,
        ]);
        const html = this.renderer.output(
            tokens,
            block,
            cursor && cursor.block === block ? cursor : {},
        );
        domNode!.innerHTML = html;
    }

    private _commentHighlights(block: Format, cursor?: IRenderCursor): IHighlight[] {
        const comments = parseMarkdownComments(this.muya.editor.jsonState.getState());
        if (!comments.ranges.length)
            return [];

        const blockIndexes = this._contentBlockIndexes();
        const blockKey = this._pathKey(block.path);
        const blockIndex = blockIndexes.get(blockKey);
        if (blockIndex === undefined)
            return [];

        const activeIds = this._activeCommentIds(comments, cursor);
        const highlights: IHighlight[] = [];

        for (const range of comments.ranges) {
            const startKey = this._pathKey(range.startPath);
            const endKey = this._pathKey(range.endPath);
            const startIndex = blockIndexes.get(startKey);
            const endIndex = blockIndexes.get(endKey);

            if (
                startIndex === undefined
                || endIndex === undefined
                || blockIndex < startIndex
                || blockIndex > endIndex
            ) {
                continue;
            }

            const start = blockKey === startKey ? range.startOffset : 0;
            const end = blockKey === endKey ? range.endOffset : block.text.length;
            if (start < end) {
                highlights.push({
                    start,
                    end,
                    active: activeIds.has(range.id),
                    type: 'comment',
                });
            }
        }

        return highlights;
    }

    private _contentBlockIndexes() {
        const indexes = new Map<string, number>();
        let index = 0;

        this.muya.editor.scrollPage?.depthFirstTraverse((node) => {
            if (node.isContent())
                indexes.set(this._pathKey(node.path), index++);
        });

        return indexes;
    }

    private _activeCommentIds(comments: IParsedMarkdownComments, cursor?: IRenderCursor) {
        const activeIds = new Set<string>();
        const selection = this._renderSelectionRange(cursor);
        if (!selection)
            return activeIds;

        for (const range of comments.ranges) {
            if (this._selectionIntersectsRange(
                range,
                selection.anchorPath,
                selection.focusPath,
                selection.begin,
                selection.end,
            )) {
                activeIds.add(range.id);
            }
        }

        return activeIds;
    }

    private _renderSelectionRange(cursor?: IRenderCursor): IRenderSelectionRange | null {
        if (cursor?.block && cursor.anchor && cursor.focus) {
            return {
                anchorPath: cursor.block.path,
                focusPath: cursor.block.path,
                begin: Math.min(cursor.anchor.offset, cursor.focus.offset),
                end: Math.max(cursor.anchor.offset, cursor.focus.offset),
            };
        }

        const selection = this.muya.editor.selection.getSelection();
        if (!selection)
            return null;

        return {
            anchorPath: selection.anchor.path,
            focusPath: selection.focus.path,
            begin: Math.min(selection.anchor.offset, selection.focus.offset),
            end: Math.max(selection.anchor.offset, selection.focus.offset),
        };
    }

    private _selectionIntersectsRange(
        range: ICommentRange,
        anchorPath: TBlockPath,
        focusPath: TBlockPath,
        begin: number,
        end: number,
    ) {
        if (!this._samePath(anchorPath, focusPath) || !this._samePath(anchorPath, range.startPath))
            return false;
        if (!this._samePath(range.startPath, range.endPath))
            return false;

        return begin <= range.endOffset && end >= range.startOffset;
    }

    private _samePath(a: TBlockPath, b: TBlockPath) {
        return a.length === b.length && a.every((part, index) => part === b[index]);
    }

    private _pathKey(path: TBlockPath) {
        return JSON.stringify(path);
    }

    private _collectReferenceDefinitions() {
        const state = this.muya.editor.jsonState.getState();
        const labels = new Map();

        const travel = (sts: TState[]) => {
            if (Array.isArray(sts) && sts.length) {
                for (const st of sts) {
                    if (st.name === 'paragraph') {
                        const { label, info } = this.getLabelInfo(st);
                        if (label && info)
                            labels.set(label, info);
                    }
                    else if ((st as TContainerState).children) {
                        travel((st as TContainerState).children);
                    }
                }
            }
        };

        travel(state);

        this.labels = labels;
    }

    getLabelInfo(blockOrState: ParagraphContent | IParagraphState) {
        const { text } = blockOrState;
        const tokens = beginRules.reference_definition.exec(text);
        let label = null;
        let info = null;
        if (tokens) {
            const rawLabel = tokens[2] + tokens[3];
            if (!isCommentMetadataReference(rawLabel, tokens[6])) {
                label = rawLabel.toLowerCase();
                info = {
                    href: tokens[6],
                    title: tokens[10] || '',
                };
            }
        }

        return { label, info };
    }
}

export default InlineRenderer;
