import type { HeadingChange, IInputPairingOptions, ImagePropertyPatch, ListChange, ListMarkerOptions } from '@marktext/input-policy';
import type { IDOMPoint, IDOMSelection } from '../selection/domTypes';

export interface IDocumentTextPoint {
    readonly path: readonly (string | number)[];
    readonly offset: number;
}

export interface IDocumentTextReplacement {
    readonly selection: {
        readonly anchor: DocumentTextPoint;
        readonly focus: DocumentTextPoint;
    };
    readonly text: string;
    readonly inputType: string;
    readonly historyGroup?: number;
}

/** Language context supplied by the same document model that renders this point. */
export interface IDocumentInputSyntaxContext {
    readonly type: 'format' | 'literal';
    readonly isInInlineMath: boolean;
    readonly isInInlineCode: boolean;
}

/** The actual selection and browser replacement target are distinct input facts. */
export interface IDocumentTextInput {
    readonly selection: {
        readonly anchor: DocumentDOMPoint;
        readonly focus: DocumentDOMPoint;
    };
    readonly range: {
        readonly anchor: DocumentDOMPoint;
        readonly focus: DocumentDOMPoint;
    };
    readonly inputType: string;
    readonly data: string | null;
    readonly options: Readonly<IInputPairingOptions & { readonly tabSize?: number }>;
    readonly historyGroup?: number;
}

export type IDocumentCommandInput = {
    readonly kind: 'command';
    readonly selection: IDocumentTextInput['selection'];
    readonly options: IDocumentTextInput['options'];
    readonly historyGroup?: number;
} & ({ readonly command: 'tab'; readonly shift: boolean } | { readonly command: 'setTaskChecked'; readonly checked: boolean; readonly autoCheck: boolean; readonly autoMoveCheckedToEnd: boolean } | { readonly command: 'createCodeBlock'; readonly replace: boolean } | { readonly command: 'wrapCodeBlocks' } | { readonly command: 'resetCodeBlock'; readonly selectionMode: 'preserve' | 'end' } | { readonly command: 'createMathBlock'; readonly replace: boolean } | { readonly command: 'changeThematicBreak'; readonly change: { readonly type: 'insert' | 'replace' | 'toggle' | 'reset' | 'enter' } } | { readonly command: 'createFrontMatter'; readonly replace: boolean; readonly style: string } | { readonly command: 'createTable'; readonly rows: number; readonly columns: number; readonly replace: boolean } | { readonly command: 'moveTableRow'; readonly target: DocumentDOMPoint; readonly row: number } | { readonly command: 'moveTableColumn'; readonly target: DocumentDOMPoint; readonly column: number } | { readonly command: 'insertTableRow' | 'insertTableColumn'; readonly placement: 'before' | 'after' } | { readonly command: 'removeTableRow' | 'removeTableColumn' | 'tableBoundaryBackspace' | 'exitTable' | 'joinParagraphBackward' | 'joinParagraphForward' } | { readonly command: 'changeList'; readonly change: ListChange; readonly listOptions: ListMarkerOptions } | { readonly command: 'changeHeading'; readonly change: HeadingChange } | { readonly command: 'changeBlockquote'; readonly change: { readonly type: 'set' | 'quick-insert' | 'toggle' | 'reset' } } | { readonly command: 'alignTableColumn'; readonly target: DocumentDOMPoint; readonly alignment: 'left' | 'center' | 'right' });

export type DocumentInput = IDocumentTextInput | IDocumentCommandInput;

/** A native formatting command retains the actual browser selection. */
export type IDocumentFormatInput = {
    readonly selection: {
        readonly anchor: DocumentDOMPoint;
        readonly focus: DocumentDOMPoint;
    };
} & ({
    readonly format: 'strong' | 'em' | 'del' | 'inline_code' | 'inline_math' | 'u' | 'mark' | 'sub' | 'sup' | 'link' | 'image' | 'unlink' | 'clear';
} | {
    readonly format: 'image-properties';
    readonly properties: ImagePropertyPatch;
});

export type DocumentClipboardInput = Readonly<{
    selection: { readonly anchor: DocumentDOMPoint; readonly focus: DocumentDOMPoint };
} & ({ kind: 'cut' } | { kind: 'paste'; markdown: string; pasteAsPlainText?: boolean })> | Readonly<{
    kind: 'table';
    selection: { readonly kind: 'table'; readonly ranges: readonly IDOMSelection[]; readonly primary: number };
} & ({ operation: 'delete' | 'cut' } | { operation: 'paste'; markdown: string; pasteAsPlainText?: boolean })>;

export interface IDocumentPreparedClipboard {
    readonly markdown: string;
    readonly plainText?: string;
    readonly bareUrl?: string;
    readonly pasteAsPlainText?: boolean;
}

export type DocumentCompositionResult
    = | { readonly kind: 'commit'; readonly data: string }
        | { readonly kind: 'cancel' }
        | { readonly kind: 'unavailable' };

export interface IDocumentActiveFormat {
    readonly type: string;
    readonly tag?: string;
}

/** The bound document model receives user actions before presentation changes. */
export interface IDocumentEditing {
    activeFormats: (selection: { readonly anchor: DocumentDOMPoint; readonly focus: DocumentDOMPoint }) => readonly IDocumentActiveFormat[];
    clipboard: (operation: DocumentClipboardInput, present: () => void) => boolean;
    prepareImage: (operation: Extract<DocumentFormatInput, { format: 'image-properties' }>, payload: unknown, prepare: (capturePayload: (payload: unknown) => void) => Promise<{ alt: string; src: string; title: string } | undefined>) => Promise<boolean>;
    prepareClipboard: (selection: DocumentClipboardInput['selection'], payload: unknown, prepare: (capturePayload: (payload: unknown) => void) => Promise<DocumentPreparedClipboard>) => Promise<boolean>;
    compositionStart: (operation: DocumentTextInput) => void;
    compositionUpdate: (data: string) => void;
    compositionEnd: (result: DocumentCompositionResult, present: () => void) => boolean;
    format: (operation: DocumentFormatInput) => boolean;
    /** Returns whether the model committed a source edit; selection-only input is false. */
    input: (operation: DocumentInput, present: () => void) => boolean;
}

export type DocumentTextPoint = IDocumentTextPoint;
export type DocumentDOMPoint = IDOMPoint;
export type DocumentTextReplacement = IDocumentTextReplacement;
export type DocumentTextInput = IDocumentTextInput;
export type DocumentInputSyntaxContext = IDocumentInputSyntaxContext;
export type DocumentEditing = IDocumentEditing;

export type DocumentFormatInput = IDocumentFormatInput;

export type DocumentPreparedClipboard = IDocumentPreparedClipboard;
