// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { bootBoundMuya } from '../helpers/boundMuyaDocument'

// Typing a suggestion by hand with bracket and Markdown pairing on completes
// its closer one key early: `{` pairs a `}`, so the last marker character
// before it closes the suggestion while the caret sits inside the now hidden
// closer. The typed `}` steps over the paired one, as it does before a visible
// `}`, so the source holds exactly what was typed.
const forms = [
  {
    typed: '{++crit++}',
    untracked: ['Start {++crit++}\n', 'Start {++crit++}x\n'],
    tracked: ['Start{~~~> {++crit++}~~}\n', 'Start{~~~> {++critx++}~~}\n']
  },
  {
    typed: '{--gone--}',
    untracked: ['Start {--gone--}\n', 'Start {--gone--}x\n'],
    tracked: ['Start{++ {--gone--}++}\n', 'Start{++ {--gone--}x++}\n']
  },
  {
    typed: '{==mark==}',
    untracked: ['Start {==mark==}\n', 'Start {==mark==}x\n'],
    tracked: ['Start{++ {==mark==}++}\n', 'Start{++ {==mark==}x++}\n']
  },
  {
    typed: '{>>note<<}',
    untracked: ['Start {>>note<<}\n', 'Start {>>note<<}x\n'],
    tracked: ['Start{++ {>>note<<}++}\n', 'Start{++ {>>note<<}x++}\n']
  },
  {
    typed: '{~~old~>new~~}',
    untracked: ['Start {~~old~>new~~}\n', 'Start {~~old~>new~~}x\n'],
    tracked: ['Start{++ {~~old~>new~~}++}\n', 'Start{++ {~~old~>newx~~}++}\n']
  }
]

for (const tracked of [false, true]) {
  for (const form of forms) {
    it(`types ${form.typed} key by key with pairing on (tracked=${tracked})`, async() => {
      const app = bootBoundMuya('Start\n')
      try {
        app.muya.setOptions({ autoPairBracket: true, autoPairMarkdownSyntax: true })
        app.track(tracked)
        const leaf = app.muya.editor.scrollPage!.firstContentInDescendant()!
        leaf.setCursor(5, 5, true)
        app.muya.flush()
        const typeKeys = async(keys: string): Promise<string> => {
          for (const key of keys) {
            const target = app.muya.editor.selection.getSelection()?.anchor.block.domNode
            if (!target?.isConnected) throw new Error('Expected live selection')
            target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: key, bubbles: true, cancelable: true }))
            app.muya.flush()
            await app.adapter.settled()
            expect(app.adapter.state().status, key).toBe('ready')
          }
          const reply = app.binding.sourceAtBarrier()
          if (reply.type !== 'source') throw new Error('Expected source')
          return reply.source
        }
        const [suggested, continued] = tracked ? form.tracked : form.untracked
        // Tracked, the typed suggestion is the author's own draft: an
        // Addition, or a Substitution of nothing where an Addition's closer
        // would read a typed `{++` as its own.
        expect(await typeKeys(` ${form.typed}`)).toBe(suggested)
        // Untracked, typing continues after the suggestion; tracked, it
        // extends the suggestion it follows, as in Google Docs.
        expect(await typeKeys('x')).toBe(continued)
      } finally {
        app.dispose()
      }
    })
  }
}
