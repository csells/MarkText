import type { VNode } from 'snabbdom';
import type { IDocumentActiveFormat } from '../../editor/documentEditingTypes';
import type { Muya } from '../../index';
import type { Token } from '../../inlineRenderer/types';
import type { IInlineToolbarAction } from '../../types';
import type { ColorFormatType, IColorStyle } from '../../utils/colorSpan';
import type { IBaseOptions } from '../types';

import type { FormatToolIcon, IColorSection, IColorSwatch } from './config';
import Format from '../../block/base/format';
import { getCursorReference } from '../../selection';
import { isKeyboardEvent } from '../../utils';
import { parseColorStyle } from '../../utils/colorSpan';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import icons, { COLOR_SECTIONS } from './config';
import './index.css';

/** Default float options for inline format toolbar */
const defaultOptions = {
    placement: 'top' as const,
    offsetOptions: {
        mainAxis: 5,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

/** Format keyboard shortcuts without shift modifier */
const FORMAT_SHORTCUTS = {
    b: 'strong',
    i: 'em',
    u: 'u',
    d: 'del',
    e: 'inline_code',
    l: 'link',
} as const;

/** Format keyboard shortcuts with shift modifier */
const FORMAT_SHORTCUTS_SHIFT = {
    h: 'mark',
    e: 'inline_math',
    i: 'image',
    r: 'clear',
} as const;

/** Keys that should not trigger toolbar hiding */
const NON_EDITING_KEYS = new Set([
    'Shift',
    'Control',
    'Meta',
    'Alt',
    'Tab',
]);

/**
 * Inline format toolbar for text formatting
 * Provides quick access to text formatting options like bold, italic, etc.
 * Appears when text is selected
 */
export class InlineFormatToolbar extends BaseFloat {
    static pluginName = 'formatPicker';
    // Passive float: must not capture nav keys, or Enter over a selection is
    // swallowed while it's shown (#3196).
    public override capturesContentKeydown = false;

    /** Previous virtual node for patching */
    private _oldVNode: VNode | null = null;

    /** The block containing the selected text */
    private _block: Format | null = null;

    /** Currently applied formats in the selection */
    private _formats: readonly IDocumentActiveFormat[] = [];

    /**
     * A selection spanning blocks has no formatting tools; it shows only the
     * host's actions, which may operate across blocks.
     */
    private _hostActionsOnly = false;

    /** Toolbar configuration options */
    public override options: IBaseOptions;

    /** Format tool icons configuration */
    private _icons: FormatToolIcon[] = icons;

    /** Container element for the format toolbar */
    private _formatContainer: HTMLDivElement = document.createElement('div');

    private _colorPanelCloseTimer: number | null = null;

    /**
     * Create inline format toolbar instance
     * @param muya - Muya editor instance
     * @param options - Toolbar options
     */
    constructor(muya: Muya, options = {}) {
        const name = 'mu-format-picker';
        const opts = Object.assign({}, defaultOptions, options);
        super(muya, name, opts);
        this.options = opts;
        this.container!.appendChild(this._formatContainer);
        this.floatBox!.classList.add('mu-format-picker-container');
        this.listen();
    }

    /**
     * Listen to format picker events and keyboard shortcuts
     */
    override listen() {
        const { eventCenter, domNode, editor } = this.muya;
        super.listen();

        eventCenter.subscribe('muya-format-picker', ({ reference, block }) => {
            if (reference) {
                this._hostActionsOnly = false;
                this._block = block;
                this._formats = block.getActiveFormats();
                // Render first so the float is positioned at its real size;
                // an empty box placed above the selection grows over the
                // selected text until the next position update.
                requestAnimationFrame(() => {
                    this._render();
                    this.show(reference);
                });
            }
            else {
                this.hide();
            }
        });

        // While open, re-sync the highlight from the selection's current
        // formats — this is how formats applied outside the toolbar (menu /
        // command / shortcut) light up their buttons. Single-block tool, so
        // ignore collapsed / cross-block selections.
        eventCenter.subscribe('selection-change', ({ formats, isCollapsed, isSelectionInSameBlock }) => {
            if (!isCollapsed && !isSelectionInSameBlock) {
                this._showHostActionsOnly();
                return;
            }
            if (isCollapsed && this._hostActionsOnly) {
                this.hide();
                return;
            }
            if (!this.status || isCollapsed || !isSelectionInSameBlock)
                return;

            this._formats = formats;
            this._render();
        });

        eventCenter.attachDOMEvent(domNode, 'keydown', (event) => {
            this._handleKeydown(event, editor);
        });

        // Leaving the toolbar starts a short close delay: the pointer crosses a
        // gap to reach the panel, so an immediate close would dismiss it.
        eventCenter.attachDOMEvent(this.container!, 'mouseleave', () => {
            this._clearColorPanelTimer();
            this._colorPanelCloseTimer = window.setTimeout(
                () => this._closeColorPanelNow(),
                140,
            );
        });
        eventCenter.attachDOMEvent(this.container!, 'mouseenter', () => {
            this._clearColorPanelTimer();
        });
    }

    override hide() {
        this._closeColorPanelNow();
        super.hide();
    }

    private _showHostActionsOnly() {
        if (!(this.muya.options.inlineToolbarActions?.().length))
            return;
        this._hostActionsOnly = true;
        this._block = null;
        this._formats = [];
        requestAnimationFrame(() => {
            if (!this._hostActionsOnly)
                return;
            // A selection without drawable rects anchors to its focus paragraph.
            const focusNode = this.muya.editor.selection.focusBlock?.domNode;
            const reference = getCursorReference() ?? focusNode;
            if (!reference)
                return;
            this._render();
            this.show(reference);
        });
    }

    /**
     * Handle keyboard events for format shortcuts and toolbar hiding
     * @param event - Keyboard event
     * @param editor - Editor instance
     */
    private _handleKeydown(event: Event, editor: typeof this.muya.editor) {
        if (!isKeyboardEvent(event))
            return;

        const { key, shiftKey, metaKey, ctrlKey } = event;
        const selection = editor.selection.getSelection();
        if (!selection)
            return;

        const { anchor, isSelectionInSameBlock } = selection;
        const anchorBlock = anchor.block;

        if (!isSelectionInSameBlock) {
            if (this._hostActionsOnly)
                this._hideOnEditingKey(key, metaKey, ctrlKey);
            return;
        }

        // Hide toolbar on editing operations
        if (!(anchorBlock instanceof Format) || (!metaKey && !ctrlKey)) {
            this._hideOnEditingKey(key, metaKey, ctrlKey);
            return;
        }

        // Handle format shortcuts
        this._handleFormatShortcut(event, key, shiftKey, anchorBlock);
    }

    /**
     * Hide toolbar when an editing key is pressed
     * @param key - Key name
     * @param metaKey - Meta key state
     * @param ctrlKey - Control key state
     */
    private _hideOnEditingKey(key: string, metaKey: boolean, ctrlKey: boolean) {
        // Don't hide if it's a modifier/navigation key or if format shortcut is pressed
        if (NON_EDITING_KEYS.has(key) || metaKey || ctrlKey)
            return;

        if (this.status) {
            this.hide();
        }
    }

    /**
     * Handle format keyboard shortcuts
     * @param event - Keyboard event
     * @param key - Key name
     * @param shiftKey - Shift key state
     * @param anchorBlock - Anchor block
     */
    private _handleFormatShortcut(
        event: KeyboardEvent,
        key: string,
        shiftKey: boolean,
        anchorBlock: Format,
    ) {
        const shortcuts = shiftKey ? FORMAT_SHORTCUTS_SHIFT : FORMAT_SHORTCUTS;
        const formatType = shortcuts[key as keyof typeof shortcuts];

        if (formatType) {
            event.preventDefault();
            anchorBlock.format(formatType);
        }
    }

    /**
     * Render the format toolbar UI
     */
    private _render() {
        const { _icons: icons, _oldVNode: oldVNode, _formatContainer: formatContainer, _formats: formats } = this;
        const { i18n } = this.muya;

        const children = this._hostActionsOnly ? [] : icons.map(icon =>
            icon.type === 'color'
                ? this._createColorItem(icon, i18n)
                : this._createIconItem(icon, formats, i18n),
        );
        const actions = this.muya.options.inlineToolbarActions?.() ?? [];
        const iconActions = actions.filter(action => action.icon);
        const textActions = actions.filter(action => !action.icon);
        const vnode = h('div.mu-format-tools', [
            h('div.mu-format-row', [
                ...(children.length ? [h('ul', children)] : []),
                ...(iconActions.length ? [h('ul.mu-format-host-icons', iconActions.map(action => this._createHostIcon(action)))] : []),
            ]),
            ...(textActions.length ? [h('div.mu-format-host-actions', textActions.map(action => this._createHostAction(action)))] : []),
        ]);

        patch(oldVNode || formatContainer, vnode);
        this._oldVNode = vnode;
    }

    private _runHostAction(event: Event, id: string) {
        event.preventDefault();
        event.stopPropagation();
        const currentAction = this.muya.options.inlineToolbarActions?.().find(current => current.id === id);
        if (!currentAction?.enabled) {
            this._render();
            return;
        }
        const { selection } = this.muya.editor;
        const { anchor, focus, anchorBlock, anchorPath, focusBlock, focusPath } = selection;
        if (!anchor || !focus || !anchorBlock || !focusBlock)
            return;
        selection.setSelection(
            { offset: anchor.offset, block: anchorBlock, path: anchorPath },
            { offset: focus.offset, block: focusBlock, path: focusPath },
        );
        this.hide();
        currentAction.run();
    }

    private _createHostIcon(action: IInlineToolbarAction) {
        const iconElement = h('i.icon', h('i.icon-inner', {
            style: { 'background': `url(${action.icon}) no-repeat`, 'background-size': '100%' },
        }, ''));
        return h(`li.item.mu-format-host-icon${action.enabled ? '' : '.disabled'}`, {
            key: action.id,
            attrs: {
                'role': 'button',
                'data-action': action.id,
                'title': action.label,
                'aria-label': action.label,
                'aria-disabled': String(!action.enabled),
            },
            on: {
                mousedown: event => event.preventDefault(),
                click: event => this._runHostAction(event, action.id),
            },
        }, [h('div.icon-wrapper', iconElement)]);
    }

    private _createHostAction(action: IInlineToolbarAction) {
        return h('button.mu-format-host-action', {
            key: action.id,
            attrs: { 'type': 'button', 'data-action': action.id, 'disabled': !action.enabled },
            on: {
                mousedown: event => event.preventDefault(),
                click: event => this._runHostAction(event, action.id),
            },
        }, action.label);
    }

    /**
     * Create a format icon item
     * @param icon - Icon configuration
     * @param formats - Currently applied formats
     * @param i18n - Internationalization instance
     */
    private _createIconItem(icon: FormatToolIcon, formats: readonly IDocumentActiveFormat[], i18n: typeof this.muya.i18n) {
        const iconElement = h(
            'i.icon',
            h(
                'i.icon-inner',
                {
                    style: {
                        'background': `url(${icon.icon}) no-repeat`,
                        'background-size': '100%',
                    },
                },
                '',
            ),
        );

        const iconWrapper = h('div.icon-wrapper', iconElement);

        const isActive = formats.some(
            f => f.type === icon.type || (f.type === 'html_tag' && f.tag === icon.type),
        );

        const itemSelector = `li.item.${icon.type}${isActive ? '.active' : ''}`;

        return h(
            itemSelector,
            {
                attrs: {
                    title: `${i18n.t(icon.tooltip)}\n${icon.shortcut}`,
                },
                on: {
                    click: event => this._selectItem(event, icon),
                },
            },
            [iconWrapper],
        );
    }

    /**
     * Handle format item selection
     * @param event - Click event
     * @param item - Selected format tool icon
     */
    private _selectItem(event: Event, item: FormatToolIcon) {
        event.preventDefault();
        event.stopPropagation();

        const { selection } = this.muya.editor;
        const { anchor, focus, anchorBlock, anchorPath, focusBlock, focusPath } = selection;

        if (!anchor || !focus || !anchorBlock || !focusBlock)
            return;

        // Restore selection before formatting
        selection.setSelection(
            { offset: anchor.offset, block: anchorBlock, path: anchorPath },
            { offset: focus.offset, block: focusBlock, path: focusPath },
        );

        this._block!.format(item.type);

        // Hide toolbar for link and image, re-render for other formats
        if (/link|image/.test(item.type)) {
            this.hide();
        }
        else {
            this._formats = this._block!.getActiveFormats();
            this._render();
        }
    }

    private _colorState(): IColorStyle {
        const state: IColorStyle = { color: null, backgroundColor: null };

        for (const token of this._formats) {
            if (token.type !== 'html_tag')
                continue;

            const style = parseColorStyle(token.attrs?.style);
            if (!style)
                continue;
            if (style.color)
                state.color = style.color;
            if (style.backgroundColor)
                state.backgroundColor = style.backgroundColor;
        }

        return state;
    }

    /**
     * `A` tile previews the selection colours, its caret opens the picker on
     * hover, and clicking the tile clears both colours (Reset).
     */
    private _createColorItem(icon: FormatToolIcon, i18n: typeof this.muya.i18n) {
        const { color, backgroundColor } = this._colorState();

        // Unset properties must be omitted, not `undefined`: snabbdom only
        // clears an inline style when the key is absent from the new object.
        const iconStyle: Record<string, string> = {};
        if (color)
            iconStyle.color = color;
        if (backgroundColor)
            iconStyle['background-color'] = backgroundColor;

        const iconElement = h(
            'i.icon',
            {
                attrs: { title: i18n.t('Reset') },
                style: iconStyle,
                on: {
                    mousedown: (event: Event) => this._keepSelection(event),
                    click: (event: Event) => this._resetColors(event),
                },
            },
            h(
                'i.icon-inner',
                {
                    style: {
                        'background': `url(${icon.icon}) no-repeat`,
                        'background-size': '100%',
                    },
                },
                '',
            ),
        );
        const caret = h('i.caret', {
            on: {
                mouseenter: (event: Event) =>
                    this._openColorPanel(event.currentTarget as HTMLElement),
            },
        });
        const button = h('div.icon-wrapper', [iconElement, caret]);

        const panel = h('div.mu-color-panel', [
            ...COLOR_SECTIONS.map(section =>
                this._createColorSection(section, i18n),
            ),
            h(
                'button.mu-color-reset',
                {
                    attrs: { type: 'button' },
                    on: { click: (event: Event) => this._resetColors(event) },
                },
                i18n.t('Reset'),
            ),
        ]);

        return h(
            'li.item.color',
            { attrs: { title: i18n.t(icon.tooltip) } },
            [button, panel],
        );
    }

    private _openColorPanel(caret: HTMLElement) {
        const li = caret.closest<HTMLElement>('li.item.color');
        if (!li)
            return;

        this._clearColorPanelTimer();
        li.classList.add('mu-color-open');
        requestAnimationFrame(() => this._positionColorPanel(li));
    }

    private _clearColorPanelTimer() {
        if (this._colorPanelCloseTimer !== null) {
            window.clearTimeout(this._colorPanelCloseTimer);
            this._colorPanelCloseTimer = null;
        }
    }

    private _closeColorPanelNow() {
        this._clearColorPanelTimer();
        // Query from the float container: `_formatContainer` is replaced by the
        // first snabbdom patch, so it detaches from the tree after render.
        this.container
            ?.querySelector<HTMLElement>('li.item.color.mu-color-open')
            ?.classList
            .remove('mu-color-open');
    }

    /** Prefer above the toolbar; drop below when there is no room. */
    private _positionColorPanel(li: HTMLElement) {
        if (!li.classList.contains('mu-color-open') || !this.container)
            return;

        requestAnimationFrame(() => {
            const panel = li.querySelector<HTMLElement>('.mu-color-panel');
            if (!panel || !this.container)
                return;

            const spaceAbove = this.container.getBoundingClientRect().top;
            li.classList.toggle(
                'mu-color-panel-below',
                spaceAbove < panel.offsetHeight + 6,
            );
        });
    }

    private _keepSelection(event: Event) {
        event.preventDefault();
        event.stopPropagation();
    }

    private _createColorSection(
        section: IColorSection,
        i18n: typeof this.muya.i18n,
    ) {
        const { color, backgroundColor } = this._colorState();
        const activeValue
            = section.type === 'color' ? color : backgroundColor;
        const swatches = section.swatches.map(swatch =>
            this._createSwatch(section.type, swatch, activeValue, i18n),
        );

        return h('div.mu-color-section', [
            h('div.mu-color-title', i18n.t(section.title)),
            h('div.mu-color-swatches', swatches),
        ]);
    }

    private _createSwatch(
        type: ColorFormatType,
        swatch: IColorSwatch,
        activeValue: string | null,
        i18n: typeof this.muya.i18n,
    ) {
        const isActive = (swatch.value ?? null) === (activeValue ?? null);
        const isDefault = swatch.value === null;
        const selector = `div.mu-color-swatch.${type === 'color' ? 'text' : 'bg'}${
            isActive ? '.active' : ''
        }${isDefault ? '.default' : ''}`;

        const style: Record<string, string> = {};
        if (type === 'color') {
            if (swatch.value)
                style.color = swatch.value;
        }
        else if (swatch.value) {
            style['background-color'] = swatch.value;
        }

        return h(
            selector,
            {
                attrs: {
                    'title': i18n.t(swatch.label),
                    'data-color': swatch.value ?? '',
                },
                style,
                on: {
                    mousedown: (event: Event) => this._keepSelection(event),
                    click: (event: Event) =>
                        this._selectSwatch(event, type, swatch.value),
                },
            },
            type === 'color' ? 'A' : '',
        );
    }

    private _restoreSelection(): boolean {
        const { selection } = this.muya.editor;
        const { anchor, focus, anchorBlock, anchorPath, focusBlock, focusPath }
            = selection;

        if (!anchor || !focus || !anchorBlock || !focusBlock || !this._block)
            return false;

        selection.setSelection(
            { offset: anchor.offset, block: anchorBlock, path: anchorPath },
            { offset: focus.offset, block: focusBlock, path: focusPath },
        );

        return true;
    }

    private _selectSwatch(
        event: Event,
        type: ColorFormatType,
        value: string | null,
    ) {
        event.preventDefault();
        event.stopPropagation();

        if (!this._restoreSelection())
            return;

        this._block!.formatColor(type, value);
        this._refreshColorPanel(event);
    }

    /** Re-render, keeping the picker open when the pointer is still on it. */
    private _refreshColorPanel(event: Event) {
        const li = (event.target as HTMLElement | null)?.closest?.('li.item.color');
        const keepOpen = !!li?.classList.contains('mu-color-open');

        this._formats = this._block!.getFormatsInRange().formats;
        this._render();

        if (!keepOpen)
            return;

        const next = this.container?.querySelector<HTMLElement>('li.item.color');
        if (next) {
            next.classList.add('mu-color-open');
            this._positionColorPanel(next);
        }
    }

    private _resetColors(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        if (!this._restoreSelection())
            return;

        this._block!.formatColor('color', null);
        this._block!.formatColor('bg_color', null);
        this._refreshColorPanel(event);
    }
}
