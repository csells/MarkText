import { resolveLocalImageSrc } from '../util/resolveImageSrc'

export interface PrintPreparation {
  isCurrent(): boolean
  clearup(): void
}

class MarkdownPrint {
  private container: HTMLElement | null = null

  /**
   * Prepare document export and append a hidden print container to the window.
   * Everything outside of this hidden print container will be hidden with display: none.
   *
   * @param html HTML string
   * @param renderStatic Render for static files like PDF documents
   * @param dir Text direction to mirror onto the container. `innerHTML` drops
   *   the exporter's outer `<html dir=…>` shell and the container is a sibling
   *   of `.editor-wrapper`, so RTL documents print LTR unless we set it here
   *   (#4833). LTR is the default and stays implicit.
   */
  async renderMarkdown(
    html: string,
    renderStatic?: boolean,
    dir?: string
  ): Promise<PrintPreparation> {
    this.clearup()
    const printContainer = document.createElement('article')
    printContainer.classList.add('print-container')
    if (dir === 'rtl' || dir === 'auto') {
      printContainer.setAttribute('dir', dir)
    }
    this.container = printContainer
    const preparation: PrintPreparation = {
      isCurrent: () => this.container === printContainer && printContainer.isConnected,
      clearup: () => {
        printContainer.remove()
        if (this.container === printContainer) this.container = null
      }
    }
    printContainer.innerHTML = html

    // Fix images when rendering for static files like PDF (GH#678).
    if (renderStatic) {
      // Traverse through the DOM tree and fix all relative image sources.
      const images = printContainer.getElementsByTagName('img')
      for (const image of Array.from(images)) {
        const rawSrc = image.getAttribute('src') ?? ''
        image.src = resolveLocalImageSrc(rawSrc)
      }
    }

    document.body.appendChild(printContainer)

    // The print surface is display:none until native printing begins. Its fonts
    // therefore need explicit loading: fonts.ready alone may resolve before
    // they are requested, leaving font-display:block glyphs blank in the PDF.
    // Load only faces used by this document, including their actual characters
    // so unicode-range fonts are selected correctly.
    try {
      if (document.fonts) {
        const textByFont = new Map<string, string>()
        for (const element of printContainer.querySelectorAll('*')) {
          if (element.matches('style, script, template')) continue
          const text = [...element.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join('')
          if (text.trim().length === 0) continue
          const font = getComputedStyle(element).font
          if (font) textByFont.set(font, (textByFont.get(font) ?? '') + text)
        }
        await Promise.all([...textByFont].map(([font, text]) => document.fonts.load(font, text)))
      }
    } catch (error) {
      const current = preparation.isCurrent()
      preparation.clearup()
      if (current) throw error
    }
    return preparation
  }

  /**
   * Remove the print container from the window.
   */
  clearup(): void {
    if (this.container) {
      this.container.remove()
      this.container = null
    }
  }
}

export default MarkdownPrint
