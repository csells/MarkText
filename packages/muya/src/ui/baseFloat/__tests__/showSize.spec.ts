// @vitest-environment happy-dom

import type { Muya } from '../../../index';
import { describe, expect, it, vi } from 'vitest';
import BaseFloat from '../index';

class TestFloat extends BaseFloat {}

const reference = {
    getBoundingClientRect: () => ({ x: 0, y: 100, top: 100, left: 0, right: 0, bottom: 120, width: 0, height: 20, toJSON() {} }),
};

describe('baseFloat show()', () => {
    // The float is placed from its box size; an unsized box placed above the
    // reference lets its rendered content hang over the reference.
    it('sizes the box from its rendered content before placing it', () => {
        const float = new TestFloat({ eventCenter: { emit: vi.fn() } } as unknown as Muya, 'mu-test-float');
        Object.defineProperty(float.container!, 'offsetWidth', { value: 265 });
        Object.defineProperty(float.container!, 'offsetHeight', { value: 93 });
        float.show(reference);
        expect(float.floatBox!.style.width).toBe('265px');
        expect(float.floatBox!.style.height).toBe('93px');
        float.hide();
    });
});
