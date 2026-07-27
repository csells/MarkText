import { describe, expect, it } from 'vitest'
import {
  createDocumentClipboardHtmlAuthority
} from 'main_renderer/ipc/documentClipboardHtmlAuthority'

const KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const OTHER_KEY = Uint8Array.from(
  { length: 32 },
  (_, index) => 255 - index
)

describe('document clipboard HTML authority', () => {
  it('publishes exact source in an authenticated hidden envelope and safe visible HTML', () => {
    const authority = createDocumentClipboardHtmlAuthority(KEY)
    const source =
      'line </pre><script>alert("x & y")</script> {++文🙂++}\n'

    const html = authority.encode(source)

    expect(html).not.toContain('<script>')
    expect(html).toContain(
      '<pre>line &lt;/pre&gt;&lt;script&gt;alert(&quot;x &amp; y&quot;)' +
      '&lt;/script&gt; {++文🙂++}\n</pre>'
    )
    expect(authority.decode(html)).toEqual({
      kind: 'authenticated',
      source
    })
  })

  it('retains parser-produced visible HTML while authenticating its exact source', () => {
    const authority = createDocumentClipboardHtmlAuthority(KEY)
    const visible = '<p><strong>Visible review</strong></p>'

    const html = authority.encode('{~~old~>new~~}', visible)

    expect(html).toContain(visible)
    expect(html).not.toContain('<pre>')
    expect(authority.decode(html)).toEqual({
      kind: 'authenticated',
      source: '{~~old~>new~~}'
    })
  })

  it('distinguishes absent malformed and foreign envelopes without exposing raw source', () => {
    const authority = createDocumentClipboardHtmlAuthority(KEY)
    const foreign = createDocumentClipboardHtmlAuthority(OTHER_KEY)
    const encoded = authority.encode('{++trusted++}')
    const markerEnd = encoded.indexOf('-->')
    const marker = encoded.slice(0, markerEnd + 3)
    const duplicate = `${marker}${encoded}`
    const tampered = encoded.replace(
      Buffer.from('{++trusted++}', 'utf8').toString('base64url'),
      Buffer.from('{++forged++}', 'utf8').toString('base64url')
    )

    expect(authority.decode('<p>external HTML</p>')).toEqual({
      kind: 'absent'
    })
    expect(authority.decode(encoded.replace('-->', ''))).toEqual({
      kind: 'invalid'
    })
    expect(authority.decode(duplicate)).toEqual({
      kind: 'invalid'
    })
    expect(authority.decode(tampered)).toEqual({
      kind: 'unauthenticated'
    })
    expect(foreign.decode(encoded)).toEqual({
      kind: 'unauthenticated'
    })
  })
})
