# AI slop scan — review-comments-20260630-231526-muya

Generated 2026-07-01T06:17:00Z
Scope: `packages/muya/src`

(See references/VIBE-CODED-PATHOLOGIES.md for P1-P40 catalog.)


## P1 over-defensive try/catch (Python: ≥3 except Exception per file)

_none found_

## P1 over-defensive try/catch (TS: catch blocks per file)

_none found_

## P2 long nullish/optional chains (three+ `?.`)

_none found_

## P2 double-nullish coalescing

_none found_

## P3 orphaned _v2/_new/_old/_improved/_copy files

_none found_

## P4 utils/helpers/misc/common files > 500 LOC

_none found_

## P5 abstract Base/Abstract class hierarchy

_none found_

## P5 abstract class in Rust (rare idiom; often AI-generated)

_none found_

## P6 feature flags (review each for whether it is still toggling)

_none found_

## P7 re-export barrel files (`export * from`)

_none found_

## P8 pass-through wrappers (function whose sole body returns another call)

_none found_

## P9 functions with ≥5 optional parameters

_none found_

## P10 swallowed catch (empty or `return null`)

_none found_

## P10 Python: except ... : pass

_none found_

## P11 Step/Phase/TODO comments (per-file counts)

```
packages/muya/src/utils/diagram/sequence/sequence-diagram-snap.js:12
packages/muya/src/block/base/format.ts:7
packages/muya/src/editor/index.ts:3
packages/muya/src/state/index.ts:2
packages/muya/src/block/content/codeBlockContent/index.ts:2
packages/muya/src/utils/marked/extensions/superSubscript.ts:1
packages/muya/src/utils/index.ts:1
packages/muya/src/utils/highlightHTML.ts:1
packages/muya/src/ui/tableDragBar/index.ts:1
packages/muya/src/ui/paragraphQuickInsertMenu/__tests__/search.spec.ts:1
packages/muya/src/ui/paragraphFrontMenu/index.ts:1
packages/muya/src/ui/paragraphFrontButton/index.ts:1
packages/muya/src/state/stateToMarkdown.ts:1
packages/muya/src/state/markdownToState.ts:1
packages/muya/src/state/markdownToHtml.ts:1
packages/muya/src/inlineRenderer/index.ts:1
packages/muya/src/history/index.ts:1
packages/muya/src/event/index.ts:1
packages/muya/src/config/index.ts:1
packages/muya/src/block/gfm/table/__tests__/subTableState.spec.ts:1
```

## P12 many-import files (top 20)

_none found_

## P14 mocks (jest.mock, vi.mock, sinon.stub, __mocks__)

_none found_

## P15 TS `any` usage (per-file counts, top 20)

_none found_

## P16 *Error enums in Rust (often duplicate variants)

_none found_

## P17 heavily drilled props (top 10 most-passed via JSX)

_none found_

## P18 everything hook (custom hook file with many useState/useEffect)

_none found_

## P19 N+1 pattern (await inside for loop)

_none found_

## P19 Python N+1 (for ... : await)

_none found_

## P20 config files (candidates for unification)

_none found_

## P22 stringly-typed status/state comparisons

_none found_

## P22 Rust stringly-typed status/state comparisons

_none found_

## P23 reflex trim/lower/upper normalization

```
packages/muya/src/clipboard/paste.ts:416:    if (markdown.trim().length === 0)
packages/muya/src/clipboard/paste.ts:493:        anchorBlock.text = markdown.trim().replace(/\n/g, '<br/>');
packages/muya/src/clipboard/paste.ts:522:        markdown = markdown.trim().replace(/\n/g, '<br/>');
packages/muya/src/clipboard/paste.ts:558:    const lines = text.trim().split('\n');
packages/muya/src/clipboard/paste.ts:585:        text: text.trim(),
packages/muya/src/block/commonMark/html/htmlPreview.ts:19:    const match = html.trim().match(/^<([a-z][a-z\d]*)[^>]*>\s*<\/\1>$/);
packages/muya/src/editor/dragDropImage.ts:134:            .map(line => line.trim())
packages/muya/src/utils/turndownService/index.ts:17:    return content.replace(/^(\[[ x]\])[ \t\u00A0]+/i, (_, marker: string) => `${marker.toLowerCase()} `);
packages/muya/src/utils/index.ts:52:    return name.replace(/_([a-z])/g, (_p0, p1) => p1.toUpperCase());
packages/muya/src/utils/embedKatexFonts.ts:75:    return (block.match(re)?.[1]?.trim().replace(QUOTE_RE, '') ?? fallback);
packages/muya/src/utils/embedKatexFonts.ts:83:        const weight = descriptor(block, WEIGHT_RE, 'normal').toLowerCase();
packages/muya/src/utils/embedKatexFonts.ts:84:        const style = descriptor(block, STYLE_RE, 'normal').toLowerCase();
packages/muya/src/inlineRenderer/index.ts:260:                label = rawLabel.toLowerCase();
packages/muya/src/state/stateToMarkdown.ts:115:                    && previousState.text.trim() !== ''
packages/muya/src/state/stateToMarkdown.ts:253:        return firstChild.name === 'paragraph' && firstChild.text.trim() === '';
packages/muya/src/state/stateToMarkdown.ts:336:        const atxHeadingText = `${match?.[1]} ${match?.[2].trim()}`;
packages/muya/src/state/stateToMarkdown.ts:344:        const lines = text.trim().split('\n');
packages/muya/src/state/stateToMarkdown.ts:348:            }\n${indent}${underline.trim()}\n`
packages/muya/src/state/stateToMarkdown.ts:381:            const trimmed = line.trim();
packages/muya/src/state/stateToMarkdown.ts:466:                rowState.children.map(cell => escapeText(cell.text.trim())),
packages/muya/src/state/markdownToState.ts:31:    const trimmed = text.replace(COMMENT_MARKER_GLOBAL_REGEXP, '').trim();
packages/muya/src/state/markdownToState.ts:90:        if (lines[index].trim() === closing)
packages/muya/src/state/markdownToState.ts:98:    const trimmed = line.trim();
packages/muya/src/state/markdownToState.ts:127:        const trimmed = line.trim();
packages/muya/src/state/markdownToState.ts:536:                const text = token.text.trim();
packages/muya/src/state/markdownToState.ts:557:                const text = token.text.trim();
packages/muya/src/__tests__/historySerialization.spec.ts:142:            expect(muya.getMarkdown().trim()).toBe('# Title');
packages/muya/src/__tests__/historySerialization.spec.ts:164:            expect(muya.getMarkdown().trim()).toBe('# Title');
packages/muya/src/__tests__/commentsApi.spec.ts:486:        expect(decode(lines[2].trim().replace('[MC:a]: ', '')).status).toBe('resolved');
packages/muya/src/__tests__/setCursorByOffset.spec.ts:63:        expect(muya.getMarkdown().trim()).toBe('first para\n\nsecond para\n\nthird para here');
packages/muya/src/__tests__/setCursorByOffset.spec.ts:154:        expect(muya.getMarkdown().trim()).toBe('only line');
packages/muya/src/state/__tests__/listSerialization.spec.ts:372:            if (line.trim() === '')
packages/muya/src/inlineRenderer/utils.ts:204:            src: text.trim(),
packages/muya/src/inlineRenderer/utils.ts:216:        src = text.substring(0, text.length - rawTitle.length).trim();
packages/muya/src/inlineRenderer/utils.ts:218:        src = text.trim();
packages/muya/src/block/base/__tests__/formatToggle.spec.ts:100:            expect(muya.getMarkdown().trim()).toBe('word');
packages/muya/src/block/base/__tests__/formatToggle.spec.ts:161:            expect(muya.getMarkdown().trim()).toBe('bar **foo** bar');
packages/muya/src/__tests__/replaceContent.spec.ts:70:    return clone.innerHTML.replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
packages/muya/src/__tests__/replaceContent.spec.ts:126:            await vi.waitFor(() => expect(muya.getMarkdown().trim()).toBe(before.trim()));
packages/muya/src/__tests__/replaceContent.spec.ts:165:        await vi.waitFor(() => expect(muya.getMarkdown().trim()).toBe('same'));
packages/muya/src/__tests__/replaceContent.spec.ts:169:        expect(muya.getMarkdown().trim()).toBe('same');
packages/muya/src/__tests__/replaceContent.spec.ts:178:        await vi.waitFor(() => expect(muya.getMarkdown().trim()).toBe('A\n\nB\n\nC\n\nD'));
packages/muya/src/__tests__/replaceContent.spec.ts:184:        expect(after.trim()).toBe('A\n\nD');
packages/muya/src/__tests__/replaceContent.spec.ts:205:        await vi.waitFor(() => expect(muya.getMarkdown().trim()).toBe('first\n\nsecond'));
packages/muya/src/__tests__/replaceContent.spec.ts:245:        await vi.waitFor(() => expect(muya.getMarkdown().trim()).toBe('base'));
packages/muya/src/__tests__/replaceContent.spec.ts:250:        expect(muya.getMarkdown().trim()).toContain('ADDED');
packages/muya/src/__tests__/replaceContent.spec.ts:275:            expect(muya.getMarkdown().trim()).toBe('base');
packages/muya/src/__tests__/replaceContent.spec.ts:293:        expect(muya.getMarkdown().trim()).toBe('completely different');
packages/muya/src/__tests__/replaceContent.spec.ts:307:            expect(muya.getMarkdown().trim()).toBe('# Title');
packages/muya/src/__tests__/replaceContent.spec.ts:314:        await vi.waitFor(() => expect(muya.getMarkdown().trim()).toBe('start'));
packages/muya/src/__tests__/replaceContent.spec.ts:333:            expect(muya.getMarkdown().trim()).toBe('start');
packages/muya/src/__tests__/replaceContent.spec.ts:352:        await vi.waitFor(() => expect(muya.getMarkdown().trim()).toBe('first\n\nsecond'));
packages/muya/src/__tests__/replaceContent.spec.ts:381:        await vi.waitFor(() => expect(muya.getMarkdown().trim()).toBe('one'));
packages/muya/src/__tests__/replaceContent.spec.ts:393:            expect(muya.getMarkdown().trim()).toBe('one');
packages/muya/src/__tests__/localeRefresh.spec.ts:98:        expect(muya.getMarkdown().trim()).toBe('alpha beta');
packages/muya/src/inlineRenderer/lexer.ts:438:            && state.labels.has((rLinkTo[3] || rLinkTo[1]).toLowerCase())
packages/muya/src/inlineRenderer/lexer.ts:485:            && state.labels.has((rImageTo[3] || rImageTo[1]).toLowerCase())
packages/muya/src/utils/__tests__/pasteUrlTitleEntities.spec.ts:15:            get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
packages/muya/src/muya.ts:1147:        if (replace || this._blockLeadingText(block).trim() === '')
packages/muya/src/muya.ts:1573:        if (leadingText.trim() === '')
packages/muya/src/utils/paste.ts:27:                    document.createElement(cell.tagName.toLowerCase()) as HTMLTableCellElement,
packages/muya/src/utils/paste.ts:56:        const title = doc.querySelector('title')?.textContent?.trim();
packages/muya/src/utils/paste.ts:167:    const trimmed = text.trim();
packages/muya/src/utils/paste.ts:307:                text.trim(),
packages/muya/src/utils/paste.ts:312:            const tag = match[1].toLowerCase();
packages/muya/src/state/__tests__/listMarkerOption.spec.ts:66:        const lines = muya.getMarkdown().split('\n').filter(l => l.trim() !== '');
packages/muya/src/state/__tests__/listMarkerOption.spec.ts:78:        const lines = muya.getMarkdown().split('\n').filter(l => l.trim() !== '');
packages/muya/src/state/__tests__/listMarkerOption.spec.ts:91:        const lines = muya.getMarkdown().split('\n').filter(l => l.trim() !== '');
packages/muya/src/state/__tests__/listMarkerOption.spec.ts:105:        const lines = muya.getMarkdown().split('\n').filter(l => l.trim() !== '');
packages/muya/src/state/__tests__/listMarkerOption.spec.ts:117:        const lines = muya.getMarkdown().split('\n').filter(l => l.trim() !== '');
packages/muya/src/state/__tests__/listMarkerOption.spec.ts:130:        const lines = muya.getMarkdown().split('\n').filter(l => l.trim() !== '');
packages/muya/src/block/base/format.ts:395:            imageText = imageText.trim();
packages/muya/src/block/base/format.ts:426:        imageText = imageText.trim();
packages/muya/src/block/base/format.ts:840:                text: matches![1].trim(),
packages/muya/src/block/base/format.ts:1697:            if (selected.trim().length > 0) {
packages/muya/src/utils/slug.ts:5:        .trim()
packages/muya/src/utils/slug.ts:6:        .toLowerCase()
packages/muya/src/inlineRenderer/renderer/referenceImage.ts:25:    if (this.parent.labels.has(rawSrc.toLowerCase()))
packages/muya/src/inlineRenderer/renderer/referenceImage.ts:26:        ({ href, title } = this.parent.labels.get(rawSrc.toLowerCase())!);
packages/muya/src/config/index.ts:14:        const value = key.toLowerCase().replace(/_/g, '-');
```

## P24 testability wrappers / mutable deps seams

_none found_

## P25 docstrings/comments that may contradict implementation

```
packages/muya/src/utils/index.ts:206: * @returns A floating-ui-compatible virtual reference positioned at the element's bounding rect.
packages/muya/src/block/base/treeNode.ts:80:     * @returns boolean
packages/muya/src/block/base/treeNode.ts:89:     * @returns boolean
packages/muya/src/block/base/content.ts:34: * @returns The matched word with its `left`/`right` offsets, or null when the
packages/muya/src/block/base/content.ts:684:     * @returns True when the replacement was applied.
packages/muya/src/muya.ts:485:     * @returns `true` if a boundary was recorded, `false` if nothing changed.
packages/muya/src/muya.ts:735:     * @returns True when the replacement was applied.
packages/muya/src/inlineRenderer/renderer/image.ts:130:     * @returns The wrapping span VNode containing the image element.
```

## P26 TypeScript type assertions

_none found_

## P27 addEventListener sites (audit for cleanup)

_none found_

## P28 timers (audit for clearTimeout/clearInterval cleanup)

_none found_

## P29 regex construction in functions/loops

```
packages/muya/src/clipboard/cut.ts:15:const EMPTY_COMMENT_RANGE_REGEXP = new RegExp(
packages/muya/src/clipboard/cut.ts:121:    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');
packages/muya/src/clipboard/cut.ts:138:    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');
packages/muya/src/clipboard/cut.ts:233:    const markers = [...text.matchAll(new RegExp(COMMENT_MARKER_PATTERN, 'gu'))].map(match => ({
packages/muya/src/clipboard/paste.ts:78:    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');
packages/muya/src/clipboard/paste.ts:112:    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');
packages/muya/src/block/scrollPage/index.ts:139:        const REG = new RegExp(`\\[${label}\\](?!:)`);
packages/muya/src/search/index.ts:30:    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');
packages/muya/src/inlineRenderer/rules.ts:42:    html_escape: new RegExp(`^(${escapeCharacters.join('|')})`, 'i'),
packages/muya/src/inlineRenderer/utils.ts:323:    const SHORTER_REG = new RegExp(
packages/muya/src/inlineRenderer/utils.ts:326:    const CLOSE_REG = new RegExp(
packages/muya/src/block/content/langInputContent/escape.ts:14:        .replace(new RegExp(MARKER_HASH['<'], 'g'), '<')
packages/muya/src/block/content/langInputContent/escape.ts:15:        .replace(new RegExp(MARKER_HASH['>'], 'g'), '>')
packages/muya/src/block/content/langInputContent/escape.ts:16:        .replace(new RegExp(MARKER_HASH['"'], 'g'), '"')
packages/muya/src/block/content/langInputContent/escape.ts:17:        .replace(new RegExp(MARKER_HASH['\''], 'g'), '\'');
packages/muya/src/utils/search.ts:27:        SEARCH_REG = new RegExp(regStr, flag);
packages/muya/src/block/base/format.ts:60:const INLINE_UPDATE_REG = new RegExp(INLINE_UPDATE_FRAGMENTS.join('|'), 'i');
packages/muya/src/block/content/codeBlockContent/index.ts:168:            .replace(new RegExp(MARKER_HASH['<'], 'g'), '<')
packages/muya/src/block/content/codeBlockContent/index.ts:169:            .replace(new RegExp(MARKER_HASH['>'], 'g'), '>')
packages/muya/src/block/content/codeBlockContent/index.ts:170:            .replace(new RegExp(MARKER_HASH['"'], 'g'), '"')
packages/muya/src/block/content/codeBlockContent/index.ts:171:            .replace(new RegExp(MARKER_HASH['\''], 'g'), '\'');
packages/muya/src/state/markdownToState.ts:22:const COMMENT_MARKER_GLOBAL_REGEXP = new RegExp(COMMENT_MARKER_PATTERN, 'g');
packages/muya/src/state/markdownToState.ts:72:    const regexp = new RegExp(`^(?: {0,3})${fence.marker}{${fence.length},}\\s*$`, 'u');
packages/muya/src/state/markdownToState.ts:106:    if (new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu').test(trimmed) || /\/>\s*$/u.test(trimmed))
packages/muya/src/state/markdownToState.ts:109:    return new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu');
packages/muya/src/utils/marked/extensions/cjkEmStrong.ts:60:const emStrongLDelim = new RegExp(
packages/muya/src/utils/marked/extensions/cjkEmStrong.ts:64:const emStrongRDelimAst = new RegExp(
packages/muya/src/utils/marked/extensions/cjkEmStrong.ts:68:const emStrongRDelimUnd = new RegExp(
packages/muya/src/utils/marked/extensions/cjkEmStrong.ts:76:const punctuation = new RegExp(
packages/muya/src/utils/marked/extensions/cjkEmStrong.ts:84:const unicodeAlphaNumeric = new RegExp(
packages/muya/src/comments/edit.ts:50:const COMMENT_METADATA_LINE_REGEXP = new RegExp(
packages/muya/src/comments/edit.ts:117:    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');
packages/muya/src/comments/parse.ts:102:    const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'gu');
packages/muya/src/comments/syntax.ts:6:export const COMMENT_MARKER_REGEXP = new RegExp(`^${COMMENT_MARKER_PATTERN}`);
packages/muya/src/comments/syntax.ts:7:export const COMMENT_MARKER_SEARCH_REGEXP = new RegExp(COMMENT_MARKER_PATTERN);
packages/muya/src/comments/syntax.ts:47:    return new RegExp(`^${COMMENT_ID_PATTERN}$`).test(id);
packages/muya/src/comments/syntax.ts:82:        new RegExp(COMMENT_MARKER_PATTERN, 'g'),
packages/muya/src/comments/syntax.ts:94:    const markerRegExp = new RegExp(COMMENT_MARKER_TEXT_PATTERN, 'g');
packages/muya/src/comments/syntax.ts:118:    const withoutMarkers = text.replace(new RegExp(COMMENT_MARKER_PATTERN, 'g'), '');
```

## P30 debug print/log leftovers

```
packages/muya/src/clipboard/__tests__/copyHandler.spec.ts:101:        clipboard.copyInfo = 'console.log("x")';
packages/muya/src/clipboard/__tests__/copyHandler.spec.ts:107:        expect(setData).toHaveBeenCalledWith('text/plain', 'console.log("x")');
packages/muya/src/clipboard/__tests__/mergePasteIntoHeading.spec.ts:126:            { name: 'code-block', text: 'console.log()' },
packages/muya/src/__tests__/getTOC.spec.ts:154:            'console.log(1)',
packages/muya/src/state/__tests__/renderToStaticHTML.spec.ts:51:        const html = renderToStaticHTML('```js\nconsole.log(1);\n```');
```

## P31 JSON.stringify used as key/hash/memo identity

_none found_

## P32 money-like arithmetic (audit integer cents/decimal)

_none found_

## P33 local time / UTC drift candidates

```
packages/muya/src/history/index.ts:298:        const timestamp = Date.now();
packages/muya/src/utils/index.ts:38:    return `${getUniqueId()}-${(Date.now()).toString(32)}`;
packages/muya/src/utils/index.ts:97:        previous = Date.now();
packages/muya/src/utils/index.ts:112:        const now = Date.now();
packages/muya/src/muya.ts:348:        const createdAt = reply.createdAt ?? new Date().toISOString();
packages/muya/src/muya.ts:370:    resolveComment(id: string, updatedAt = new Date().toISOString()): boolean {
packages/muya/src/muya.ts:374:    reopenComment(id: string, updatedAt = new Date().toISOString()): boolean {
packages/muya/src/comments/edit.ts:242:    const createdAt = input.createdAt ?? new Date().toISOString();
```

## P34 detailed internal errors exposed

_none found_

## P35 suspicious ambiguous imports

_none found_

## P36 infra/config surfaces that should not ride with refactor commits

```
./pnpm-lock.yaml
./package.json
./packages/muyajs/package.json
./packages/website/package.json
./packages/desktop/package.json
./packages/muya/package.json
./.github/workflows/muya-e2e.yml
./.github/workflows/release.yml
./.github/workflows/muya-circular.yml
./.github/workflows/lint.yml
./.github/workflows/test.yml
./.github/workflows/muya-build.yml
./.github/workflows/muya-spec.yml
./.github/workflows/muya-test.yml
./.github/workflows/claude.yml
./.github/workflows/muya-lint.yml
./.github/workflows/validate-licenses.yml
./.github/workflows/e2e.yml
./.github/workflows/website-deploy.yml
./.github/workflows/build.yml
./skills/markdown-comments/package.json
```

## P37 unpinned dependency snippets

_none found_

## P38 wildcard/glob imports

```
packages/muya/src/editor/index.ts:8:import * as otText from 'ot-text-unicode';
packages/muya/src/state/index.ts:5:import * as json1 from 'ot-json1';
packages/muya/src/history/index.ts:6:import * as json1 from 'ot-json1';
packages/muya/src/utils/turndownService/index.ts:2:import * as turndownPluginGfm from 'joplin-turndown-plugin-gfm';
```

## P39 async functions returning Promise (audit for real await)

_none found_

## P40 await/then in nearby non-async contexts (manual audit)

_none found_

---

## Next steps

1. Review each section; confirm which hits are real vs. false positives.
2. File beads for accepted patterns (one per pathology class).
3. Proceed to `./scripts/dup_scan.sh` for structural duplication.
4. Score candidates via `./scripts/score_candidates.py`.
5. For each accepted candidate: fill isomorphism card, edit, verify, ledger.

Full P1-P40 pathology catalog: `references/VIBE-CODED-PATHOLOGIES.md`.
Attack order (cheap wins first): the "AI-slop refactor playbook" in that file.
