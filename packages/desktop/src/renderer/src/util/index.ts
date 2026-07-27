export interface CancellablePromise<T> extends Promise<T> {
  cancel: () => void
}

export const delay = (time: number): CancellablePromise<void> => {
  let timerId: ReturnType<typeof setTimeout> | null
  let rejectFn: ((reason?: unknown) => void) | null
  const p = new Promise<void>((resolve, reject) => {
    rejectFn = reject
    timerId = setTimeout(() => {
      ;(p as CancellablePromise<void>).cancel = () => {}
      rejectFn = null
      resolve()
    }, time)
  }) as CancellablePromise<void>

  p.cancel = () => {
    if (timerId) clearTimeout(timerId)
    timerId = null
    if (rejectFn) rejectFn()
    rejectFn = null
  }
  return p
}

const ID_PREFIX = 'mt-'
let id = 0

export const animatedScrollTo = function(
  element: HTMLElement,
  to: number,
  duration: number,
  callback?: () => void
): void {
  const start = element.scrollTop
  const change = to - start
  const animationStart = +new Date()

  // Prevent animation on small steps or duration is 0
  if (Math.abs(change) <= 6 || duration === 0) {
    element.scrollTop = to
    return
  }

  const easeInOutQuad = function(t: number, b: number, c: number, d: number): number {
    t /= d / 2
    if (t < 1) return (c / 2) * t * t + b
    t--
    return (-c / 2) * (t * (t - 2) - 1) + b
  }

  const animateScroll = function(): void {
    const now = +new Date()
    const val = Math.floor(easeInOutQuad(now - animationStart, start, change, duration))

    element.scrollTop = val

    if (now > animationStart + duration) {
      element.scrollTop = to
      if (callback) {
        callback()
      }
    } else {
      requestAnimationFrame(animateScroll)
    }
  }

  requestAnimationFrame(animateScroll)
}

export const getUniqueId = (): string => {
  return `${ID_PREFIX}${id++}`
}

export const hasKeys = (obj: object): boolean => Object.keys(obj).length > 0

/**
 * Shallow clone the given object.
 *
 * @param obj Object to clone
 * @param inheritFromObject Whether the clone should inherit from `Object`
 */
export const cloneObject = <T extends object>(obj: T, inheritFromObject = true): T => {
  return Object.assign(inheritFromObject ? {} : Object.create(null), obj)
}

/**
 * Deep clone the given object.
 *
 * @param obj Object to clone
 */
export const deepClone = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj))
}

const platform =
  (typeof window !== 'undefined' &&
    window.electron &&
    window.electron.process &&
    window.electron.process.platform) ||
  ''
export const isOsx = platform === 'darwin'
export const isWindows = platform === 'win32'
export const isLinux = platform === 'linux'
