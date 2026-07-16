// @vitest-environment happy-dom

import type { ICriticMarkupTrackChangeRejection } from '../trackedCriticMarkup';
import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';
import { MutationCommandDispatcher } from '../commandDispatcher';
import {
    CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS,
} from '../trackedCriticMarkup';

const editors: Muya[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
    while (editors.length)
        editors.pop()!.destroy();
    while (hosts.length)
        hosts.pop()!.remove();
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const muya = new Muya(host, {
        markdown,
        criticMarkupTrackChanges: true,
    });
    muya.init();
    editors.push(muya);
    return muya;
}

describe('track-change rejection contract', () => {
    it('publishes a typed reason from the closed taxonomy', () => {
        const muya = boot('keep {--old--} tail\n');
        const rejections: ICriticMarkupTrackChangeRejection[] = [];
        muya.on(
            'critic-markup-track-change-rejected',
            (rejection: ICriticMarkupTrackChangeRejection) => {
                rejections.push(rejection);
            },
        );

        // A tracked mutation whose captured ops cannot map to source edits
        // is the canonical unmappable rejection: mutate the live tree text
        // through the gateway with an inconsistent local edit description.
        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;
        const result = muya.editor.mutationGateway.run(
            { kind: 'user-command' },
            () => {
                leaf.text = 'rewritten beyond the described local edit';
            },
            {
                path: leaf.path,
                start: 0,
                end: 1,
                inserted: 'X',
            },
        );

        expect(result).toBe('rejected');
        expect(rejections).toHaveLength(1);
        const [rejection] = rejections;
        expect(CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS)
            .toContain(rejection.reason);
        expect(rejection.beforeMarkdown).toBe('keep {--old--} tail\n');
        expect(typeof rejection.proposedMarkdown).toBe('string');
    });

    it('reports the rejection result through the command dispatcher', () => {
        const muya = boot('keep {--old--} tail\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant()!;

        const dispatcher = new MutationCommandDispatcher(
            muya.editor.mutationGateway,
        );
        const result = dispatcher.run(
            { kind: 'user-command' },
            () => {
                leaf.text = 'rewritten beyond the described local edit';
            },
            {
                path: leaf.path,
                start: 0,
                end: 1,
                inserted: 'X',
            },
        );

        expect(result).toBe('rejected');
    });

    it('freezes the taxonomy to the four gateway reasons', () => {
        expect([...CRITIC_MARKUP_TRACK_CHANGE_REJECTION_REASONS].sort())
            .toEqual([
                'missing-tracked-selection-block',
                'parser-conflict',
                'unmappable-source-edit',
                'unmappable-tracked-selection',
            ]);
    });
});
