interface ITag {
  open: string;
  close: string;
}

export const FORMAT_MARKER_MAP: Record<string, string> = {
  em: '*',
  inline_code: '`',
  strong: '**',
  del: '~~',
  inline_math: '$',
}

export const FORMAT_TAG_MAP: Record<string, ITag> = {
  u: {
    open: '<u>',
    close: '</u>',
  },
  sub: {
    open: '<sub>',
    close: '</sub>',
  },
  sup: {
    open: '<sup>',
    close: '</sup>',
  },
  mark: {
    open: '<mark>',
    close: '</mark>',
  },
}

/** Existing native format spelling, shared by standalone Muya and the model. */
export function formatDelimiters(type: string): ITag | undefined {
  if (type === 'link' || type === 'image') return { open: type === 'link' ? '[' : '![', close: ']()' }
  const marker = FORMAT_MARKER_MAP[type]
  return marker === undefined ? FORMAT_TAG_MAP[type] : { open: marker, close: marker }
}

export type HeadingChange =
  | { readonly type: 'toggle' | 'set' | 'quick-insert'; readonly level: number }
  | { readonly type: 'upgrade' | 'degrade' | 'paragraph' }
