import { describe, expect, it, vi } from 'vitest'
import { createCommentComposer } from '@/components/editorWithTabs/commentComposer'

describe('CriticMarkup sidebar comment composer', () => {
  it('opens composition and resolves with the submitted text', async() => {
    const onActiveChange = vi.fn()
    const composer = createCommentComposer(onActiveChange)

    const pending = composer.request()
    // Opening composition tells the sidebar to show its compose box.
    expect(onActiveChange).toHaveBeenNthCalledWith(1, true)
    expect(composer.active).toBe(true)

    composer.submit('a review note')
    await expect(pending).resolves.toBe('a review note')
    // Composition closes once the note is submitted.
    expect(onActiveChange).toHaveBeenLastCalledWith(false)
    expect(composer.active).toBe(false)
  })

  it('resolves null when composition is cancelled', async() => {
    const onActiveChange = vi.fn()
    const composer = createCommentComposer(onActiveChange)

    const pending = composer.request()
    composer.cancel()

    await expect(pending).resolves.toBeNull()
    expect(onActiveChange).toHaveBeenLastCalledWith(false)
    expect(composer.active).toBe(false)
  })

  it('supersedes an in-flight composition when a new one begins', async() => {
    const composer = createCommentComposer(vi.fn())

    const first = composer.request()
    const second = composer.request()

    // Starting a second comment abandons the first rather than stranding it.
    await expect(first).resolves.toBeNull()
    composer.submit('second note')
    await expect(second).resolves.toBe('second note')
  })

  it('ignores submit and cancel when nothing is being composed', () => {
    const onActiveChange = vi.fn()
    const composer = createCommentComposer(onActiveChange)

    expect(() => composer.submit('stray')).not.toThrow()
    expect(() => composer.cancel()).not.toThrow()
    expect(onActiveChange).not.toHaveBeenCalled()
    expect(composer.active).toBe(false)
  })
})
