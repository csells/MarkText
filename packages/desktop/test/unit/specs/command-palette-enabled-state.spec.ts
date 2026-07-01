import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, ref } from 'vue'

const here = dirname(fileURLToPath(import.meta.url))
const vuePath = resolve(here, '../../../src/renderer/src/components/commandPalette/index.vue')

interface CommandItem {
  id: string
  description?: string
  subcommands?: CommandItem[]
  subcommandSelectedIndex?: number
  isEnabled?: () => boolean
}

interface SetupBindings {
  availableCommands: { value: CommandItem[] }
  handleShow: (command?: CommandItem) => void
  query: { value: string }
  updateCommands: () => void
}

const loadComponent = (deps: Record<string, unknown>) => {
  const src = readFileSync(vuePath, 'utf8')
  const { descriptor } = parse(src)
  const compiled = compileScript(descriptor, { id: 'test' })
  const noImports = compiled.content.replace(
    /^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,
    ''
  )
  const js = ts.transpileModule(noImports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    '__deps',
    'exports',
    'module',
    `const { _defineComponent, ref, onMounted, onBeforeUnmount, nextTick,
      onBeforeUpdate, computed, useCommandCenterStore, log, bus, loading,
      useI18n } = __deps
    ${js}
    return module.exports`
  ) as (deps: Record<string, unknown>, exports: object, module: object) => {
    default: { setup: (props: unknown, ctx: { expose: () => void }) => SetupBindings }
  }

  const m = { exports: {} as Record<string, unknown> }
  return factory(deps, m.exports, m).default
}

const makeBindings = (rootCommand: CommandItem) => {
  const deps = {
    _defineComponent: (o: unknown) => o,
    ref,
    onMounted,
    onBeforeUnmount,
    nextTick,
    onBeforeUpdate,
    computed,
    useCommandCenterStore: () => ({ rootCommand }),
    log: { error: vi.fn() },
    bus: { on: () => {}, off: () => {}, emit: vi.fn() },
    loading: {},
    useI18n: () => ({ t: (key: string) => key })
  }
  const comp = loadComponent(deps)
  return comp.setup({}, { expose: () => {} })
}

describe('command palette enabled state', () => {
  it('does not offer disabled commands from the root command list', async() => {
    const rootCommand: CommandItem = {
      id: '#',
      subcommands: [
        {
          id: 'review.add-comment',
          description: 'Add Comment',
          isEnabled: () => false
        },
        {
          id: 'file.save',
          description: 'Save',
          isEnabled: () => true
        }
      ]
    }
    const bindings = makeBindings(rootCommand)

    bindings.handleShow(rootCommand)
    await Promise.resolve()
    await nextTick()

    expect(bindings.availableCommands.value.map(command => command.id)).toEqual(['file.save'])

    bindings.query.value = 'add'
    bindings.updateCommands()
    expect(bindings.availableCommands.value).toEqual([])
  })
})
