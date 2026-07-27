export interface SourceTextProjection {
  readonly source: string
  readonly text: string
  sourceOffsetAt(textOffset: number): number
  textOffsetAt(sourceOffset: number): number
}

const assertOffset = (
  name: string,
  offset: number,
  upperBound: number
): void => {
  if (!Number.isInteger(offset) || offset < 0 || offset > upperBound) {
    throw new RangeError(`${name} must be an integer between 0 and ${upperBound}`)
  }
}

export const createSourceTextProjection = (
  source: string
): SourceTextProjection => {
  const displayToSource: number[] = [0]
  const sourceToDisplay: number[] = new Array(source.length + 1)
  const display: string[] = []

  let sourceOffset = 0
  let textOffset = 0
  sourceToDisplay[0] = 0

  while (sourceOffset < source.length) {
    const character = source[sourceOffset]
    if (character === '\r') {
      const isCarriageReturnLineFeed = source[sourceOffset + 1] === '\n'
      sourceToDisplay[sourceOffset] = textOffset
      display.push('\n')
      textOffset += 1
      sourceOffset += 1
      if (isCarriageReturnLineFeed) {
        sourceToDisplay[sourceOffset] = textOffset
        sourceOffset += 1
      }
    } else {
      sourceToDisplay[sourceOffset] = textOffset
      display.push(character)
      sourceOffset += 1
      textOffset += 1
    }

    sourceToDisplay[sourceOffset] = textOffset
    displayToSource[textOffset] = sourceOffset
  }

  const text = display.join('')
  return Object.freeze({
    source,
    text,
    sourceOffsetAt(offset: number): number {
      assertOffset('textOffset', offset, text.length)
      return displayToSource[offset]
    },
    textOffsetAt(offset: number): number {
      assertOffset('sourceOffset', offset, source.length)
      return sourceToDisplay[offset]
    }
  })
}
