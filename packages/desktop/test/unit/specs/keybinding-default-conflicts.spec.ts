import { describe, expect, it } from 'vitest'
import { isEqualAccelerator } from 'common/keybinding'
import keybindingsDarwin from 'main_renderer/keyboard/keybindingsDarwin'
import keybindingsLinux from 'main_renderer/keyboard/keybindingsLinux'
import keybindingsWindows from 'main_renderer/keyboard/keybindingsWindows'

// Two commands sharing a default accelerator means only one of them ever runs;
// on macOS ⌘⌥A once reached both Edit → Screenshot and Review → Accept.
// `isEqualAccelerator` treats Option and Alt, and Command and Cmd, as one key.
const conflicts = (bindings: Map<string, string>): string[][] => {
  const entries = [...bindings].filter(([, accelerator]) => accelerator !== '')
  const found: string[][] = []
  entries.forEach(([id, accelerator], index) => {
    for (const [otherId, other] of entries.slice(index + 1)) {
      if (isEqualAccelerator(accelerator, other)) found.push([id, otherId, accelerator, other])
    }
  })
  return found
}

// Upstream MarkText ships Ctrl+P for both Print and Quick Open on Windows; this
// branch preserves upstream's bindings outside Review.
const upstreamConflicts: Record<string, string[][]> = {
  Windows: [['file.print', 'file.quick-open', 'Ctrl+P', 'Ctrl+P']]
}

describe('default keybindings', () => {
  it.each([
    ['macOS', keybindingsDarwin],
    ['Linux', keybindingsLinux],
    ['Windows', keybindingsWindows]
  ])('give each %s accelerator to one command', (platform, bindings) => {
    expect(conflicts(bindings)).toEqual(upstreamConflicts[platform] ?? [])
  })

  it('treats Option and Alt as the same key', () => {
    expect(
      conflicts(
        new Map([
          ['edit.screenshot', 'Command+Option+A'],
          ['review.accept', 'Cmd+Alt+A']
        ])
      )
    ).toHaveLength(1)
  })

  it('leaves Accept and Reject without a default shortcut, as Google Docs does', () => {
    expect(keybindingsDarwin.get('review.accept')).toBe('')
    expect(keybindingsDarwin.get('review.reject')).toBe('')
  })
})
