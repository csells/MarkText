import type {
  DocumentEditorHost,
  DocumentHostOptions
} from '@/components/editorWithTabs/documentCoreDesktopEditor'

declare const host: DocumentEditorHost

host.subscribeSelection((context) => context.selectedText)
host.configure({ autoPairBrackets: true, hideLinkTools: false })
host.dismissTransientTools()

// @ts-expect-error the target host has no arbitrary command index signature
host.unknownCommand()
// @ts-expect-error event names are not an open string namespace
host.on('selection-change', () => {})
// @ts-expect-error removed settings cannot enter the target option contract
host.configure({ tabSize: 4 })

const validOptions: DocumentHostOptions = {
  element: document.createElement('div'),
  session: {} as DocumentHostOptions['session'],
  configuration: {}
}

// @ts-expect-error production desktop hosts require an attached session
const missingSession: DocumentHostOptions = {
  element: document.createElement('div'),
  configuration: {}
}

const sourceLeak: DocumentHostOptions = {
  ...validOptions,
  // @ts-expect-error renderer source cannot enter the hosted seam
  source: {} as never
}
const parseConfigurationLeak: DocumentHostOptions = {
  ...validOptions,
  // @ts-expect-error renderer parse configuration cannot enter the hosted seam
  parseConfiguration: {} as never
}
const factoryLeak: DocumentHostOptions = {
  ...validOptions,
  // @ts-expect-error factories cannot defer or replace the attached session
  sessionFactory: {} as never
}
Object.freeze([
  missingSession,
  sourceLeak,
  parseConfigurationLeak,
  factoryLeak
])
