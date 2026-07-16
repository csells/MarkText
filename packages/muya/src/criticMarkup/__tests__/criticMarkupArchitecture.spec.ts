import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../..',
);

function sourcePath(path: string): string {
    return resolve(SOURCE_ROOT, path);
}

function readSource(path: string): string {
    return readFileSync(sourcePath(path), 'utf8');
}

function productionTypeScriptFiles(directory = SOURCE_ROOT): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            return entry.name === '__tests__'
                ? []
                : productionTypeScriptFiles(path);
        }

        return entry.isFile() && entry.name.endsWith('.ts')
            ? [path]
            : [];
    });
}

function sourceLineCount(source: string): number {
    if (!source)
        return 0;

    const lineBreaks = source.match(/\r\n|\r|\n/g)?.length ?? 0;

    return lineBreaks + (/\r\n$|\r$|\n$/.test(source) ? 0 : 1);
}

function projectPath(path: string): string {
    return relative(SOURCE_ROOT, path).replace(/\\/g, '/');
}

describe('criticMarkup architecture fitness', () => {
    it('has no leaf-local Critic token or renderer family', () => {
        const legacyModules = [
            'inlineRenderer/renderer/criticAddition.ts',
            'inlineRenderer/renderer/criticComment.ts',
            'inlineRenderer/renderer/criticDeletion.ts',
            'inlineRenderer/renderer/criticHighlight.ts',
            'inlineRenderer/renderer/criticMarkupFactory.ts',
            'inlineRenderer/renderer/criticSubstitution.ts',
        ];
        const legacyTokenPattern
            = /critic_(?:addition|comment|deletion|highlight|substitution)|\bCriticMarkup(?:Content|Substitution)?Token\b/;
        const inlineFiles = productionTypeScriptFiles(
            sourcePath('inlineRenderer'),
        );
        const tokenOwners = inlineFiles
            .filter(path => legacyTokenPattern.test(readFileSync(path, 'utf8')))
            .map(projectPath);

        expect(legacyModules.filter(path => existsSync(sourcePath(path))))
            .toEqual([]);
        expect(readSource('inlineRenderer/lexer.ts'))
            .not
            .toMatch(/\btryCriticMarkup\s*\(/);
        expect(tokenOwners).toEqual([]);
    });

    it('has one Marked document adapter and no legacy inline extension', () => {
        const productionFiles = productionTypeScriptFiles();
        const extensionOwners = productionFiles
            .filter(path => /\bcriticMarkupExtension\b/.test(
                readFileSync(path, 'utf8'),
            ))
            .map(projectPath);

        expect(existsSync(sourcePath(
            'utils/marked/extensions/criticMarkup.ts',
        ))).toBe(false);
        expect(extensionOwners).toEqual([]);
    });

    it('has no local Critic token offset shifter', () => {
        const offsetShifters = productionTypeScriptFiles()
            .filter(path => /\boffsetCriticToken\b/.test(
                readFileSync(path, 'utf8'),
            ))
            .map(projectPath);

        expect(offsetShifters).toEqual([]);
    });

    it('derives structural edits from mapped operation scopes, never a whole-document diff', () => {
        const policy = readSource('mutation/trackedCriticMarkup.ts');
        const mappedText = readSource('mappedText.ts');
        const markdownSourceMap = readSource('state/markdownSourceMap.ts');

        expect(policy).not.toMatch(/from ['"]fast-diff['"]/);
        expect(policy).not.toMatch(
            /diff\s*\(\s*beforeMarkdown\s*,\s*proposedMarkdown\s*\)/,
        );
        expect(policy).not.toMatch(
            /textOperationSourceEdits\s*\(\s*beforeMarkdown\b/,
        );
        expect(mappedText).toMatch(/\bnodeRange\s*\(/);
        expect(mappedText).toMatch(/\bappendBoundary\s*\(/);
        expect(markdownSourceMap).toMatch(/\bnodes\??\s*:/);
        expect(markdownSourceMap).toMatch(/\bboundaries\??\s*:/);
    });

    it('routes every known external mutation boundary through the gateway', () => {
        const externalBoundaries = [
            'block/base/content.ts',
            'block/scrollPage/index.ts',
            'muya.ts',
            'selection/ImageSelection.ts',
            'ui/codeBlockLanguageSelector/index.ts',
            'ui/emojiSelector/index.ts',
            'ui/footnoteTool/index.ts',
            'ui/imageEditTool/index.ts',
            'ui/imageResizeBar/index.ts',
            'ui/imageToolbar/index.ts',
            'ui/linkTools/index.ts',
            'ui/paragraphFrontButton/index.ts',
            'ui/paragraphFrontMenu/index.ts',
            'ui/paragraphQuickInsertMenu/index.ts',
            'ui/previewToolBar/index.ts',
            'ui/tableColumnToolbar/index.ts',
            'ui/tableDragBar/index.ts',
            'ui/tableRowColumMenu/index.ts',
        ];
        const unguardedKnownBoundaries = externalBoundaries.filter((path) => {
            const source = readSource(path);
            return !/mutationGateway\.run\s*\(/.test(source)
                && !(path === 'muya.ts'
                    && /MutationCommandDispatcher/.test(source));
        });
        const directUiMutation = /\.(?:alignColumn|deleteImage|insertColumn|insertInto|insertRow|removeColumn|removeRow|replaceImage|replaceWith|setEmoji|unlink|updateImage)\s*\(|\breplaceBlockByLabel\s*\(|\bscrollPage\.append\s*\(/;
        const unguardedDiscoveredBoundaries = productionTypeScriptFiles(
            sourcePath('ui'),
        )
            .filter((path) => {
                const source = readFileSync(path, 'utf8');
                return directUiMutation.test(source)
                    && !/mutationGateway\.run\s*\(/.test(source);
            })
            .map(projectPath);

        expect(unguardedKnownBoundaries).toEqual([]);
        expect(unguardedDiscoveredBoundaries).toEqual([]);
    });

    it('enforces the gateway at runtime below every low-level state writer', () => {
        const authority = readSource('mutation/authority.ts');
        const gateway = readSource('mutation/gateway.ts');
        const state = readSource('state/index.ts');
        const treeNode = readSource('block/base/treeNode.ts');
        const content = readSource('block/base/content.ts');
        const parent = readSource('block/base/parent.ts');

        expect(authority).toContain('assertActive(operation: string)');
        expect(gateway).toContain('this._authority.run');
        expect(gateway).toContain('this._authority.active');
        const guardedStateWriters = [...state.matchAll(
            /_mutationAuthority\.assertActive\('([^']+)'\)/g,
        )].map(([, operation]) => operation).sort();
        expect(guardedStateWriters).toEqual([
            'JSON document reset',
            'JSON document reset checkpoint',
            'JSON document reset rollback',
            'JSON state insertion',
            'JSON state mutation capture',
            'JSON state removal',
            'JSON state replacement',
            'JSON state text edit',
            'Prepared JSON commit',
        ]);
        expect(treeNode).toContain('mutationGateway.assertActive(operation)');
        expect(treeNode).toContain(
            'editor.assertTreeMutationAuthorized(operation)',
        );
        expect(content).toContain('assertMutationAuthorized(\'Content text mutation\')');
        expect(parent).toMatch(
            /private _assertChildMutationAuthorized\([\s\S]*?this\.isAttachedToLiveTree[\s\S]*?children\.some\(child => child\.isAttachedToLiveTree\)[\s\S]*?this\.assertTreeMutationAuthorized\(operation\)/,
        );
        expect(parent.match(
            /this\._assertChildMutationAuthorized\(/g,
        )).toHaveLength(2);
        expect(parent).toMatch(
            /override remove\([\s\S]*?assertMutationAuthorized\('Block removal'\)[\s\S]*?assertTreeMutationAuthorized\('Block removal'\)/,
        );
    });

    it('guards whole-document resets and keeps notification replay outside authority', () => {
        const types = readSource('mutation/types.ts');
        const gateway = readSource('mutation/gateway.ts');
        const editor = readSource('editor/index.ts');
        const state = readSource('state/index.ts');

        expect(types).toContain('{ kind: \'document-reset\' }');
        expect(editor).toMatch(
            /setContent\([\s\S]*?mutationGateway\.run\([\s\S]*?kind:\s*'document-reset'/,
        );
        expect(state).toContain(
            '_mutationAuthority.assertActive(\'JSON document reset\')',
        );
        expect(gateway).toContain('_replayPostCommit');
        expect(gateway).toMatch(
            /const replay = this\._authority\.run\([\s\S]*?\);\n\s*this\._replayPostCommit\(replay\);/,
        );
    });

    it('keeps the live lexer and Markdown serializer below their ceilings', () => {
        const ceilings = [
            { path: 'inlineRenderer/lexer.ts', maximum: 999 },
            { path: 'state/stateToMarkdown.ts', maximum: 799 },
        ];
        const violations = ceilings
            .map(({ path, maximum }) => ({
                path,
                lines: sourceLineCount(readSource(path)),
                maximum,
            }))
            .filter(({ lines, maximum }) => lines > maximum);

        expect(violations).toEqual([]);
    });

    it('builds one canonical fragment forest for both render backends', () => {
        const renderPlanPath = sourcePath('criticMarkup/renderPlan.ts');
        const liveLexer = readSource('inlineRenderer/lexer.ts');
        const markedRenderer = readSource(
            'utils/marked/extensions/criticMarkupDocument.ts',
        );

        expect(existsSync(renderPlanPath)).toBe(true);
        expect(liveLexer).toContain('from \'../criticMarkup/renderPlan\'');
        expect(markedRenderer).toContain(
            'from \'../../../criticMarkup/renderPlan\'',
        );
        expect(existsSync(sourcePath(
            'inlineRenderer/criticMarkupFragmentIndex.ts',
        ))).toBe(false);
        expect(markedRenderer).not.toContain('inputsByParent');
        expect(markedRenderer).not.toContain('firstFragmentEndingAfter');
        expect(markedRenderer).not.toContain('exceedsCriticMarkupRenderDepth');
        expect(markedRenderer).not.toContain('new Set(sequence.nodes)');
        expect(markedRenderer).not.toMatch(/sequence\.nodes\.filter\s*\(/);
    });

    it('does not retain the deleted Critic-enabled Marked token traversal', () => {
        const context = readSource('utils/marked/criticMarkupContext.ts');

        expect(context).not.toContain('visitCriticMarkupToken');
        expect(context).not.toContain('token.type === \'criticMarkup\'');
    });

    it('does not introduce another thousand-line Muya production file', () => {
        // These files were already above the ceiling at the branch base. This
        // frozen allowlist does not permit another oversized production file.
        const preExistingOversizedFiles = new Set([
            'block/base/format.ts',
            'config/emojis.ts',
            'muya.ts',
        ]);
        const oversized = productionTypeScriptFiles()
            .map(path => ({
                path: projectPath(path),
                lines: sourceLineCount(readFileSync(path, 'utf8')),
            }))
            .filter(({ path, lines }) =>
                lines >= 1000 && !preExistingOversizedFiles.has(path));

        expect(oversized).toEqual([]);
    });
});
