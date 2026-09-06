import { execFile } from 'node:child_process'
import { mkdtemp, stat } from 'node:fs/promises'
import path from 'node:path'

/** Own each capture's destination; cancellation cannot reuse a clipboard image. */
export async function captureScreenshot(folder: string): Promise<string | undefined> {
  const directory = await mkdtemp(path.join(folder, 'capture-'))
  const destination = path.join(directory, 'screenshot.png')
  await new Promise<void>((resolve, reject) => {
    execFile('/usr/sbin/screencapture', ['-i', '-t', 'png', destination], (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  try {
    const image = await stat(destination)
    return image.isFile() && image.size > 0 ? destination : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
