// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { Muya } from '../muya';

it.each([
    { markdown: '<script>word</script>', visible: '<script>word</script>' },
    { markdown: '<!-- word -->', visible: '<Empty HTML Block>' },
])('keeps sanitized HTML discoverable without executing it: $markdown', ({ markdown, visible }) => {
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown: `${markdown}\n`, disableHtml: false });
    muya.init();
    try {
        expect(muya.domNode.querySelector('.mu-html-preview')?.textContent).toBe(visible);
        expect(muya.domNode.querySelector('.mu-html-preview script')).toBeNull();
        expect(muya.getMarkdown()).toBe(`${markdown}\n`);
    }
    finally {
        muya.destroy();
        muya.domNode.remove();
    }
});

it('opens the editable HTML source when its preview is clicked', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const muya = new Muya(host, { markdown: 'before\n\n<pre>word</pre>\n', disableHtml: false });
    muya.init();
    try {
        const preview = muya.domNode.querySelector('.mu-html-preview')!;
        preview.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        expect(muya.domNode.querySelector('.mu-html-block')?.classList.contains('mu-active')).toBe(true);
        expect(muya.getSelection()?.focus).toMatchObject({ path: [1, 'text'], offset: 0 });
        expect(muya.getMarkdown()).toBe('before\n\n<pre>word</pre>\n');
    }
    finally {
        muya.destroy();
        muya.domNode.remove();
    }
});
