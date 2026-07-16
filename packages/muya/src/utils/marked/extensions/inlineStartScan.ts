/**
 * Bounded scanning for inline extension `start()` callbacks.
 *
 * Marked calls every inline extension's `start()` once per plain-text step,
 * passing the whole remaining inline source, and the naive implementations
 * scan all of it with an unanchored regex. On a document whose inline run is
 * large (a single no-blank-line 4,096-line paragraph is one ~245KB inline
 * source) that turns lexing into O(n^2): tens of thousands of start calls,
 * each rescanning up to the full remaining source.
 *
 * `windowedInlineStart` caps each call to a prefix window. When the start
 * rule finds nothing inside the window, it returns a "checkpoint": the index
 * of a newline near the window edge. Marked clips the pending text token at
 * the checkpoint and calls `start()` again on the next loop turn, so the
 * scan resumes past the checkpoint instead of rescanning the same region —
 * amortized linear over the inline source.
 *
 * Checkpoints are chosen so they cannot change the emitted tokens:
 *
 * - No inline tokenizer (built-in or extension) anchors on a bare newline,
 *   and marked merges adjacent text tokens, so an extra text split at a
 *   newline is invisible.
 * - The checkpoint steps back over a trailing `  `/`\` hard-break prefix
 *   (those land on a ` ` or `\`; `\` and 2+-space runs are positions the
 *   unbounded lexer visits anyway) so the `br` tokenizer still sees the
 *   full construct.
 * - A newline directly followed by `^` is skipped: the superscript start
 *   rule requires a NON-space predecessor, but its `^`-anchor alternative
 *   would match at the artificial resume position and recognize a
 *   superscript the unbounded scan rejects. (`$`, `:`, `~` successors are
 *   fine — their rules accept a whitespace predecessor, so the unbounded
 *   scan finds them too.)
 * - A start-rule match whose trailing lookahead touches the window edge may
 *   be a false positive against the truncated source, so it is discarded
 *   and re-scanned in the next window instead of being trusted.
 */

// Marked retries `start()` after every consumed token, so windows overlap
// heavily in marker-free text; a small window keeps that redundancy cheap
// while the checkpoint crawl amortizes long marker-free spans to one visit
// per window.
const INLINE_START_SCAN_WINDOW = 512;

// Start rules end in one-character negative lookaheads (e.g. `(?!\$)`); a
// match this close to the window edge may misjudge the following text.
const LOOKAHEAD_MARGIN = 4;

export interface IInlineStartCandidate {
    /** Index the extension would hand to marked for this candidate. */
    readonly index: number;
    /** End of the start-rule match, for window-edge reliability checks. */
    readonly matchEnd: number;
    /** Whether the full token rule accepted the candidate. */
    readonly verified: boolean;
}

/**
 * Drive `scan` over growing prefix windows of `src` and return what the
 * unbounded scan would have: the first verified candidate's index, or
 * undefined (both "no start-rule match anywhere" and "first candidate failed
 * verification" return undefined, mirroring the original extensions).
 *
 * `scan(slice, full)` locates the first start-rule match in `slice` and
 * verifies it against `full` (verification rules may read past the window
 * edge, so they must never run on the slice).
 */
export function windowedInlineStart(
    src: string,
    scan: (slice: string, full: string) => IInlineStartCandidate | undefined,
): number | undefined {
    let windowEnd = INLINE_START_SCAN_WINDOW;
    for (;;) {
        if (windowEnd >= src.length) {
            const candidate = scan(src, src);
            return candidate?.verified ? candidate.index : undefined;
        }
        const candidate = scan(src.slice(0, windowEnd), src);
        let checkpointLimit = windowEnd;
        if (candidate !== undefined) {
            if (candidate.matchEnd + LOOKAHEAD_MARGIN <= windowEnd)
                return candidate.verified ? candidate.index : undefined;
            // Unreliable edge match: resume strictly below the candidate so
            // the next window re-evaluates it with its full lookahead.
            checkpointLimit = Math.max(candidate.index, 1);
        }
        const checkpoint = newlineCheckpoint(src, checkpointLimit);
        if (checkpoint !== undefined)
            return checkpoint;
        windowEnd *= 2;
    }
}

/**
 * Last token-stream-invisible checkpoint strictly below `limit`, or
 * undefined when none exists (the caller then grows the window).
 */
function newlineCheckpoint(src: string, limit: number): number | undefined {
    let checkpoint = src.lastIndexOf('\n', limit - 1);
    while (checkpoint > 0 && src[checkpoint + 1] === '^')
        checkpoint = src.lastIndexOf('\n', checkpoint - 1);
    while (checkpoint > 0 && src[checkpoint - 1] === ' ')
        checkpoint--;
    while (checkpoint > 0 && src[checkpoint - 1] === '\\')
        checkpoint--;
    return checkpoint > 0 ? checkpoint : undefined;
}
