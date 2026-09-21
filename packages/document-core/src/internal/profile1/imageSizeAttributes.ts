const semanticKeys = { width: 'semanticWidth', height: 'semanticHeight', 'data-align': 'semanticAlign' } as const
export type ImageSizeProperty = keyof typeof semanticKeys
export type ImageSizeOmission = Readonly<{ start: number; end: number }>

export function isImageSizeValue(name: ImageSizeProperty, value: string): boolean {
  return name === 'data-align'
    ? /^(?:inline|left|center|right)$/.test(value)
    : /^(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(value) && Number.isFinite(Number(value.replace(/%$/, ''))) && Number(value.replace(/%$/, '')) > 0
}

/** Profile 2 admits only immediate, single-line image layout fields. */
export function imageSizeAttributes(source: string, start: number, limit: number, omissions: readonly ImageSizeOmission[] = []): Readonly<Record<string, string | number | boolean>> {
  if (source[start] !== '{') return {}
  const attributes: Record<string, string | number | boolean> = {}
  let offset = start + 1
  let count = 0
  while (offset < limit) {
    while (offset < limit && (source[offset] === ' ' || source[offset] === '\t')) offset++
    if (offset >= limit) return {}
    if (source[offset] === '}' && count > 0) return { ...attributes, sizeStart: start, sizeEnd: offset + 1 }
    const attributeStart = offset
    while (offset < limit && /[a-z-]/.test(source[offset]!)) offset++
    const name = source.slice(attributeStart, offset)
    if (!Object.hasOwn(semanticKeys, name) || source[offset] !== '=' || Object.hasOwn(attributes, `${name}AttributeStart`)) return {}
    const valueStart = ++offset
    while (offset < limit && !/[ \t\r\n}]/.test(source[offset]!)) offset++
    const value = imageSizeValue(source, valueStart, offset, omissions)
    const key = name as ImageSizeProperty
    if (!isImageSizeValue(key, value.text === '' ? source.slice(valueStart, offset) : value.text)) return {}
    attributes[semanticKeys[key]] = value.text
    attributes[`${name}AttributeStart`] = attributeStart
    attributes[`${name}AttributeEnd`] = offset
    attributes[`${name}ValueStart`] = value.start
    attributes[`${name}ValueEnd`] = value.end
    count++
  }
  return {}
}

function imageSizeValue(source: string, start: number, end: number, omissions: readonly ImageSizeOmission[]): { text: string; start: number; end: number } {
  let low = 0
  let high = omissions.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (omissions[middle]!.end <= start) low = middle + 1
    else high = middle
  }
  let cursor = start
  let first: number | undefined
  let last = start
  let text = ''
  const append = (to: number): void => {
    if (cursor >= to) return
    first ??= cursor
    last = to
    text += source.slice(cursor, to)
  }
  for (let index = low; index < omissions.length; index++) {
    const omission = omissions[index]!
    if (omission.start >= end) break
    append(Math.min(end, omission.start))
    cursor = Math.max(cursor, omission.end)
  }
  append(end)
  return { text, start: first ?? end, end: first === undefined ? end : last }
}
