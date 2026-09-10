// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Muya } from '../../../muya';
import { ImageResizeBar } from '../index';

const cleanups: (() => void)[] = [];
afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    vi.useRealTimers();
});

for (const finish of ['hide', 'destroy'] as const) {
    it(`cancels pending image handles when their owner receives ${finish}`, () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, { markdown: 'image' });
        muya.init();
        const resize = new ImageResizeBar(muya);
        cleanups.push(() => {
            resize.destroy();
            muya.destroy();
            host.remove();
        });
        vi.useFakeTimers();
        const visibility = vi.fn();
        muya.eventCenter.on('muya-float', (_owner, visible) => visibility(visible));
        const reference = document.createElement('span');
        muya.domNode.appendChild(reference);
        muya.eventCenter.emit('muya-transformer', { reference });
        if (finish === 'hide')
            muya.eventCenter.emit('muya-transformer', { reference: null });
        else resize.destroy();
        expect(() => vi.runAllTimers()).not.toThrow();
        expect(document.querySelectorAll('.mu-transformer .bar')).toHaveLength(0);
        expect(visibility).not.toHaveBeenCalledWith(true);
    });
}
