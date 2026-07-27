import { describe, expect, it } from 'vitest';
import { de, en, es, fr, ja, ko, pt, tr, zhCN, zhTW } from '../../locales';

describe('document-view locale completeness', () => {
    it('localizes every Quick Insert diagram label in every shipped locale', () => {
        for (const locale of [de, en, es, fr, ja, ko, pt, tr, zhCN, zhTW]) {
            expect(locale.resource.Flowchart, `${locale.name}:Flowchart`)
                .toBeTypeOf('string');
            expect(locale.resource.Sequence, `${locale.name}:Sequence`)
                .toBeTypeOf('string');
            expect(locale.resource.Flowchart.length).toBeGreaterThan(0);
            expect(locale.resource.Sequence.length).toBeGreaterThan(0);
        }
    });
});
