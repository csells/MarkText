// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { animatedScrollTo } from '@/util'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('gives the newest scroll request sole ownership of the viewport', () => {
  vi.useFakeTimers({ toFake: ['Date', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  const viewport = document.createElement('div')
  const retired = vi.fn()
  animatedScrollTo(viewport, 300, 300, retired)
  vi.advanceTimersByTime(80)
  expect(viewport.scrollTop).toBeGreaterThan(0)
  animatedScrollTo(viewport, 10, 0)
  vi.advanceTimersByTime(400)
  expect(viewport.scrollTop).toBe(10)
  expect(retired).not.toHaveBeenCalled()
})
