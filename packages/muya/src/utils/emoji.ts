import { CLASS_NAMES } from '../config';

export { validEmoji } from '@marktext/input-policy';

/**
 * check edit emoji
 */

export function checkEditEmoji(node: HTMLElement) {
    if (node && node.classList.contains(CLASS_NAMES.MU_EMOJI_MARKED_TEXT))
        return node;

    return false;
}
