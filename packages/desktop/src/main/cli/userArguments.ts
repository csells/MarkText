/**
 * Command-line arguments meant for MarkText. A packaged app receives them after
 * its executable. `electron <app>` (Electron's default app) also passes its own
 * switches and then the application path first; neither is a document or
 * folder to open.
 */
export const userArguments = (argv: readonly string[], defaultApp: boolean): string[] => {
  if (!defaultApp) return argv.slice(1)
  const appPath = argv.findIndex((argument, index) => index > 0 && !argument.startsWith('-'))
  return appPath < 0 ? [] : argv.slice(appPath + 1)
}
