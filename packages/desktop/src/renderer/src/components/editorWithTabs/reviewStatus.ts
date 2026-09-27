import { reactive } from 'vue'
import type { ReviewCommandState } from 'common/commands/review'

/** Review state of the active document for window chrome outside the editor. */
export const reviewStatus = reactive<{ tracking: boolean; commands?: ReviewCommandState }>({
  tracking: false
})
