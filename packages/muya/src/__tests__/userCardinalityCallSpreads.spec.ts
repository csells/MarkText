import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIRECTORY = resolve(TEST_DIRECTORY, '../../..');
const PRODUCTION_ROOTS = [
    resolve(TEST_DIRECTORY, '..'),
    resolve(TEST_DIRECTORY, '../../../desktop/src'),
];
const EXCLUDED_DIRECTORIES = new Set([
    '__tests__',
    'test',
    'tests',
    'assets',
    'static',
]);

interface ISourceInput {
    file: string;
    source: string;
    kind: ts.ScriptKind;
}

function productionFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRECTORIES.has(entry.name))
                files.push(...productionFiles(path));
        }
        else if (['.ts', '.tsx', '.vue'].includes(extname(entry.name))) {
            files.push(path);
        }
    }
    return files;
}

function sourceInput(file: string): ISourceInput | null {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('.vue')) {
        const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(source)?.[1];
        return script
            ? { file, source: script, kind: ts.ScriptKind.TS }
            : null;
    }
    return {
        file,
        source,
        kind: file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    };
}

function unwrappedIdentifier(expression: ts.Expression): ts.Identifier | null {
    while (
        ts.isAsExpression(expression)
        || ts.isTypeAssertionExpression(expression)
        || ts.isParenthesizedExpression(expression)
    ) {
        expression = expression.expression;
    }
    return ts.isIdentifier(expression) ? expression : null;
}

function forwardsEnclosingRestParameter(
    call: ts.CallExpression | ts.NewExpression,
    spread: ts.SpreadElement,
): boolean {
    const identifier = unwrappedIdentifier(spread.expression);
    if (!identifier)
        return false;

    let current: ts.Node | undefined = call.parent;
    while (current) {
        if (
            ts.isFunctionLike(current)
            && current.parameters.some(parameter =>
                parameter.dotDotDotToken
                && ts.isIdentifier(parameter.name)
                && parameter.name.text === identifier.text)
        ) {
            return true;
        }
        current = current.parent;
    }
    return false;
}

const EXPLICIT_BOUNDED_REPLAYS = new Set([
    'muya/src/event/index.ts:this.emit:prepared.data',
]);

function unboundedCallSpreads(): string[] {
    const violations: string[] = [];
    for (const file of PRODUCTION_ROOTS.flatMap(productionFiles)) {
        const input = sourceInput(file);
        if (!input)
            continue;
        const sourceFile = ts.createSourceFile(
            input.file,
            input.source,
            ts.ScriptTarget.Latest,
            true,
            input.kind,
        );
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
                for (const argument of node.arguments ?? []) {
                    if (
                        !ts.isSpreadElement(argument)
                        || forwardsEnclosingRestParameter(node, argument)
                    ) {
                        continue;
                    }
                    const fingerprint = `${relative(
                        PACKAGES_DIRECTORY,
                        file,
                    )}:${node.expression.getText(sourceFile)}:${argument.expression.getText(sourceFile)}`;
                    if (EXPLICIT_BOUNDED_REPLAYS.has(fingerprint))
                        continue;
                    const position = sourceFile.getLineAndCharacterOfPosition(
                        node.getStart(sourceFile),
                    );
                    violations.push(
                        `${fingerprint}:${position.line + 1}`,
                    );
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    return violations.sort();
}

describe('production user-cardinality call spreads', () => {
    it('allows only lexical rest-parameter forwarding and one bounded event replay', () => {
        expect(unboundedCallSpreads()).toEqual([]);
    });
});
