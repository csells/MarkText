/** Explicit image fields shared by native commands and the document model. */
export type ImagePropertyPatch = Readonly<Partial<Record<'alt' | 'src' | 'title' | 'width' | 'height' | 'data-align', string>>>

// Percent-encode the chars that break a markdown image destination — an
// unbalanced `)` truncates the path (#3060). `encodeURIComponent` leaves `(`/`)`
// untouched, so encode them explicitly.
export function encodeImageSrc(src: string): string {
  return src
    .replace(/ /g, encodeURI(' '))
    .replace(/#/g, encodeURIComponent('#'))
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}
