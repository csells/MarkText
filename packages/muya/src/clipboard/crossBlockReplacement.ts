import type { Nullable } from '../types';
import { classifyInputKind } from '../history';

// Input types another handler already owns over a cross-block selection:
// clipboard, drag and drop, composition, and structural Enter.
const FOREIGN_INPUT_TYPES = new Set([
    'deleteByCut',
    'deleteByDrag',
    'deleteCompositionText',
    'insertCompositionText',
    'insertFromDrop',
    'insertFromPaste',
    'insertFromPasteAsQuotation',
    'insertLineBreak',
    'insertParagraph',
]);

export function crossBlockReplacement(inputType: string, data: Nullable<string>): Nullable<string> {
    if (FOREIGN_INPUT_TYPES.has(inputType))
        return null;

    switch (classifyInputKind(inputType)) {
        case 'delete':
            return '';
        case 'insert':
            return data ?? '';
        default:
            return null;
    }
}
