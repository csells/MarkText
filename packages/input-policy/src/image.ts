/** Explicit image fields shared by native commands and the document model. */
export type ImagePropertyPatch = Readonly<Partial<Record<'alt' | 'src' | 'title' | 'width' | 'height' | 'data-align', string>>>

// Native image source classification is shared by controls and source planning.
export const IMAGE_URL_REG = /^http(s)?:\/\/([\w\-.~]+\.[a-z]{2,}|[0-9.]+|localhost|\[[a-f0-9.:]+\])(:\d{1,5})?\/\S+/i
export const IMAGE_DATA_URL_REG = /^data:image\/[\w+-]+(?:;[\w-]+=[\w-]+|;base64)*,[a-zA-Z0-9+/]+={0,2}$/

export function encodeImageInsertionSrc(src: string): string {
  if (IMAGE_URL_REG.test(src)) {
    // Preserve already escaped URL bytes while encoding newly authored spaces.
    return encodeURI(src).replace(/%25(?=[\da-f]{2})/gi, '%')
  }
  return IMAGE_DATA_URL_REG.test(src) ? src : encodeImageSrc(src)
}

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
