import type { Muya } from '../../../muya';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import Parent from '../parent';

const SOURCE_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../..',
);

const TOPOLOGY_PROPERTIES = new Set([
    'attachments',
    'children',
    'next',
    'parent',
    'prev',
]);

const TOPOLOGY_WRITE_OWNERS = new Map<string, ReadonlySet<string>>([
    [
        'block/base/linkedList/linkedList.ts',
        new Set(['next', 'prev']),
    ],
    [
        'block/base/parent.ts',
        new Set(['next', 'parent', 'prev']),
    ],
    ['block/base/treeNode.ts', new Set(['parent'])],
    ['block/commonMark/codeBlock/code.ts', new Set(['parent'])],
    ['block/content/atxHeadingContent/index.ts', new Set(['parent'])],
    ['block/content/codeBlockContent/index.ts', new Set(['parent'])],
    ['block/content/langInputContent/index.ts', new Set(['parent'])],
    ['block/content/paragraphContent/index.ts', new Set(['parent'])],
    ['block/scrollPage/index.ts', new Set(['parent'])],
]);

const LINKED_LIST_MUTATORS = new Set([
    'append',
    'insertBefore',
    'remove',
]);

interface ISourceFile {
    file: string;
    projectPath: string;
    source: ts.SourceFile;
}

function sourcePath(path: string): string {
    return resolve(SOURCE_ROOT, path);
}

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

function parseSource(file: string): ISourceFile {
    const text = readFileSync(file, 'utf8');
    return {
        file,
        projectPath: relative(SOURCE_ROOT, file).replace(/\\/g, '/'),
        source: ts.createSourceFile(
            file,
            text,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
        ),
    };
}

function classNamed(
    input: ISourceFile,
    name: string,
): ts.ClassDeclaration {
    const declaration = input.source.statements.find(
        (statement): statement is ts.ClassDeclaration =>
            ts.isClassDeclaration(statement)
            && statement.name?.text === name,
    );
    if (!declaration)
        throw new TypeError(`Missing class ${name} in ${input.projectPath}.`);
    return declaration;
}

function memberName(
    member: ts.ClassElement,
    source: ts.SourceFile,
): string | null {
    return member.name?.getText(source) ?? null;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
    return kind >= ts.SyntaxKind.FirstAssignment
        && kind <= ts.SyntaxKind.LastAssignment;
}

function unwrapAssignmentTarget(expression: ts.Expression): ts.Expression {
    while (
        ts.isParenthesizedExpression(expression)
        || ts.isAsExpression(expression)
        || ts.isTypeAssertionExpression(expression)
        || ts.isNonNullExpression(expression)
    ) {
        expression = expression.expression;
    }
    return expression;
}

function assignedPropertyName(expression: ts.Expression): string | null {
    expression = unwrapAssignmentTarget(expression);
    if (ts.isPropertyAccessExpression(expression))
        return expression.name.text;
    if (
        ts.isElementAccessExpression(expression)
        && expression.argumentExpression
        && ts.isStringLiteralLike(expression.argumentExpression)
    ) {
        return expression.argumentExpression.text;
    }
    return null;
}

function topologyWrites(input: ISourceFile): string[] {
    const writes: string[] = [];
    const visit = (node: ts.Node): void => {
        if (
            ts.isBinaryExpression(node)
            && isAssignmentOperator(node.operatorToken.kind)
        ) {
            const property = assignedPropertyName(node.left);
            if (property && TOPOLOGY_PROPERTIES.has(property)) {
                const position = input.source.getLineAndCharacterOfPosition(
                    node.getStart(input.source),
                );
                writes.push(
                    `${input.projectPath}:${position.line + 1}:${property}`,
                );
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(input.source);
    return writes;
}

function linkedListViewMutations(input: ISourceFile): string[] {
    const mutations: string[] = [];
    const visit = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node)
            && ts.isPropertyAccessExpression(node.expression)
            && LINKED_LIST_MUTATORS.has(node.expression.name.text)
        ) {
            const receiver = node.expression.expression;
            if (
                ts.isPropertyAccessExpression(receiver)
                && ['attachments', 'children'].includes(receiver.name.text)
            ) {
                const position = input.source.getLineAndCharacterOfPosition(
                    node.getStart(input.source),
                );
                mutations.push(
                    `${input.projectPath}:${position.line + 1}:${receiver.name.text}.${node.expression.name.text}`,
                );
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(input.source);
    return mutations;
}

describe('block topology architecture fitness', () => {
    it.each(['children', 'attachments'] as const)(
        'exposes %s through a frozen, getter-only runtime view',
        (property) => {
            const parent = new Parent({} as Muya);
            const original = parent[property];

            expect(Object.isFrozen(original)).toBe(true);
            expect('append' in original).toBe(false);
            expect('insertBefore' in original).toBe(false);
            expect('remove' in original).toBe(false);
            expect(Reflect.set(parent, property, Object.freeze({}))).toBe(false);
            expect(parent[property]).toBe(original);
        },
    );

    it('keeps Parent linked-list storage private and its views getter-only', () => {
        const input = parseSource(sourcePath('block/base/parent.ts'));
        const parent = classNamed(input, 'Parent');

        for (const property of ['children', 'attachments']) {
            const storage = parent.members.filter(
                (member): member is ts.PropertyDeclaration =>
                    ts.isPropertyDeclaration(member)
                    && memberName(member, input.source) === `#${property}`,
            );
            const getters = parent.members.filter(
                (member): member is ts.GetAccessorDeclaration =>
                    ts.isGetAccessorDeclaration(member)
                    && memberName(member, input.source) === property,
            );
            const setters = parent.members.filter(
                (member): member is ts.SetAccessorDeclaration =>
                    ts.isSetAccessorDeclaration(member)
                    && memberName(member, input.source) === property,
            );
            const writableFields = parent.members.filter(
                (member): member is ts.PropertyDeclaration =>
                    ts.isPropertyDeclaration(member)
                    && memberName(member, input.source) === property,
            );

            expect(storage).toHaveLength(1);
            expect(storage[0]?.modifiers?.some(
                modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
            )).toBe(true);
            expect(getters).toHaveLength(1);
            expect(setters).toEqual([]);
            expect(writableFields).toEqual([]);
        }
    });

    it('keeps parent, sibling, and child identities runtime-private', () => {
        const input = parseSource(sourcePath('block/base/treeNode.ts'));
        const treeNode = classNamed(input, 'TreeNode');

        for (const property of ['prev', 'next', 'parent']) {
            const storage = treeNode.members.filter(
                (member): member is ts.PropertyDeclaration =>
                    ts.isPropertyDeclaration(member)
                    && memberName(member, input.source) === `#${property}`,
            );
            const getters = treeNode.members.filter(
                (member): member is ts.GetAccessorDeclaration =>
                    ts.isGetAccessorDeclaration(member)
                    && memberName(member, input.source) === property,
            );
            const setters = treeNode.members.filter(
                (member): member is ts.SetAccessorDeclaration =>
                    ts.isSetAccessorDeclaration(member)
                    && memberName(member, input.source) === property,
            );

            expect(storage).toHaveLength(1);
            expect(getters).toHaveLength(1);
            expect(setters).toHaveLength(1);
            expect(setters[0]?.body?.getText(input.source)).toContain(
                'this.#assertTopologyAssignment(value',
            );
            expect(setters[0]?.body?.getText(input.source)).toContain(
                `this.#${property} = value`,
            );
        }

        const authorityGuard = treeNode.members.find(
            (member): member is ts.MethodDeclaration =>
                ts.isMethodDeclaration(member)
                && memberName(member, input.source) === '#assertTopologyAssignment',
        );
        expect(authorityGuard).toBeDefined();
        expect(authorityGuard?.getText(input.source)).toContain(
            'this.assertTreeMutationAuthorized(operation)',
        );
    });

    it('keeps mutable LinkedList ownership inside Parent', () => {
        const offenders = productionTypeScriptFiles(SOURCE_ROOT)
            .map(parseSource)
            .flatMap((input) => {
                if (input.projectPath === 'block/base/parent.ts')
                    return [];
                return input.source.statements.flatMap((statement) => {
                    if (!ts.isImportDeclaration(statement))
                        return [];
                    const module = statement.moduleSpecifier;
                    if (
                        ts.isStringLiteral(module)
                        && /linkedList\/linkedList$/.test(module.text)
                    ) {
                        return [`${input.projectPath}:${module.text}`];
                    }
                    return [];
                });
            });

        expect(offenders).toEqual([]);
    });

    it('prevents block subclasses from shadowing child or attachment views', () => {
        const offenders = productionTypeScriptFiles(sourcePath('block'))
            .map(parseSource)
            .flatMap((input) => {
                if (input.projectPath === 'block/base/parent.ts')
                    return [];
                const declarations: string[] = [];
                const visit = (node: ts.Node): void => {
                    if (
                        (
                            ts.isPropertyDeclaration(node)
                            || ts.isGetAccessorDeclaration(node)
                            || ts.isSetAccessorDeclaration(node)
                        )
                        && node.name
                    ) {
                        const name = node.name.getText(input.source);
                        if (name === 'children' || name === 'attachments') {
                            const position = input.source
                                .getLineAndCharacterOfPosition(
                                    node.getStart(input.source),
                                );
                            declarations.push(
                                `${input.projectPath}:${position.line + 1}:${name}`,
                            );
                        }
                    }
                    ts.forEachChild(node, visit);
                };
                visit(input.source);
                return declarations;
            });

        expect(offenders).toEqual([]);
    });

    it('keeps topology writes inside the canonical owner files', () => {
        const offenders = productionTypeScriptFiles(sourcePath('block'))
            .map(parseSource)
            .flatMap(topologyWrites)
            .filter((write) => {
                const [path, _line, property] = write.split(':');
                return !TOPOLOGY_WRITE_OWNERS.get(path)?.has(property);
            });

        expect(offenders).toEqual([]);
    });

    it('does not call mutators through public child or attachment views', () => {
        const offenders = productionTypeScriptFiles(SOURCE_ROOT)
            .map(parseSource)
            .flatMap(linkedListViewMutations);

        expect(offenders).toEqual([]);
    });

    it('detects computed and compound topology writes', () => {
        const input: ISourceFile = {
            file: 'synthetic.ts',
            projectPath: 'synthetic.ts',
            source: ts.createSourceFile(
                'synthetic.ts',
                'node[\'next\'] ||= sibling; node.children = replacement;',
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TS,
            ),
        };

        expect(topologyWrites(input)).toEqual([
            'synthetic.ts:1:next',
            'synthetic.ts:1:children',
        ]);
    });
});
