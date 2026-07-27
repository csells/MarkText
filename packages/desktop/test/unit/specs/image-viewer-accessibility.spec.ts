import { createI18n } from 'vue-i18n'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import ImageViewerOverlay from '@/components/editorWithTabs/imageViewerOverlay.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      common: { close: 'Close' },
      editor: { imageViewer: { label: 'Image preview' } }
    }
  }
})

describe('image viewer keyboard and focus behavior', () => {
  it('acts as a labelled modal, traps Tab, closes on Escape, and restores its opener', async() => {
    const opener = document.createElement('button')
    opener.textContent = 'Open preview'
    document.body.appendChild(opener)
    opener.focus()
    const wrapper = mount(ImageViewerOverlay, {
      attachTo: document.body,
      props: { visible: false },
      global: {
        plugins: [i18n],
        stubs: { CloseIcon: true }
      }
    })

    try {
      await wrapper.setProps({ visible: true })
      await nextTick()

      const dialog = wrapper.get('[role="dialog"]')
      const close = wrapper.get<HTMLButtonElement>('.icon-close')
      expect(dialog.attributes()).toMatchObject({
        'aria-modal': 'true',
        'aria-label': 'Image preview'
      })
      expect(close.attributes('aria-label')).toBe('Close')
      expect(document.activeElement).toBe(close.element)

      await close.trigger('keydown', { key: 'Tab' })
      expect(document.activeElement).toBe(close.element)

      await close.trigger('keydown', { key: 'Escape' })
      expect(wrapper.emitted('close')).toHaveLength(1)
      await wrapper.setProps({ visible: false })
      await nextTick()
      expect(document.activeElement).toBe(opener)
    } finally {
      wrapper.unmount()
      opener.remove()
    }
  })
})
