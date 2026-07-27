import { describe, expect, it } from 'vitest'
import {
  createUploaderDeletionClipboardAuthority
} from 'main_renderer/uploader/uploaderDeletionClipboardAuthority'

describe('uploader deletion clipboard authority', () => {
  it('retains the deletion URL in main behind a sender-bound one-use token', () => {
    let tokenSequence = 0
    const authority = createUploaderDeletionClipboardAuthority({
      createToken: () => `token:${++tokenSequence}`,
      now: () => 1_000
    })

    const capability = authority.mint(
      41,
      'https://images.example/delete/secret'
    )

    expect(capability).toEqual({
      schema: 'uploader-deletion-clipboard-capability-1',
      token: 'token:1'
    })
    expect(() => authority.consume(99, capability.token))
      .toThrow(/sender|owner/i)
    expect(authority.consume(41, capability.token))
      .toBe('https://images.example/delete/secret')
    expect(() => authority.consume(41, capability.token))
      .toThrow(/unknown|expired|used/i)
  })

  it('expires retained URLs and revokes every token for a destroyed sender', () => {
    let now = 2_000
    let tokenSequence = 0
    const authority = createUploaderDeletionClipboardAuthority({
      createToken: () => `token:${++tokenSequence}`,
      now: () => now,
      lifetimeMs: 500
    })

    const expired = authority.mint(7, 'https://images.example/delete/old')
    now += 501
    expect(() => authority.consume(7, expired.token)).toThrow(/expired/i)

    const first = authority.mint(7, 'https://images.example/delete/first')
    const second = authority.mint(7, 'https://images.example/delete/second')
    authority.revokeSender(7)
    expect(() => authority.consume(7, first.token)).toThrow(/unknown|used/i)
    expect(() => authority.consume(7, second.token)).toThrow(/unknown|used/i)
  })

  it('rejects non-HTTP deletion material before retaining it', () => {
    const authority = createUploaderDeletionClipboardAuthority({
      createToken: () => 'token:never'
    })

    expect(() => authority.mint(5, 'file:///tmp/delete-secret'))
      .toThrow(/url|http/i)
    expect(() => authority.mint(5, 'https://user:pass@example.test/delete'))
      .toThrow(/url|credential/i)
  })
})
