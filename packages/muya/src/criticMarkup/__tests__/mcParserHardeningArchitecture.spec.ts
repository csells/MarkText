import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../..',
);
const DESKTOP_SOURCE_ROOT = resolve(SOURCE_ROOT, '../../desktop/src');
const MUYA_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const DESKTOP_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue']);
const DELIMITER_SIGNATURES = [
    '{++',
    '++}',
    '{--',
    '--}',
    '{~~',
    '~>',
    '~~}',
    '{==',
    '==}',
    '{>>',
    '<<}',
] as const;

function sourcePath(path: string): string {
    return resolve(SOURCE_ROOT, path);
}

function projectPath(path: string): string {
    return relative(SOURCE_ROOT, path).replace(/\\/g, '/');
}

function productionSourceFiles(
    directory: string,
    extensions: ReadonlySet<string>,
): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            return entry.name === '__tests__'
                ? []
                : productionSourceFiles(path, extensions);
        }

        return entry.isFile() && extensions.has(extname(entry.name))
            ? [path]
            : [];
    });
}

function sourceForArchitectureCensus(file: string): string {
    const source = readFileSync(file, 'utf8');
    if (!file.endsWith('.vue'))
        return source;

    return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        .map(match => match[1] ?? '')
        .join('\n');
}

function criticConsumerProductionFiles(): string[] {
    return [
        ...productionSourceFiles(SOURCE_ROOT, MUYA_SOURCE_EXTENSIONS),
        ...productionSourceFiles(
            DESKTOP_SOURCE_ROOT,
            DESKTOP_SOURCE_EXTENSIONS,
        ),
    ];
}

/**
 * Resolve relative runtime imports/re-exports. Pure `import type` edges are
 * intentionally ignored: this is the runtime dependency contract used by the
 * circular-dependency gate, not a ban on sharing neutral type declarations.
 */
function runtimeImports(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    const syntax = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TS,
    );
    const imports: string[] = [];
    for (const statement of syntax.statements) {
        if (ts.isImportDeclaration(statement)) {
            const { importClause, moduleSpecifier } = statement;
            if (!ts.isStringLiteral(moduleSpecifier))
                continue;
            const named = importClause?.namedBindings;
            const namedTypesOnly = named && ts.isNamedImports(named)
                && named.elements.length > 0
                && named.elements.every(element => element.isTypeOnly);
            if (
                importClause?.isTypeOnly
                || (namedTypesOnly && !importClause?.name)
            ) {
                continue;
            }
            if (moduleSpecifier.text.startsWith('.'))
                imports.push(moduleSpecifier.text);
        }
        else if (
            ts.isExportDeclaration(statement)
            && !statement.isTypeOnly
            && statement.moduleSpecifier
            && ts.isStringLiteral(statement.moduleSpecifier)
            && statement.moduleSpecifier.text.startsWith('.')
        ) {
            imports.push(statement.moduleSpecifier.text);
        }
    }

    return imports.flatMap((specifier) => {
        const base = resolve(dirname(file), specifier);
        const candidates = [base, `${base}.ts`, resolve(base, 'index.ts')];
        const target = candidates.find(candidate =>
            candidate.endsWith('.ts') && existsSync(candidate));

        return target ? [target] : [];
    });
}

function transitiveRuntimeReach(entry: string): Set<string> {
    const seen = new Set<string>();
    const queue = [sourcePath(entry)];

    while (queue.length) {
        const file = queue.pop()!;
        if (seen.has(file))
            continue;

        seen.add(file);
        queue.push(...runtimeImports(file));
    }

    return seen;
}

function syntaxLiteralSource(source: string): string {
    const file = ts.createSourceFile(
        'delimiter-census.ts',
        source,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TS,
    );
    const literals: string[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isRegularExpressionLiteral(node)) {
            // Regex syntax escapes every Critic brace/plus delimiter. Decode
            // those spelling escapes before comparing with the canonical
            // grammar signatures; otherwise `/\{\+\+...\+\+\}/` evades the
            // owner census even though it is exactly a second recognizer.
            literals.push(node.text.replace(/\\/g, ''));
        }
        else if (
            ts.isStringLiteral(node)
            || ts.isNoSubstitutionTemplateLiteral(node)
            || ts.isTemplateHead(node)
            || ts.isTemplateMiddle(node)
            || ts.isTemplateTail(node)
        ) {
            literals.push(node.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(file);

    return literals.join('\n');
}

function containsCriticDelimiterSyntax(source: string): boolean {
    const literals = syntaxLiteralSource(source);
    return DELIMITER_SIGNATURES.some(signature =>
        literals.includes(signature));
}

describe('mC-informed CriticMarkup architecture fitness', () => {
    it('has no grammar-only fallback for Track Changes validation', () => {
        const path = sourcePath('criticMarkup/trackChanges.ts');
        const source = readFileSync(path, 'utf8');
        const syntax = ts.createSourceFile(
            path,
            source,
            ts.ScriptTarget.Latest,
            false,
            ts.ScriptKind.TS,
        );
        const context = syntax.statements.find(
            (statement): statement is ts.InterfaceDeclaration =>
                ts.isInterfaceDeclaration(statement)
                && statement.name.text === 'ICriticMarkupTrackContext',
        );
        const transform = syntax.statements.find(
            (statement): statement is ts.FunctionDeclaration =>
                ts.isFunctionDeclaration(statement)
                && statement.name?.text === 'trackCriticMarkupEdits',
        );

        expect(context).toBeDefined();
        const requiredMembers = new Map(context?.members.flatMap((member) => {
            if (
                !ts.isPropertySignature(member)
                || !member.name
                || !ts.isIdentifier(member.name)
            ) {
                return [];
            }
            return [[member.name.text, member.questionToken === undefined] as const];
        }));
        expect(requiredMembers.get('beforeDocument')).toBe(true);
        expect(requiredMembers.get('proposedDocument')).toBe(true);
        expect(requiredMembers.get('createDocument')).toBe(true);

        expect(transform).toBeDefined();
        const contextParameter = transform?.parameters.find(parameter =>
            ts.isIdentifier(parameter.name)
            && parameter.name.text === 'context');
        expect(contextParameter?.questionToken).toBeUndefined();
        expect(contextParameter?.initializer).toBeUndefined();
        expect(contextParameter?.type?.getText(syntax))
            .toBe('ICriticMarkupTrackContext');

        expect(syntax.statements.some(statement =>
            ts.isFunctionDeclaration(statement)
            && statement.name?.text === 'grammarDocument')).toBe(false);
        expect(source).not.toMatch(/\bgrammarDocument\b/);
    });

    it.each([
        [
            'addition',
            String.raw`const marker = /\{\+\+[\s\S]*?\+\+\}/;`,
        ],
        [
            'deletion',
            String.raw`const marker = /\{--[\s\S]*?--\}/;`,
        ],
        [
            'highlight',
            String.raw`const marker = /\{==[\s\S]*?==\}/;`,
        ],
        [
            'comment',
            String.raw`const marker = /\{>>[\s\S]*?<<\}/;`,
        ],
    ])('detects an escaped %s delimiter regex as a second recognizer', (
        _type,
        source,
    ) => {
        expect(containsCriticDelimiterSyntax(source)).toBe(true);
    });

    it('keeps live state serialization in the branded mapped domain', () => {
        const state = readFileSync(sourcePath('state/index.ts'), 'utf8');
        const service = readFileSync(
            sourcePath('criticMarkup/documentService.ts'),
            'utf8',
        );

        for (const consumer of [state, service]) {
            expect(consumer).toContain('.generateMapped(');
            expect(consumer).not.toMatch(/\bgenerateWithSourceMap\s*\(/);
            expect(consumer).not.toMatch(/\bfromMarkdownSourceMap\s*\(/);
        }
    });

    it('keeps the canonical document entirely inside the branded mapped domain', () => {
        const analysisPath = sourcePath('criticMarkup/analysis.ts');
        const analysis = existsSync(analysisPath)
            ? readFileSync(analysisPath, 'utf8')
            : '';
        const document = readFileSync(
            sourcePath('criticMarkup/document.ts'),
            'utf8',
        );

        expect(document).not.toMatch(/\bIMarkdownSourceMap\b/);
        expect(document).not.toMatch(/\bfromMarkdownSourceMap\b/);
        expect(document).not.toMatch(/\btoMarkdownSourceMap\b/);
        expect(document).not.toMatch(/\bcompatibilityMappedText\b/);
        expect(document).not.toMatch(/readonly sourceMap\s*:/);
        expect(document).toMatch(
            /constructor\(\s*analysis:\s*CriticMarkupAnalysis,\s*source:\s*MappedText<Path>,\s*parserProfile:\s*TCriticMarkupAnalysisProfile,\s*contextCoverage:\s*TCriticMarkupContextCoverage/,
        );
        expect(document).not.toMatch(/\bscanCriticMarkup\b/);
        expect(analysis).toContain('export class CriticMarkupAnalysis');
        expect(analysis).toContain('Object.freeze(this)');
        expect(analysis).not.toMatch(/\bMappedText\b/);
    });

    it('builds the static document from its existing located token analysis', () => {
        const extension = readFileSync(
            sourcePath('utils/marked/extensions/criticMarkupDocument.ts'),
            'utf8',
        );
        const adapter = readFileSync(
            sourcePath('utils/marked/criticMarkupDocument.ts'),
            'utf8',
        );

        expect(extension).toContain('parseCriticMarkupDocumentFromContext');
        expect(adapter).toContain('context: ICriticMarkupContextAnalysis');
        expect(adapter).toContain('baseExcluded.equals(excludedRanges)');
        expect(extension).not.toMatch(
            /parseCriticMarkupDocument\(fromMarkdownSourceMap/,
        );
    });

    it('does not expose unbranded grammar tokens beyond parser-boundary owners', () => {
        const rawCoordinateOwners = new Set([
            'criticMarkup/analysis.ts',
            'criticMarkup/document.ts',
            'criticMarkup/parser.ts',
            'criticMarkup/project.ts',
            'criticMarkup/transform.ts',
            'utils/marked/criticMarkupDocument.ts',
            'utils/marked/locatedMarkdown.ts',
        ]);
        const rawNames = new Set(['ICriticMarkupRange', 'TCriticMarkupToken']);
        const offenders = productionSourceFiles(
            SOURCE_ROOT,
            MUYA_SOURCE_EXTENSIONS,
        ).flatMap((file) => {
            if (rawCoordinateOwners.has(projectPath(file)))
                return [];
            const syntax = ts.createSourceFile(
                file,
                readFileSync(file, 'utf8'),
                ts.ScriptTarget.Latest,
                false,
                ts.ScriptKind.TS,
            );
            return syntax.statements.flatMap((statement) => {
                if (!ts.isImportDeclaration(statement))
                    return [];
                const module = statement.moduleSpecifier;
                const bindings = statement.importClause?.namedBindings;
                if (
                    !ts.isStringLiteral(module)
                    || (
                        !module.text.endsWith('criticMarkup/parser')
                        && module.text !== './parser'
                    )
                    || !bindings
                    || !ts.isNamedImports(bindings)
                ) {
                    return [];
                }
                return bindings.elements
                    .filter(element => rawNames.has(element.propertyName?.text ?? element.name.text))
                    .map(element => `${projectPath(file)}:${element.name.text}`);
            });
        });

        expect(offenders).toEqual([]);
    });

    it('has no implicit leaf-local Critic document fallback or second literal classifier', () => {
        const adapter = sourcePath('inlineRenderer/criticMarkupAdapter.ts');
        const lexer = readFileSync(sourcePath('inlineRenderer/lexer.ts'), 'utf8');
        const markedAdapter = readFileSync(
            sourcePath('utils/marked/extensions/criticMarkupDocument.ts'),
            'utf8',
        );

        expect(existsSync(adapter)).toBe(false);
        expect(lexer).not.toMatch(/\binlineCriticMarkupFragments\b/);
        expect(lexer).toContain(
            'requires canonical document fragments or explicit disablement',
        );
        expect(markedAdapter).not.toMatch(/\bscanCriticMarkup\b/);
        expect(markedAdapter).not.toMatch(/\banalyzeCriticMarkupContext\(\s*token\.text/);
        expect(markedAdapter).not.toMatch(/\bprojectCriticMarkupTokens\b/);
    });

    it('reserves parser residue for native parser resource limits', () => {
        const stateAdapter = readFileSync(
            sourcePath('criticMarkup/markdownState.ts'),
            'utf8',
        );

        expect(stateAdapter).not.toContain("name: 'markdown-parser-residue'");
        expect(stateAdapter).not.toContain(
            'critic-markup-structural-residue',
        );
    });

    it('does not reconstruct structural CriticMarkup from projected source cover', () => {
        const document = readFileSync(
            sourcePath('criticMarkup/document.ts'),
            'utf8',
        );

        expect(document).not.toContain(
            'projectedCriticMarkupSelectedUnionSourceSegments',
        );
        expect(document).not.toContain('exactStructuralSourceCover');
        expect(document).not.toContain('structuralArmSemanticEnvelope');
    });

    it('locates the Marked token tree once behind a typed source-location boundary', () => {
        const contextPath = sourcePath('utils/marked/criticMarkupContext.ts');
        const locatorPath = sourcePath('utils/marked/locatedMarkdown.ts');
        const extensionPath = sourcePath(
            'utils/marked/extensions/criticMarkupDocument.ts',
        );
        const sessionPath = sourcePath(
            'utils/marked/criticMarkupParseSession.ts',
        );
        const graphAuthorityPath = sourcePath(
            'utils/marked/markedTokenGraphAuthority.ts',
        );
        const tokenProvenanceBridgePath = sourcePath(
            'utils/marked/markdownTokenProvenance.ts',
        );
        const blockLexerPath = sourcePath('utils/marked/lexBlock.ts');
        const lexerOriginPath = sourcePath(
            'utils/marked/criticMarkupLexerOrigin.ts',
        );
        const forkProvenancePath = sourcePath(
            '../../marked/src/SourceProvenance.ts',
        );
        const forkGraphAuthorityPath = sourcePath(
            '../../marked/src/TokenGraphAuthority.ts',
        );
        const forkLexerPath = sourcePath('../../marked/src/Lexer.ts');
        const forkTokenizerPath = sourcePath('../../marked/src/Tokenizer.ts');
        const context = readFileSync(contextPath, 'utf8');
        const locator = existsSync(locatorPath)
            ? readFileSync(locatorPath, 'utf8')
            : '';
        const extension = readFileSync(extensionPath, 'utf8');
        const session = readFileSync(sessionPath, 'utf8');
        const forkProvenance = readFileSync(forkProvenancePath, 'utf8');
        const forkGraphAuthority = readFileSync(
            forkGraphAuthorityPath,
            'utf8',
        );
        const forkLexer = readFileSync(forkLexerPath, 'utf8');
        const forkTokenizer = readFileSync(forkTokenizerPath, 'utf8');
        const blockLexer = readFileSync(blockLexerPath, 'utf8');
        const ordinaryLexBlock = blockLexer.slice(
            blockLexer.indexOf('export function lexBlock('),
            blockLexer.indexOf('export function analyzeMarkdownBlockSource('),
        );

        expect(existsSync(locatorPath)).toBe(true);
        expect(existsSync(sessionPath)).toBe(true);
        expect(existsSync(graphAuthorityPath)).toBe(false);
        expect(existsSync(tokenProvenanceBridgePath)).toBe(false);
        expect(existsSync(blockLexerPath)).toBe(true);
        expect(existsSync(lexerOriginPath)).toBe(false);
        expect(existsSync(forkProvenancePath)).toBe(true);
        expect(existsSync(forkGraphAuthorityPath)).toBe(true);
        expect(existsSync(forkLexerPath)).toBe(true);
        expect(existsSync(forkTokenizerPath)).toBe(true);
        expect(context.split('\n').length).toBeLessThanOrEqual(501);
        expect(locator.split('\n').length).toBeLessThanOrEqual(751);
        expect(session.split('\n').length).toBeLessThanOrEqual(351);
        expect(context).not.toMatch(/\.indexOf\(raw\s*,/);
        expect(context).not.toMatch(/switch\s*\(token\.type\)/);
        expect(context).toContain('from \'./locatedMarkdown\'');
        expect(extension).toContain('from \'../locatedMarkdown\'');
        expect(extension).toContain('createCriticMarkupSessionHooks');
        expect(extension).toContain('createMarkedProvenanceBinding');
        expect(extension).toContain('sourceProvenance');
        expect(locator).not.toMatch(/attach\w*TokenProvenance/);
        expect(locator).not.toContain('lexBlockTokenProvenance');
        expect(blockLexer).toContain('analyzeMarkdownBlockSource');
        expect(blockLexer).toContain('analyzeLocatedMarkdownContext');
        expect(ordinaryLexBlock).not.toContain('MarkedSourceDocument');
        expect(ordinaryLexBlock).not.toContain('createMarkedProvenanceBinding');
        expect(session).toContain('trace.assertUnchanged()');
        expect(session).not.toContain('snapshotMarkedTokenGraph');
        expect(session).toContain('provenance.claim(tokenList)');
        expect(session).not.toContain('assertRawCoverage');
        expect(session).not.toContain('claimCriticMarkupLexerOrigin');
        expect(session).not.toMatch(/getOwnPropertyDescriptor\([^)]*links/);
        expect(session).not.toMatch(/lexerModes|\.shift\(\)/);
        expect(forkProvenance).toContain('class MarkedParseTrace');
        expect(forkProvenance).toContain('assertUnchanged()');
        expect(forkProvenance).toContain('consumeResidue');
        expect(forkLexer).toContain('\'discarded-token\'');
        expect(forkLexer).toContain('beginProvenanceInvocation');
        expect(forkTokenizer).toContain('MarkedSourceView.concat');
        expect(locator).not.toContain('MarkedSourceCursor');
        expect(locator).not.toContain('stripBlockQuotePrefixes');
        expect(locator).not.toContain('stripListItemPrefixes');
        expect(forkGraphAuthority).toContain('Reflect.ownKeys');
        expect(forkGraphAuthority).toContain('Object.getOwnPropertyDescriptor');
        expect(forkGraphAuthority).toContain('Object.getPrototypeOf');
    });

    it('keeps the grammar/domain runtime graph below Marked, rendering, UI, and the editor shell', () => {
        const domainEntries = [
            'criticMarkup/parser.ts',
            'criticMarkup/excludedRanges.ts',
            'criticMarkup/project.ts',
            'criticMarkup/transform.ts',
            'criticMarkup/trackChanges.ts',
            'criticMarkup/analysis.ts',
            'criticMarkup/document.ts',
        ];
        const forbiddenSegments = [
            '/utils/marked/',
            '/inlineRenderer/',
            '/ui/',
            '/editor/',
        ];
        const offenders = domainEntries.flatMap(entry =>
            [...transitiveRuntimeReach(entry)]
                .filter(file => forbiddenSegments.some(segment =>
                    file.includes(segment)))
                .map(file => `${entry} -> ${projectPath(file)}`));

        expect(offenders).toEqual([]);
    });

    it('keeps base Markdown state parsing out of Critic render and command layers', () => {
        const baseEntries = [
            'state/markdownToState.ts',
            'utils/marked/lexBlock.ts',
        ];
        const forbidden = (file: string) =>
            file.endsWith('/utils/marked/extensions/criticMarkupDocument.ts')
            || file.endsWith('/criticMarkup/commands.ts')
            || file.endsWith('/criticMarkup/reviewSnapshot.ts')
            || file.endsWith('/inlineRenderer/criticMarkupAdapter.ts')
            || file.endsWith('/inlineRenderer/lexer.ts')
            || file.endsWith(
                '/inlineRenderer/renderer/criticDocumentFragment.ts',
            )
            || file.includes('/ui/criticMarkupReviewTool/');
        const offenders = baseEntries.flatMap(entry =>
            [...transitiveRuntimeReach(entry)]
                .filter(forbidden)
                .map(file => `${entry} -> ${projectPath(file)}`));

        expect(offenders).toEqual([]);
    });

    it('keeps every production Critic delimiter recognizer in the grammar owner', () => {
        const grammarOwners = new Set([
            'criticMarkup/parser.ts',
        ]);
        const offenders = criticConsumerProductionFiles()
            .filter((file) => {
                const path = projectPath(file);
                if (grammarOwners.has(path))
                    return false;

                return containsCriticDelimiterSyntax(
                    sourceForArchitectureCensus(file),
                );
            })
            .map(projectPath);

        expect(offenders).toEqual([]);
    });

    it('keeps the public Review contract as the only projection union owner', () => {
        const projectionUnion
            = /'marked'\s*\|\s*'original'\s*\|\s*'revised'/;
        const owner = 'criticMarkup/reviewContract.ts';
        const offenders = criticConsumerProductionFiles()
            .filter(file => projectPath(file) !== owner)
            .filter(file => projectionUnion.test(
                sourceForArchitectureCensus(file),
            ))
            .map(projectPath);

        expect(offenders).toEqual([]);
    });
});
