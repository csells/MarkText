export type ListKind = 'bullet' | 'ordered' | 'task'

export type ListChange =
  | { readonly type: 'toggle' | 'front', readonly kind: ListKind }
  | { readonly type: 'reset' }
  | { readonly type: 'backspace' }
  | { readonly type: 'toggle-tight' }

export interface ListMarkerOptions {
  readonly bulletListMarker: string
  readonly orderListDelimiter: string
}

/** The existing native list serializer's marker and continuation width. */
export function listItemMarker(options: { bullet?: string | undefined, ordinal?: number | undefined, delimiter?: string | undefined, checked?: boolean | undefined, dfm?: boolean | undefined }): { text: string, indentation: number } {
  let marker: string
  if (options.bullet) marker = `${options.bullet} `
  else if (options.ordinal !== undefined) {
    const ordinal = options.dfm && options.ordinal > 99 || options.ordinal > 999999999 ? 1 : options.ordinal
    marker = `${ordinal}${options.delimiter || '.'} `
  } else marker = '- '
  return { text: marker + (options.checked === undefined ? '' : options.checked ? '[x] ' : '[ ] '), indentation: marker.length }
}

/** Native paragraph Tab eligibility, independent of the document representation. */
export function listTabAction(context: { shift: boolean, collapsed: boolean, paragraphInItem: boolean, previousItem: boolean, nestedList: boolean, previousBlock: boolean }): 'none' | 'insert' | 'indent' | 'outdent' | 'promote-paragraph' {
  if (!context.collapsed) return 'none'
  if (context.shift) return context.nestedList ? context.previousBlock ? 'outdent' : 'promote-paragraph' : 'none'
  return context.paragraphInItem && context.previousItem ? 'indent' : 'insert'
}
