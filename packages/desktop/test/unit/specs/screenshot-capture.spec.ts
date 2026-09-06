// @vitest-environment node
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile }))

import { captureScreenshot } from 'main_renderer/app/screenshotCapture'

describe('native screenshot capture ownership', () => {
  beforeEach(() => { execFile.mockReset() })

  it('captures to its own image file without reading or replacing the system clipboard', async() => {
    const folder = await mkdtemp(path.join(tmpdir(), 'marktext-screenshot-test-'))
    const image = Buffer.from('test PNG bytes')
    execFile.mockImplementation((command, args, callback) => {
      expect(command).toBe('/usr/sbin/screencapture')
      expect(args).not.toContain('-c')
      return writeFile(args.at(-1), image).then(() => callback(null, '', ''), callback)
    })
    const captured = await captureScreenshot(folder)
    expect(captured).toBeTruthy()
    if (!captured) throw new Error('Expected a screenshot')
    expect(await readFile(captured)).toEqual(image)
  })

  it('treats cancellation as no image, even with existing images in the capture folder', async() => {
    const folder = await mkdtemp(path.join(tmpdir(), 'marktext-screenshot-test-'))
    await writeFile(path.join(folder, 'previous.png'), 'existing user capture')
    execFile.mockImplementation((_command, _args, callback) => callback(null, '', ''))
    expect(await captureScreenshot(folder)).toBeUndefined()
    expect(await readFile(path.join(folder, 'previous.png'), 'utf8')).toBe('existing user capture')
  })

  it('keeps simultaneous screenshots separate and never overwrites an earlier capture', async() => {
    const folder = await mkdtemp(path.join(tmpdir(), 'marktext-screenshot-test-'))
    let serial = 0
    execFile.mockImplementation((_command, args, callback) => {
      const image = `capture ${++serial}`
      return writeFile(args.at(-1), image).then(() => callback(null, '', ''), callback)
    })
    const captured = await Promise.all([captureScreenshot(folder), captureScreenshot(folder)])
    expect(new Set(captured).size).toBe(2)
    expect((await Promise.all(captured.map(file => {
      if (!file) throw new Error('Expected a screenshot')
      return readFile(file, 'utf8')
    }))).sort()).toEqual(['capture 1', 'capture 2'])
  })

  it('rejects OS failures and does not hand off a partially created image', async() => {
    const folder = await mkdtemp(path.join(tmpdir(), 'marktext-screenshot-test-'))
    const denied = new Error('Screen recording permission denied')
    execFile.mockImplementation((_command, args, callback) => {
      return writeFile(args.at(-1), 'partial').then(() => callback(denied, '', ''), callback)
    })
    await expect(captureScreenshot(folder)).rejects.toBe(denied)
  })

  it('does not hand off an empty capture', async() => {
    const folder = await mkdtemp(path.join(tmpdir(), 'marktext-screenshot-test-'))
    execFile.mockImplementation((_command, args, callback) => {
      return writeFile(args.at(-1), '').then(() => callback(null, '', ''), callback)
    })
    expect(await captureScreenshot(folder)).toBeUndefined()
  })
})
