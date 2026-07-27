export interface ProjectSearchSettings {
  readonly exclusions: readonly string[]
  readonly maxFileSize: string
  readonly includeHidden: boolean
  readonly noIgnore: boolean
}

export interface ProjectSearchAuthority {
  readonly root: string | null
  readonly settings: ProjectSearchSettings
}

export type ProjectSearchAuthorityProvider = (
  windowId: number
) => ProjectSearchAuthority

const EMPTY_SETTINGS: ProjectSearchSettings = Object.freeze({
  exclusions: Object.freeze([]),
  maxFileSize: '',
  includeHidden: false,
  noIgnore: false
})

let authorityProvider: ProjectSearchAuthorityProvider = () => ({
  root: null,
  settings: EMPTY_SETTINGS
})

export function configureProjectSearchAuthority(
  provider: ProjectSearchAuthorityProvider
): void {
  authorityProvider = provider
}

export function readProjectSearchAuthority(
  windowId: number
): ProjectSearchAuthority {
  return authorityProvider(windowId)
}
