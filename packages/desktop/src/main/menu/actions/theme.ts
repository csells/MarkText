import { emitInternalChannel } from '../../utils/internalIpc'

export const selectTheme = (theme: string): void => {
  emitInternalChannel('set-user-preference', { theme })
}

export const setFollowSystemTheme = (followSystemTheme: boolean): void => {
  emitInternalChannel('set-user-preference', { followSystemTheme })
}
