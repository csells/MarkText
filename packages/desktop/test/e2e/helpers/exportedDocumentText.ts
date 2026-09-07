/** Extract document content for export assertions without treating generated CSS as prose. */
export const exportedDocumentText = (html: string): string => {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll('style, script, template').forEach((node) => node.remove())
  return document.body.textContent ?? ''
}
