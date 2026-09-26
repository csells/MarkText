/** Shared command names and applicability; document operations remain Core-owned. */
export const reviewCommands = [
  { id: 'show', label: 'sidebarTitle' },
  { id: 'add-comment', label: 'addComment' },
  { id: 'mark-highlight', label: 'markHighlight' },
  { id: 'mark-addition', label: 'markAddition' },
  { id: 'suggest-replacement', label: 'suggestReplacement' },
  { id: 'track-changes', label: 'trackChanges' },
  { id: 'previous', label: 'previous' },
  { id: 'next', label: 'next' },
  { id: 'edit-comment', label: 'editComment' },
  { id: 'accept', label: 'accept' },
  { id: 'reject', label: 'reject' },
  { id: 'remove', label: 'removeAnnotation' },
  { id: 'accept-all', label: 'acceptAll' },
  { id: 'reject-all', label: 'rejectAll' },
  { id: 'markup', label: 'markup' },
  { id: 'original', label: 'original' },
  { id: 'revised', label: 'revised' }
] as const
export type ReviewCommand = typeof reviewCommands[number]['id']
export interface ReviewCommandState {
  available: boolean
  editable: boolean
  canAuthor: boolean
  canTrack: boolean
  tracking: boolean
  hasItem: boolean
  /** The current item is under the caret or selection, or was chosen and revealed. */
  targeted: boolean
  hasComment: boolean
  removable: boolean
  busy: boolean
  mode: 'markup' | 'original' | 'revised'
}
export const reviewCommandEnabled = (id: ReviewCommand, state?: ReviewCommandState): boolean => {
  if (id === 'show') return true
  if (!state?.available || state.busy) return false
  if (id === 'markup' || id === 'original' || id === 'revised') return true
  if (id === 'previous' || id === 'next') return state.hasItem
  if (id === 'add-comment' || id === 'mark-highlight' || id === 'mark-addition' || id === 'suggest-replacement') return state.editable && state.canAuthor
  if (id === 'track-changes') return state.editable && state.canTrack
  // Resolution changes source, so it needs the editable Markup view; per-item
  // resolution also needs a visible target.
  if (!state.editable) return false
  if (id === 'edit-comment') return state.hasComment && state.targeted
  if (id === 'remove') return state.removable && state.targeted
  if (id === 'accept' || id === 'reject') return state.hasItem && state.targeted && !state.removable
  return state.hasItem
}

export type ReviewContextCommand = 'accept' | 'reject' | 'remove' | 'edit-comment'
export interface ReviewContextRequest { requestId: number; x: number; y: number }
export interface ReviewContextReply { requestId: number; commands?: ReviewContextCommand[]; error?: string }
export interface ReviewContextAction { requestId: number; command: ReviewContextCommand }
