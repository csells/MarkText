import type { ReferenceElement } from '@floating-ui/dom';
import type { ICriticMarkupItem } from '../../criticMarkup/commands';
import type { TCriticMarkupDecision } from '../../criticMarkup/project';
import type { ICriticMarkupReviewSnapshot } from '../../criticMarkup/reviewSnapshot';
import type { Muya } from '../../muya';
import type { IBaseOptions } from '../types';
import { deepestCriticMarkupItemId } from '../../criticMarkup/domIdentity';
import BaseFloat from '../baseFloat';

import './index.css';

interface ICriticMarkupToolPayload {
    item: ICriticMarkupItem;
    reference: ReferenceElement | null;
}

interface IReviewAction {
    className: 'accept' | 'reject' | 'remove';
    decision: TCriticMarkupDecision;
    label: 'Accept' | 'Reject' | 'Remove';
}

const CHANGE_ACTIONS: readonly IReviewAction[] = [
    { className: 'accept', decision: 'accept', label: 'Accept' },
    { className: 'reject', decision: 'reject', label: 'Reject' },
];

const REMOVE_ACTION: readonly IReviewAction[] = [
    { className: 'remove', decision: 'accept', label: 'Remove' },
];

const defaultOptions: IBaseOptions = {
    placement: 'top',
    offsetOptions: {
        mainAxis: 6,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

export class CriticMarkupReviewTool extends BaseFloat {
    static pluginName = 'criticMarkupReviewTool';

    private _openRequest = 0;
    private _openTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(muya: Muya, options: Partial<IBaseOptions> = {}) {
        super(
            muya,
            'mu-critic-markup-review-tool',
            Object.assign({}, defaultOptions, options),
        );
        this.floatBox!.classList.add(
            'mu-critic-markup-review-tool-container',
        );
        this.listen();
    }

    override listen() {
        super.listen();
        const { domNode, eventCenter } = this.muya;

        eventCenter.on(
            'muya-critic-markup-tool',
            (payload: ICriticMarkupToolPayload) => {
                if (!payload.reference) {
                    this._cancelAndHide();
                    return;
                }
                this._queueOpen(payload.item, payload.reference);
            },
        );
        eventCenter.on('selection-change', () => this._cancelAndHide());
        eventCenter.on('json-change', () => this._cancelAndHide());
        eventCenter.on(
            'critic-markup-review-change',
            (snapshot: ICriticMarkupReviewSnapshot) => {
                if (snapshot.projection !== 'marked')
                    this._cancelAndHide();
            },
        );
        eventCenter.attachDOMEvent(domNode, 'click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest<HTMLElement>(
                        '[data-critic-id], [data-critic-structural-id]',
                    )
                : null;
            const targetId = target
                ? deepestCriticMarkupItemId(
                        this.muya.editor.criticMarkupDocument.get(),
                        this.muya.domNode,
                        target,
                    )
                : null;
            if (
                targetId
                && this.muya.getCriticMarkupReviewSnapshot().items.some(item =>
                    item.type === 'comment'
                    && (item.id === targetId || item.anchorId === targetId))
            ) {
                this._cancelAndHide();
                return;
            }
            const item = targetId
                ? this.muya.focusCriticMarkup(targetId)
                : this.muya.getCurrentCriticMarkupItem();
            if (!item || item.type === 'comment') {
                this._cancelAndHide();
                return;
            }
            const anchor = this.muya.editor.selection.anchorBlock?.domNode;
            this._queueOpen(item, target ?? anchor ?? domNode);
        });
    }

    private _queueOpen(
        item: ICriticMarkupItem,
        reference: ReferenceElement,
    ) {
        const request = ++this._openRequest;
        if (this._openTimer)
            clearTimeout(this._openTimer);

        // Let the originating editor click reach BaseFloat's document handler
        // before opening, otherwise that same click immediately closes it.
        this._openTimer = setTimeout(() => {
            this._openTimer = null;
            if (
                request !== this._openRequest
                || this.muya.options.criticMarkupProjection !== 'marked'
            ) {
                return;
            }

            this._render(item);
            this.show(reference);
        }, 0);
    }

    private _render(item: ICriticMarkupItem) {
        const actions = item.type === 'highlight' || item.type === 'comment'
            ? REMOVE_ACTION
            : CHANGE_ACTIONS;
        const buttons = actions.map((action) => {
            const button = document.createElement('button');
            const label = this.muya.i18n.t(action.label);
            button.type = 'button';
            button.className = action.className;
            button.textContent = label;
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.muya.resolveCriticMarkup(action.decision);
                this._cancelAndHide();
            });

            return button;
        });

        const container = this.container!;
        container.replaceChildren();
        for (const button of buttons)
            container.appendChild(button);
    }

    private _cancelAndHide() {
        this._openRequest++;
        if (this._openTimer) {
            clearTimeout(this._openTimer);
            this._openTimer = null;
        }
        this.hide();
    }

    override destroy() {
        this._cancelAndHide();
        super.destroy();
    }
}

export default CriticMarkupReviewTool;
