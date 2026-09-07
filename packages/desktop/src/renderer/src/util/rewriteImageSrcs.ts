import { escapeHTML, unescapeHTML } from '@muyajs/core'
import { resolveLocalImageSrc } from './resolveImageSrc'

// Match the `src="…"` of an <img> tag in the (already sanitized, double-quoted)
// engine output, so relative image paths can be rewritten to absolute `file://`
// URLs. A string rewrite avoids re-serializing the whole article DOM (which
// holds rendered KaTeX / diagram SVG).
const IMG_SRC_REG = /(<img\b[^>]*?\ssrc=")([^"]*)(")/gi

/**
 * Rewrite relative / absolute-local `<img src>` to absolute `file://` URLs so a
 * saved styled-HTML document still resolves its images after it is moved out of
 * the source folder (legacy muyajs `correctImageSrc` parity, issue 230). Remote
 * URLs and `data:` URIs are left untouched. Idempotent: a `file://` src is left
 * as-is, so the PDF / print path (which rewrites again via printService) is a
 * no-op the second time.
 */
export const rewriteImageSrcs = (html: string): string =>
  html.replace(IMG_SRC_REG, (match, pre: string, src: string, post: string) => {
    const decoded = unescapeHTML(src)
    const resolved = resolveLocalImageSrc(decoded)
    // The document directory is filesystem data too; quotes must not become attributes.
    return resolved === decoded ? match : `${pre}${escapeHTML(resolved)}${post}`
  })
