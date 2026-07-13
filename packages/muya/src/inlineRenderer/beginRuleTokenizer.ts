import type { BeginRules } from './rules';
import type { Token } from './types';
import { isLengthEven } from '../utils';

interface IBeginRuleState {
    src: string;
    pos: number;
    tokens: Token[];
}

export function consumeBeginRules(
    state: IBeginRuleState,
    beginRules: BeginRules,
): void {
    const beginRuleKeys = [
        'header',
        'hr',
        'code_fence',
        'multiple_math',
    ] as const;

    for (const ruleName of beginRuleKeys) {
        const to = beginRules[ruleName].exec(state.src);
        if (to) {
            state.tokens.push({
                type: ruleName,
                raw: to[0],
                parent: state.tokens,
                marker: to[1],
                content: to[2] || '',
                backlash: to[3] || '',
                range: {
                    start: state.pos,
                    end: state.pos + to[0].length,
                },
            });
            state.src = state.src.substring(to[0].length);
            state.pos += to[0].length;
            break;
        }
    }

    const definition = beginRules.reference_definition.exec(state.src);
    if (!definition || !isLengthEven(definition[3]))
        return;

    state.tokens.push({
        type: 'reference_definition',
        parent: state.tokens,
        leftBracket: definition[1],
        label: definition[2],
        backlash: definition[3] || '',
        rightBracket: definition[4],
        leftHrefMarker: definition[5] || '',
        href: definition[6],
        rightHrefMarker: definition[7] || '',
        leftTitleSpace: definition[8],
        titleMarker: definition[9] || '',
        title: definition[10] || '',
        rightTitleSpace: definition[11] || '',
        raw: definition[0],
        range: {
            start: state.pos,
            end: state.pos + definition[0].length,
        },
    });
    state.src = state.src.substring(definition[0].length);
    state.pos += definition[0].length;
}
