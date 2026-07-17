import type { VNode } from 'snabbdom';
import type {
    CriticMarkupDocumentFragmentToken,
    ISyntaxRenderOptions,
    Token,
} from '../types';
import type Renderer from './index';
import { CLASS_NAMES } from '../../config';
import { snakeToCamel } from '../../utils';

const TYPE_CLASSES = {
    addition: CLASS_NAMES.MU_CRITIC_ADDITION,
    deletion: CLASS_NAMES.MU_CRITIC_DELETION,
    substitution: CLASS_NAMES.MU_CRITIC_SUBSTITUTION,
    highlight: CLASS_NAMES.MU_CRITIC_HIGHLIGHT,
    comment: CLASS_NAMES.MU_CRITIC_COMMENT,
} as const;

function renderChildren(
    renderer: Renderer,
    children: Token[],
    options: ISyntaxRenderOptions,
): VNode[] {
    const { h, cursor, block } = options;
    return children.flatMap(child => renderer.dispatch(
        snakeToCamel(child.type),
        { h, cursor, block, token: child },
    ));
}

export default function criticDocumentFragment(
    this: Renderer,
    options: ISyntaxRenderOptions,
): VNode[] {
    const token = options.token as CriticMarkupDocumentFragmentToken;
    const { h, block, cursor } = options;
    const markerClass = this.getClassName(undefined, block, token, cursor);
    const markerNodes = new Map<number, VNode>();
    for (const segment of token.segments) {
        if (segment.kind === 'marker') {
            markerNodes.set(segment.localRange.start, h(
                `span.${markerClass}.${CLASS_NAMES.MU_REMOVE}.${CLASS_NAMES.MU_CRITIC_MARKER}`,
                this.highlight(
                    h,
                    block,
                    segment.localRange.start,
                    segment.localRange.end,
                    token,
                ),
            ));
        }
    }

    const contentNode = (
        arm: 'content' | 'old' | 'new',
        children: Token[],
    ) => {
        let element: 'ins' | 'del' | 'mark' = 'mark';
        let armClass = '';
        if (token.criticType === 'addition') {
            element = 'ins';
        }
        else if (token.criticType === 'deletion') {
            element = 'del';
        }
        else if (token.criticType === 'substitution') {
            element = arm === 'old' ? 'del' : 'ins';
            armClass = arm === 'old'
                ? `.${CLASS_NAMES.MU_CRITIC_OLD}`
                : `.${CLASS_NAMES.MU_CRITIC_NEW}`;
        }

        return h(
            `${element}.${CLASS_NAMES.MU_INLINE_RULE}${armClass}`,
            renderChildren(this, children, options),
        );
    };

    const nodes: VNode[] = [];
    for (const segment of token.segments) {
        if (segment.kind === 'marker') {
            const node = markerNodes.get(segment.localRange.start);
            if (node)
                nodes.push(node);
            continue;
        }
        if (token.criticType === 'comment') {
            nodes.push(h(
                `span.${markerClass}.${CLASS_NAMES.MU_REMOVE}.${CLASS_NAMES.MU_CRITIC_COMMENT_TEXT}`,
                this.highlight(
                    h,
                    block,
                    segment.localRange.start,
                    segment.localRange.end,
                    token,
                ),
            ));
            continue;
        }

        const arm = segment.arm === 'old' || segment.arm === 'new'
            ? segment.arm
            : 'content';
        nodes.push(contentNode(arm, segment.children));
    }

    if (
        token.criticType === 'comment'
        && (token.role === 'only' || token.role === 'end')
    ) {
        const focusComment = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            this.muya.focusCriticMarkup(token.itemId);
        };
        nodes.push(h(
            `span.${CLASS_NAMES.MU_CRITIC_COMMENT_INDICATOR}`,
            {
                attrs: {
                    contenteditable: 'false',
                    title: token.critic.type === 'comment'
                        ? token.critic.content
                        : '',
                },
                on: {
                    click: focusComment,
                },
            },
        ));
    }

    return [h(
        `span.${CLASS_NAMES.MU_CRITIC_MARKUP}.${TYPE_CLASSES[token.criticType]}`,
        {
            attrs: {
                'data-critic-id': token.itemId,
                'data-critic-role': token.role,
                'data-critic-type': token.criticType,
                'data-start': String(token.critic.range.start),
                'data-end': String(token.critic.range.end),
            },
        },
        nodes,
    )];
}
