/**
 * Live-region semantics for the per-tab notification banner.
 *
 * Warn and crit banners report a failed or destructive action — for example a
 * fail-closed Track Changes rejection — which the WAI-ARIA authoring
 * practices present as an assertive alert. Informational banners stay polite
 * status updates. The banner only announces; it must never receive or move
 * focus, so these semantics are the banner's entire assistive-tech surface.
 */
export interface NotificationLiveRegion {
  role: 'alert' | 'status'
  politeness: 'assertive' | 'polite'
}

const ASSERTIVE_STYLES = new Set(['warn', 'crit'])

export function notificationLiveRegion(style?: string): NotificationLiveRegion {
  return ASSERTIVE_STYLES.has(style ?? '')
    ? { role: 'alert', politeness: 'assertive' }
    : { role: 'status', politeness: 'polite' }
}
