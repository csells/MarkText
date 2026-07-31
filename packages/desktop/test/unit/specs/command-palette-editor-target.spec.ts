// @vitest-environment happy-dom

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import bus from '@/bus'
import commands from '@/commands'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  bus.all.clear()
})

function command(id: string) {
  const found = commands.find(candidate => candidate.id === id)
  if (found?.execute === undefined) {
    throw new Error(`Command ${id} is not executable`)
  }
  return found
}

describe('command-palette editor targeting', () => {
  it('dispatches a mutation synchronously to the editor active at invocation', async() => {
    const events: unknown[] = []
    bus.on('editor-focus', () => events.push('focus'))
    bus.on('editor-command', value => events.push(value))

    await command('paragraph.heading-1').execute?.()

    expect(events).toEqual(['focus', 'heading-1'])
  })

  it('uses one command id for ordered lists, paragraph reset, and Table', async() => {
    const events: unknown[] = []
    bus.on('editor-command', value => events.push(value))

    await command('paragraph.order-list').execute?.()
    await command('paragraph.reset-paragraph').execute?.()
    await command('paragraph.table').execute?.()

    expect(events).toEqual(['ordered-list', 'paragraph', 'insert-table'])
  })

  it('exposes working Find Next and Find Previous commands', async() => {
    const events: unknown[] = []
    bus.on('editor-command', value => events.push(value))

    await command('edit.find-next').execute?.()
    await command('edit.find-previous').execute?.()

    expect(events).toEqual(['find-next', 'find-previous'])
  })

  it('publishes shared Review availability to the command palette descriptors', () => {
    const store = useCriticMarkupReviewStore()
    store.UPDATE_COMMAND_STATE({
      available: true,
      canCreateAddition: false,
      canCreateDeletion: false,
      canCreateSubstitution: false,
      canCreateHighlight: false,
      canCreateComment: false,
      canNavigate: true,
      canResolveCurrent: true,
      canResolveAll: false,
      canRemoveAllAnnotations: false,
      trackChanges: false,
      projection: 'marked'
    })

    expect(command('review.next').isAvailable?.()).toBe(true)
    expect(command('review.accept-current').isAvailable?.()).toBe(true)
    expect(command('review.accept-all').isAvailable?.()).toBe(false)
    expect(command('review.mark-addition').isAvailable?.()).toBe(false)
  })
})
