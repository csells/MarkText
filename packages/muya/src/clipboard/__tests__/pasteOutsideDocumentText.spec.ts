// @vitest-environment happy-dom
import type { DocumentEditing } from '../../editor/documentEditingTypes';
import { afterEach, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

// A paste while the selection lies outside the document's text, such as after
// a drag that began on a heading's link icon, once rejected with "Clipboard
// import has no document selection". Upstream ignores such a paste.

const hosts: HTMLElement[] = [];
afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

it.each([
    ['plain text', { 'text/plain': 'pasted' }],
    ['HTML', { 'text/plain': 'pasted', 'text/html': '<p>pasted</p>' }],
])('ignores a %s paste whose selection lies outside the document text', async (_name, formats) => {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host);
    muya.init();
    muya.setContent('### Heading\n\nText\n');
    hosts.push(muya.domNode);
    const prepareClipboard = vi.fn();
    muya.editor.bindDocumentEditing({ prepareClipboard } as unknown as DocumentEditing);
    const heading = muya.domNode.querySelector('h3')!;
    const range = document.createRange();
    range.selectNodeContents(heading);
    range.collapse(false);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(muya.editor.selection.getDOMSelection()).toBeNull();

    const data = new DataTransfer();
    for (const [format, value] of Object.entries(formats))
        data.setData(format, value);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });

    await expect(muya.editor.clipboard.pasteHandler(event)).resolves.toBeUndefined();
    expect(prepareClipboard).not.toHaveBeenCalled();
});
