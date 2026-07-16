import { windowedInlineStart } from './inlineStartScan';

const SUB_START_REG = /(?:\s|^)(~)(?!\1)/;
const SUB_REG = /^(~)((?:[^~\s]|(?<=\\)\1|(?<=\\) )+?)(?<!\\)\1(?!\1)/;
// TODO: why \S in sup???
const SUP_START_REG = /(?:\S|^)(\^)(?!\1)/;
const SUP_REG = /^(\^)((?:[^^\s]|(?<=\\)\1|(?<=\\) )+?)(?<!\\)\1(?!\1)/;

interface IScriptToken {
    type: string;
    raw: string;
    text: string;
    marker: string;
}

const START_HASH = {
    superscript: SUP_START_REG,
    subscript: SUB_START_REG,
};

const REG_HASH = {
    superscript: SUP_REG,
    subscript: SUB_REG,
};

export default function () {
    return {
        extensions: [getExtension('superscript'), getExtension('subscript')],
    };
}

function getExtension(name: 'superscript' | 'subscript') {
    return {
        name,
        level: 'inline' as const,
        start(src: string) {
            return windowedInlineStart(src, (slice, full) => {
                const match = slice.match(START_HASH[name]);
                if (!match)
                    return undefined;

                const markerInMatch = match[0].lastIndexOf(match[1]);
                const index = (match.index ?? 0) + markerInMatch;
                const possibleSubSup = full.substring(index);

                return {
                    index,
                    matchEnd: (match.index ?? 0) + match[0].length,
                    verified:
                        SUP_REG.test(possibleSubSup)
                        || SUB_REG.test(possibleSubSup),
                };
            });
        },

        tokenizer(src: string) {
            const match = src.match(REG_HASH[name]);

            if (match) {
                return {
                    type: name,
                    raw: match[0],
                    text: match[2].trim(),
                    marker: match[1],
                };
            }
        },

        renderer(token: IScriptToken) {
            const { text, marker } = token;
            const tagName = marker === '^' ? 'sup' : 'sub';

            return `<${tagName}>${text}</${tagName}>`;
        },
    };
}
