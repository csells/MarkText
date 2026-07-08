import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// Real-mount component spec per specs/architecture/test-infrastructure.md:
// commandPalette/index.vue is mounted with @vue/test-utils and opened the way
// the app opens it (the 'show-command-palette' bus event); the enabled-state
// contract is asserted on the rendered command list.

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      electron?: { ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void } }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.electron ??= { ipcRenderer: { send: () => {}, on: () => {} } }
})

vi.mock('electron-log', () => ({ default: { error: vi.fn() } }))
vi.mock(import('vue-i18n'), async(importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useI18n: (() => ({ t: (key: string) => key })) as unknown as typeof actual.useI18n
  }
})

import CommandPalette from '@/components/commandPalette/index.vue'
import bus from '@/bus'

interface CommandItem {
  id: string
  description?: string
  subcommands?: CommandItem[]
  subcommandSelectedIndex?: number
  isEnabled?: () => boolean
}

const mountPalette = (): VueWrapper => {
  setActivePinia(createPinia())
  return mount(CommandPalette, {
    global: {
      stubs: {
        // Third-party UI boundary: el-dialog owns overlay/teleport concerns;
        // the palette's own DOM (input + command list) renders through the
        // title slot, which this stub passes through unconditionally.
        'el-dialog': {
          template: '<div class="dialog-stub"><slot name="title" /><slot /></div>'
        }
      }
    },
    attachTo: document.body
  })
}

const listedCommands = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.commands li').map((item) => item.text())

describe('command palette enabled state', () => {
  let wrapper: VueWrapper | null = null

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

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
    wrapper = mountPalette()

    bus.emit('show-command-palette', rootCommand)
    await Promise.resolve()
    await nextTick()

    expect(listedCommands(wrapper)).toHaveLength(1)
    expect(listedCommands(wrapper)[0]).toContain('Save')
    expect(wrapper.text()).not.toContain('Add Comment')

    // Filtering by query must not resurrect the disabled command.
    const input = wrapper.find('input.search')
    await input.setValue('add')
    await input.trigger('keyup')
    await nextTick()

    expect(listedCommands(wrapper)).toHaveLength(0)
  })
})
