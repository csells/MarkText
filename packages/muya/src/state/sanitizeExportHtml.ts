import type { Config } from 'dompurify';
import { EXPORT_DOMPURIFY_CONFIG } from '../config';
import runSanitize from '../utils/dompurify';

const FOREIGN_OBJECT_MARKER = 'data-muya-sanitized-foreign-object';

const OUTER_EXPORT_CONFIG: Config = Object.freeze({
    ...EXPORT_DOMPURIFY_CONFIG,
    ADD_TAGS: [
        ...((EXPORT_DOMPURIFY_CONFIG.ADD_TAGS ?? []) as string[]),
        'foreignObject',
    ],
    ADD_ATTR: [
        ...((EXPORT_DOMPURIFY_CONFIG.ADD_ATTR ?? []) as string[]),
        FOREIGN_OBJECT_MARKER,
    ],
});

/** Sanitize the complete rendered export while retaining safe Mermaid labels. */
export function sanitizeExportHtml(html: string): string {
    const staged = document.createElement('div');
    staged.innerHTML = html;

    const payloads = [...staged.querySelectorAll('foreignObject')].map(
        (node, index) => {
            const payload = runSanitize(
                node.innerHTML,
                EXPORT_DOMPURIFY_CONFIG,
            );
            node.replaceChildren();
            node.setAttribute(FOREIGN_OBJECT_MARKER, String(index));
            return payload;
        },
    );

    const result = document.createElement('div');
    result.innerHTML = runSanitize(staged.innerHTML, OUTER_EXPORT_CONFIG);
    const sanitizedForeignObjects = [
        ...result.querySelectorAll(`foreignObject[${FOREIGN_OBJECT_MARKER}]`),
    ];
    if (sanitizedForeignObjects.length !== payloads.length) {
        throw new TypeError(
            'Final export sanitization detached a rendered diagram label.',
        );
    }

    sanitizedForeignObjects.forEach((node, index) => {
        const marker = node.getAttribute(FOREIGN_OBJECT_MARKER);
        if (marker !== String(index)) {
            throw new TypeError(
                'Final export sanitization reordered rendered diagram labels.',
            );
        }
        node.removeAttribute(FOREIGN_OBJECT_MARKER);
        node.innerHTML = payloads[index];
    });

    return result.innerHTML;
}
