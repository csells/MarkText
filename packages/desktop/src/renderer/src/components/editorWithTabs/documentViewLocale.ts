import {
  de,
  en,
  es,
  fr,
  ja,
  ko,
  pt,
  tr,
  zhCN,
  zhTW,
  type ILocale
} from '@marktext/document-view'

const DOCUMENT_VIEW_LOCALES: Readonly<Record<string, ILocale>> = Object.freeze({
  en,
  de,
  es,
  fr,
  ja,
  ko,
  pt,
  tr,
  'zh-CN': zhCN,
  'zh-TW': zhTW
})

export const bindDesktopReviewLocale = (
  language: string,
  commentLabel: string
): ILocale => {
  const locale = DOCUMENT_VIEW_LOCALES[language] ?? en
  return Object.freeze({
    ...locale,
    resource: Object.freeze({
      ...locale.resource,
      Comment: commentLabel
    })
  })
}

export interface DesktopDocumentViewLocaleBinding {
  readonly language: string
  readonly ensureDesktopLocale: (language: string) => Promise<void>
  readonly translate: (key: string) => string
  readonly setLocale: (locale: ILocale) => void
}

export const applyDesktopDocumentViewLocale = async({
  language,
  ensureDesktopLocale,
  translate,
  setLocale
}: DesktopDocumentViewLocaleBinding): Promise<void> => {
  await ensureDesktopLocale(language)
  setLocale(bindDesktopReviewLocale(
    language,
    translate('sideBar.review.types.comment')
  ))
}
