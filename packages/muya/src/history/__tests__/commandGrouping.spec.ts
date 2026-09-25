// @vitest-environment jsdom
import type { DocumentEditing } from '../../editor/documentEditing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

// Upstream History groups by time alone, so a bound document's menu commands
// share the typing group of the one-second window around them.

describe('history command grouping', () => {
    const hosts: HTMLElement[] = [];
    const boot = () => {
        window.MUYA_VERSION = 'test';
        const host = document.body.appendChild(document.createElement('div'));
        hosts.push(host);
        const muya = new Muya(host, { markdown: 'aaa\n' });
        muya.init();
        return muya;
    };

    afterEach(() => {
        vi.restoreAllMocks();
        hosts.splice(0).forEach(host => host.remove());
    });

    it('shares the typing group within the window and ignores cutoffs inside the scope', () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
        const muya = boot();
        const { history } = muya.editor;
        muya.editor.documentEditing = {} as DocumentEditing;
        const typed = history.inputGroupFor('insertText', 'a');
        clock.mockReturnValue(10_100);
        let inside: number | undefined;
        history.groupCommands(() => {
            history.cutoff();
            inside = history.commandGroup();
        });
        expect(inside).toBe(typed);
        expect(history.commandGroup()).toBeUndefined();
        clock.mockReturnValue(10_200);
        expect(history.inputGroupFor('insertText', 'b')).toBe(typed);

        clock.mockReturnValue(11_500);
        history.groupCommands(() => {
            inside = history.commandGroup();
        });
        expect(inside).not.toBe(typed);
        clock.mockReturnValue(11_600);
        expect(history.inputGroupFor('insertText', 'c')).toBe(inside);
        muya.destroy();
    });

    it('leaves the legacy path to its json-change recording', () => {
        vi.spyOn(Date, 'now').mockReturnValue(10_000);
        const muya = boot();
        const { history } = muya.editor;
        let inside: number | undefined = -1;
        history.groupCommands(() => {
            inside = history.commandGroup();
        });
        expect(inside).toBeUndefined();
        muya.destroy();
    });
});
