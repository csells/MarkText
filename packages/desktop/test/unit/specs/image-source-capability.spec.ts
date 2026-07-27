import { describe, expect, it } from 'vitest'
import {
  createImageSourceCapabilityAuthority
} from 'main_renderer/imageAssets/imageSourceCapability'

describe('main-owned image source capabilities', () => {
  it('is sender-bound and consumable exactly once', () => {
    const authority = createImageSourceCapabilityAuthority(
      () => 'image-capability:one'
    )
    const receipt = authority.mint(7, '/native/picker/cat.png')

    expect(receipt).toEqual({
      schema: 'image-source-capability-1',
      token: 'image-capability:one'
    })
    expect(() => authority.consume(8, receipt.token)).toThrow(/sender|owner/i)
    expect(authority.consume(7, receipt.token)).toEqual({
      pathname: '/native/picker/cat.png'
    })
    expect(() => authority.consume(7, receipt.token)).toThrow(/unknown|consumed/i)
  })

  it('revokes every outstanding capability when its sender is destroyed', () => {
    const authority = createImageSourceCapabilityAuthority(
      () => 'image-capability:two'
    )
    const receipt = authority.mint(7, '/native/picker/cat.png')
    authority.revokeSender(7)

    expect(() => authority.consume(7, receipt.token)).toThrow(/unknown|consumed/i)
  })
})
