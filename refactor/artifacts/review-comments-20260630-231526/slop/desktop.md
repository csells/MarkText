# AI slop scan — review-comments-20260630-231526-desktop

Generated 2026-07-01T06:16:59Z
Scope: `packages/desktop/src`

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

```
LEGACY_EDIT_ADD_COMMENT
LEGACY_KEYBINDING_IDS
```

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
packages/desktop/src/main/windows/editor.ts:5
packages/desktop/src/renderer/src/prefComponents/keybindings/key-input-dialog.vue:2
packages/desktop/src/main/utils/imagePathAutoComplement.ts:2
packages/desktop/src/main/preferences/index.ts:2
packages/desktop/src/main/filesystem/watcher.ts:2
packages/desktop/src/main/filesystem/markdown.ts:2
packages/desktop/src/main/app/windowManager.ts:2
packages/desktop/src/renderer/src/prefComponents/image/components/uploader/services.ts:1
packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue:1
packages/desktop/src/renderer/src/commands/index.ts:1
packages/desktop/src/main/utils/index.ts:1
packages/desktop/src/main/menu/templates/help.ts:1
packages/desktop/src/main/menu/templates/edit.ts:1
packages/desktop/src/main/menu/index.ts:1
packages/desktop/src/main/menu/actions/marktext.ts:1
packages/desktop/src/main/menu/actions/file.ts:1
packages/desktop/src/main/menu/actions/edit.ts:1
packages/desktop/src/main/app/paths.ts:1
packages/desktop/src/main/app/index.ts:1
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
packages/desktop/src/preload/index.ts:131:  return MARKDOWN_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(`.${ext}`))
packages/desktop/src/preload/index.ts:146:  if (a.toLowerCase() === b.toLowerCase()) {
packages/desktop/src/main/ipc/uploader.ts:56:      .map((l) => l.trim())
packages/desktop/src/main/ipc/uploader.ts:84:    const candidate = marker[marker.length - 1].trim()
packages/desktop/src/main/ipc/uploader.ts:115:        resolve(String(data || '').trim())
packages/desktop/src/main/editorBufferStore/index.ts:167:    if (!content.trim()) {
packages/desktop/src/main/utils/index.ts:18:    const matches = t.trim().match(/(#{1,6}) {1,}(.+)/)!
packages/desktop/src/main/utils/index.ts:21:      content: matches[2]!.trim()
packages/desktop/src/main/filesystem/encoding.ts:77:      encoding = encoding.toLowerCase().replace(/-_/g, '')
packages/desktop/src/main/contextMenu/editor/index.ts:92:    const hasText = selectionText.trim().length > 0
packages/desktop/src/main/app/windowManager.ts:236:    const upper = type.toUpperCase() as keyof typeof WindowType
packages/desktop/src/renderer/src/store/help.ts:120:    adjustLineEndingOnSave: lineEnding.toLowerCase() === 'crlf',
packages/desktop/src/common/filesystem/paths.ts:40:  return MARKDOWN_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(`.${ext}`))
packages/desktop/src/common/filesystem/paths.ts:47:  const ext = path.extname(filepath).slice(1).toLowerCase()
packages/desktop/src/common/filesystem/paths.ts:79:  } else if (a.toLowerCase() === b.toLowerCase()) {
packages/desktop/src/renderer/src/store/editor.ts:511:            lineEnding: lineEnding.toUpperCase()
packages/desktop/src/renderer/src/store/editor.ts:1738:              lineEnding: lineEnding.toUpperCase()
packages/desktop/src/renderer/src/store/editor.ts:2271:  return text.slice(from, to).trim().length > 0
packages/desktop/src/renderer/src/util/sourceModeToc.ts:75:    if (line.trim() !== '' && next !== undefined && /^ {0,3}(?:=+|-+)\s*$/.test(next)) {
packages/desktop/src/renderer/src/codeMirror/markdownCommentMode.ts:56:  const trimmed = line.trim()
packages/desktop/src/common/keybinding/index.ts:5:    .toLowerCase()
packages/desktop/src/renderer/src/util/accelerator.ts:38:    .map((part) => part.trim())
packages/desktop/src/renderer/src/util/accelerator.ts:40:    .map((part) => map[part.toLowerCase()] ?? part)
packages/desktop/src/renderer/src/components/commandPalette/index.vue:267:  const queryString = query.value.trim()
packages/desktop/src/renderer/src/components/commandPalette/index.vue:298:      (c) => (c.description ?? '').toLowerCase().includes(queryString.toLowerCase())
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:473:    if (lineText.trim() === marker) {
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:526:    const trimmed = lineText.trim()
packages/desktop/src/renderer/src/components/sideBar/comments.vue:157:                :disabled="!editDrafts[replyEditKey(thread.id, index)]?.trim()"
packages/desktop/src/renderer/src/components/sideBar/comments.vue:230:            :disabled="!editDrafts[replyEditKey(thread.id, 0)]?.trim()"
packages/desktop/src/renderer/src/components/sideBar/comments.vue:249:          :disabled="!replyDrafts[thread.id]?.trim()"
packages/desktop/src/renderer/src/components/sideBar/comments.vue:301:  const configured = preferencesStore.commentAuthorName.trim()
packages/desktop/src/renderer/src/components/sideBar/comments.vue:395:  const body = editDrafts[key]?.trim()
packages/desktop/src/renderer/src/components/sideBar/comments.vue:423:  const body = replyDrafts[id]?.trim()
packages/desktop/src/renderer/src/prefComponents/theme/index.vue:121:    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
packages/desktop/src/renderer/src/prefComponents/common/fontTextBox/index.vue:77:      ? fontFamilies.value.filter((f) => f.toLowerCase().indexOf(queryString.toLowerCase()) === 0)
packages/desktop/src/renderer/src/prefComponents/common/fontTextBox/index.vue:99:  fontFamilies.value = (fonts || []).map((f) => f.replace(/"/g, '').trim())
packages/desktop/src/renderer/src/prefComponents/sideBar/index.vue:92:  const q = queryString.toLowerCase()
packages/desktop/src/renderer/src/prefComponents/sideBar/index.vue:102:      .map((s) => String(s).toLowerCase())
packages/desktop/src/renderer/src/prefComponents/sideBar/index.vue:112:    item && item.routeCategory ? item.routeCategory : (item?.category || 'general').toLowerCase()
packages/desktop/src/renderer/src/prefComponents/sideBar/index.vue:117:  if (item.name.toLowerCase() !== currentCategory.value) {
packages/desktop/src/renderer/src/prefComponents/sideBar/config.ts:142:      let mappedCategory = categoryName.toLowerCase()
packages/desktop/src/renderer/src/prefComponents/sideBar/config.ts:155:        mappedCategory = categoryName.toLowerCase().replace(/\s+/g, '-')
```

## P24 testability wrappers / mutable deps seams

_none found_

## P25 docstrings/comments that may contradict implementation

```
packages/desktop/src/main/keyboard/shortcutHandler.ts:113:   * @returns User key bindings.
packages/desktop/src/main/menu/index.ts:585: * @returns Returns the menu or null.
packages/desktop/src/main/preferences/index.ts:197:   * @returns Supported system language code or null
packages/desktop/src/main/cli/parser.ts:8: * @returns Parsed arguments
packages/desktop/src/main/utils/index.ts:33: * @returns The resolved special directory path.
packages/desktop/src/renderer/src/commands/descriptions.ts:227: * @returns Returns the internationalized command description, or the original ID if no description is found
packages/desktop/src/renderer/src/store/editor.ts:2320: * @returns A object that represents the application menu state.
packages/desktop/src/renderer/src/bootstrap.ts:63: * @returns True if this is a suppressible CodeMirror error
```

## P26 TypeScript type assertions

_none found_

## P27 addEventListener sites (audit for cleanup)

_none found_

## P28 timers (audit for clearTimeout/clearInterval cleanup)

_none found_

## P29 regex construction in functions/loops

```
packages/desktop/src/main/ipc/ripgrep.ts:136:    pattern = pattern.replace(new RegExp(`\\${sep || path.sep}`, 'g'), '/')
packages/desktop/src/main/ipc/shell.ts:60:        const filePath = raw ? raw.replace(new RegExp(String.fromCharCode(0), 'g'), '') : ''
packages/desktop/src/main/utils/imagePathAutoComplement.ts:20:const IMAGE_REG = new RegExp('(' + IMAGE_EXTENSIONS.join('|') + ')$', 'i')
packages/desktop/src/common/i18n.ts:86:    result = result.replace(new RegExp(`\\{${param}\\}`, 'g'), String(replacement))
packages/desktop/src/renderer/src/codeMirror/markdownCommentMode.ts:48:const COMMENT_MARKER = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u')
packages/desktop/src/renderer/src/codeMirror/markdownCommentMode.ts:49:const COMMENT_METADATA = new RegExp(
packages/desktop/src/renderer/src/codeMirror/markdownCommentMode.ts:53:const COMMENT_MARKER_LINE = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u')
packages/desktop/src/renderer/src/codeMirror/markdownCommentMode.ts:131:  if (!new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'i').test(trimmed) && !/\/>\s*$/.test(trimmed)) {
packages/desktop/src/renderer/src/codeMirror/markdownCommentMode.ts:132:    state.htmlClosing = new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'i')
packages/desktop/src/renderer/src/commands/quickOpen.ts:125:      const re = new RegExp(
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:333:  const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'g')
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:357:const COMMENT_METADATA_LINE_REGEXP = new RegExp(
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:362:const SOURCE_COMMENT_MARKER_START_REGEXP = new RegExp(`^${COMMENT_MARKER_PATTERN}`, 'u')
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:551:    if (new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu').test(trimmed) || /\/>\s*$/u.test(trimmed)) {
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:555:      closing = new RegExp(`</${escapeRegExp(tag[1])}\\s*>`, 'iu')
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:610:  const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'g')
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:641:  const markerRegExp = new RegExp(`<!--MC:~?${escapeRegExp(id)}-->`, 'g')
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:672:  const markerRegExp = new RegExp(COMMENT_MARKER_PATTERN, 'g')
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:982:    lines[index] = oldLine.replace(new RegExp(`!\\[${id}\\]\\(.*\\)`), `![${alt}](${result})`)
packages/desktop/src/renderer/src/components/search/index.vue:324:      const SEARCH_REG = new RegExp(searchValue.value)
```

## P30 debug print/log leftovers

```
packages/desktop/src/main/keyboard/shortcutHandler.ts:170:        console.log('[DEBUG] Keyboard layout changed:\n', layout)
packages/desktop/src/main/keyboard/shortcutHandler.ts:229:          console.log(err)
packages/desktop/src/main/exceptionHandler.ts:50:    console.log(t('error.terminatedDueToError'))
packages/desktop/src/main/filesystem/watcher.ts:302:          console.log('watcher: ', event, subpath, details)
packages/desktop/src/main/filesystem/watcher.ts:444:                  console.log(
packages/desktop/src/renderer/src/store/project.ts:192:          console.log(`Unknown directory watch type: "${type}"`)
packages/desktop/src/renderer/src/i18n/index.ts:89:      console.log(`🌐 Loaded and set new locale: ${locale}`)
packages/desktop/src/renderer/src/assets/symbolIcon/index.js:82:      console && console.log(e)
```

## P31 JSON.stringify used as key/hash/memo identity

_none found_

## P32 money-like arithmetic (audit integer cents/decimal)

_none found_

## P33 local time / UTC drift candidates

```
packages/desktop/src/main/ipc/uploader.ts:125:  const tmpPath = path.join(tmpdir(), `${Date.now()}${suffix}`)
packages/desktop/src/main/filesystem/watcher.ts:408:    this._ignoreChangeEvents.push({ windowId, pathname, duration, start: new Date() })
packages/desktop/src/main/filesystem/watcher.ts:423:      const currentTime = new Date()
packages/desktop/src/main/exceptionHandler.ts:35:    `Date: ${new Date().toUTCString()}\n` +
packages/desktop/src/main/dataCenter/index.ts:101:      if (item) item.timeStamp = +new Date()
packages/desktop/src/main/dataCenter/index.ts:103:      item = { url, timeStamp: +new Date() }
packages/desktop/src/main/editorBufferStore/index.ts:182:      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${++this.writeSequence}.tmp`
packages/desktop/src/common/envPaths.ts:13:    const currentDate = new Date()
packages/desktop/src/renderer/src/node/ripgrepSearcher.ts:35:const genId = (): string => `rg-${Date.now()}-${nextId++}`
packages/desktop/src/renderer/src/util/index.ts:146:  const animationStart = +new Date()
packages/desktop/src/renderer/src/util/index.ts:162:    const now = +new Date()
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:890:  const createdAt = reply.createdAt ?? new Date().toISOString()
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:925:    updatedAt: new Date().toISOString()
packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue:934:    updatedAt: new Date().toISOString()
packages/desktop/src/renderer/src/components/about/index.vue:53:const copyright = t('about.copyright', { year: new Date().getFullYear() })
packages/desktop/src/renderer/src/components/sideBar/comments.vue:398:  const updatedAt = new Date().toISOString()
packages/desktop/src/renderer/src/prefComponents/image/components/uploader/index.vue:695:  lastDetectionTime.value = new Date().toISOString()
packages/desktop/src/renderer/src/prefComponents/image/components/uploader/index.vue:698:  debugMessages.push(`Detection time: ${new Date().toLocaleString()}`)
packages/desktop/src/renderer/src/prefComponents/image/components/uploader/index.vue:754:      lastSuccessTime.value = new Date().toISOString()
```

## P34 detailed internal errors exposed

```
packages/desktop/src/main/ipc/shell.ts:30:      return String(err instanceof Error ? err.message : err)
```

## P35 suspicious ambiguous imports

```
packages/desktop/src/main/keyboard/index.ts:3:import EventEmitter from 'events'
packages/desktop/src/main/keyboard/index.ts:13:import path from 'path'
packages/desktop/src/main/keyboard/shortcutHandler.ts:4:import path from 'path'
packages/desktop/src/main/windows/setting.ts:1:import path from 'path'
packages/desktop/src/main/windows/editor.ts:1:import path from 'path'
packages/desktop/src/main/windows/base.ts:1:import path from 'path'
packages/desktop/src/main/config.ts:1:import path from 'path'
packages/desktop/src/main/index.ts:2:import path from 'path'
packages/desktop/src/main/ipc/ripgrep.ts:2:import path from 'path'
packages/desktop/src/main/ipc/uploader.ts:1:import path from 'path'
packages/desktop/src/main/ipc/bootInfo.ts:1:import path from 'path'
packages/desktop/src/main/menu/index.ts:2:import path from 'path'
packages/desktop/src/main/menu/templates/help.ts:1:import path from 'path'
packages/desktop/src/main/dataCenter/index.ts:2:import path from 'path'
packages/desktop/src/main/editorBufferStore/index.ts:2:import path from 'path'
packages/desktop/src/main/menu/actions/edit.ts:1:import path from 'path'
packages/desktop/src/main/globalSetting.ts:1:import path from 'path'
packages/desktop/src/main/preferences/index.ts:2:import path from 'path'
packages/desktop/src/main/cli/index.ts:1:import path from 'path'
packages/desktop/src/main/menu/actions/file.ts:2:import path from 'path'
packages/desktop/src/main/utils/imagePathAutoComplement.ts:2:import path from 'path'
packages/desktop/src/main/app/env.ts:1:import path from 'path'
packages/desktop/src/main/filesystem/index.ts:2:import path from 'path'
packages/desktop/src/common/filesystem/paths.ts:2:import path from 'path'
packages/desktop/src/main/utils/pandoc.ts:3:import type { Readable } from 'stream'
packages/desktop/src/main/filesystem/watcher.ts:1:import path from 'path'
packages/desktop/src/main/app/index.ts:1:import path from 'path'
packages/desktop/src/common/filesystem/index.ts:3:import { resolve, dirname } from 'path'
packages/desktop/src/main/filesystem/markdown.ts:2:import path from 'path'
packages/desktop/src/common/envPaths.ts:1:import path from 'path'
packages/desktop/src/common/i18n.ts:2:import path from 'path'
```

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
packages/desktop/src/main/ipc/shell.ts:3:import * as plist from 'plist'
packages/desktop/src/main/menu/templates/theme.ts:2:import * as actions from '../actions/theme'
packages/desktop/src/main/menu/templates/marktext.ts:3:import * as actions from '../actions/marktext'
packages/desktop/src/main/menu/templates/edit.ts:2:import * as actions from '../actions/edit'
packages/desktop/src/main/menu/templates/format.ts:2:import * as actions from '../actions/format'
packages/desktop/src/main/menu/templates/dock.ts:2:import * as actions from '../actions/file'
packages/desktop/src/main/menu/templates/review.ts:2:import * as actions from '../actions/edit'
packages/desktop/src/main/menu/templates/view.ts:2:import * as actions from '../actions/view'
packages/desktop/src/main/menu/templates/file.ts:2:import * as actions from '../actions/file'
packages/desktop/src/main/menu/templates/paragraph.ts:2:import * as actions from '../actions/paragraph'
packages/desktop/src/main/menu/templates/help.ts:4:import * as actions from '../actions/help'
packages/desktop/src/renderer/src/contextMenu/tabs/menuItems.ts:1:import * as contextMenu from './actions'
packages/desktop/src/renderer/src/contextMenu/sideBar/menuItems.ts:1:import * as contextMenu from './actions'
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
