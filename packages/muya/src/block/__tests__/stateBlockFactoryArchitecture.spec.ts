import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../..',
);

// These registry entries are runtime-only attachments, content leaves, or
// internal containers. They do not represent an independently serializable
// TState node; their owning Parent carries and emits source trivia.
const NON_STATE_FACTORIES = new Set([
    'atxheading.content',
    'code',
    'codeblock.content',
    'diagram-container',
    'diagram-preview',
    'heading-copy-link',
    'html-container',
    'html-preview',
    'language-input',
    'markdown-parser-residue.content',
    'math-container',
    'math-preview',
    'paragraph.content',
    'setextheading.content',
    'table.cell.content',
    'table.inner',
    'task-list-checkbox',
    'thematicbreak.content',
]);

function productionTypeScriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            return entry.name === '__tests__'
                ? []
                : productionTypeScriptFiles(path);
        }
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    });
}

function directStateFactoryViolations(): string[] {
    const violations: string[] = [];
    for (const file of productionTypeScriptFiles(SOURCE_ROOT)) {
        const source = ts.createSourceFile(
            file,
            readFileSync(file, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
        );
        const visit = (node: ts.Node): void => {
            if (
                ts.isCallExpression(node)
                && ts.isPropertyAccessExpression(node.expression)
                && node.expression.name.text === 'create'
                && ts.isCallExpression(node.expression.expression)
                && ts.isPropertyAccessExpression(
                    node.expression.expression.expression,
                )
                && node.expression.expression.expression.name.text === 'loadBlock'
                && node.expression.expression.expression.expression.getText(source)
                === 'ScrollPage'
            ) {
                const argument = node.expression.expression.arguments[0];
                const factory = argument && ts.isStringLiteralLike(argument)
                    ? argument.text
                    : null;
                if (factory == null || !NON_STATE_FACTORIES.has(factory)) {
                    const position = source.getLineAndCharacterOfPosition(
                        node.getStart(source),
                    );
                    const path = relative(SOURCE_ROOT, file).replace(/\\/g, '/');
                    violations.push(
                        `${path}:${position.line + 1}:${factory ?? '<dynamic>'}`,
                    );
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return violations.sort();
}

describe('serializable block construction architecture', () => {
    it('routes every direct TState factory through createStateBlock', () => {
        expect(directStateFactoryViolations()).toEqual([]);
    });
});
