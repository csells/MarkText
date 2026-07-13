import { onBeforeUnmount, onMounted } from 'vue'

/** Keep component lifecycle ownership explicit while editor.vue supplies behavior. */
export const useEditorLifecycle = (
  mount: () => void,
  unmount: () => void
): void => {
  onMounted(mount)
  onBeforeUnmount(unmount)
}
