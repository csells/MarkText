import { describe, expect, it } from 'vitest'
import {
  imageAssetStorage,
  isRemoteImageReference
} from '@/services/imageAssetPolicy'

describe('image asset storage policy', () => {
  it.each([
    {
      action: 'path' as const,
      source: 'native-capability' as const,
      persisted: true,
      relative: true,
      expected: 'reference'
    },
    {
      action: 'path' as const,
      source: 'binary' as const,
      persisted: true,
      relative: true,
      expected: 'document-relative'
    },
    {
      action: 'folder' as const,
      source: 'native-capability' as const,
      persisted: true,
      relative: true,
      expected: 'document-relative'
    },
    {
      action: 'folder' as const,
      source: 'binary' as const,
      persisted: false,
      relative: true,
      expected: 'configured-folder'
    },
    {
      action: 'upload' as const,
      source: 'binary' as const,
      persisted: true,
      relative: false,
      expected: 'configured-folder'
    }
  ])('maps a closed authoring choice to $expected %#', ({
    action,
    source,
    persisted,
    relative,
    expected
  }) => {
    expect(imageAssetStorage({
      action,
      source,
      documentPersisted: persisted,
      preferDocumentRelative: relative
    })).toBe(expected)
  })

  it.each([
    ['https://example.test/cat.png', true],
    ['data:image/png;base64,AA==', true],
    ['blob:https://example.test/id', true],
    ['/Users/alice/cat.png', false],
    ['C:\\Users\\alice\\cat.png', false],
    ['../assets/cat.png', false]
  ])('classifies remote reference %s', (reference, expected) => {
    expect(isRemoteImageReference(reference)).toBe(expected)
  })
})
