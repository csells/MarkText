<template>
  <div class="pref-markdown">
    <h4>{{ t('preferences.markdown.title') }}</h4>
    <compound>
      <template #head>
        <h6 class="title">
          {{ t('preferences.markdown.extensions.title') }}
        </h6>
      </template>
      <template #children>
        <bool
          :description="t('preferences.markdown.extensions.subscriptAndSuperscript')"
          :bool="subscriptAndSuperscript"
          :on-change="(value) => onSelectChange('subscriptAndSuperscript', value)"
        />
        <bool
          :description="t('preferences.markdown.extensions.footnotes')"
          :bool="footnotes"
          :on-change="(value) => onSelectChange('footnotes', value)"
        />
        <bool
          :description="t('preferences.markdown.extensions.gitLabMath')"
          :bool="gitLabMath"
          :on-change="(value) => onSelectChange('gitLabMath', value)"
        />
      </template>
    </compound>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'
import type { PreferencesState } from '@/store/preferences'
import Bool from '../common/bool/index.vue'
import Compound from '../common/compound/index.vue'

const { t } = useI18n()
const preferenceStore = usePreferencesStore()
const {
  subscriptAndSuperscript,
  footnotes,
  gitLabMath
} = storeToRefs(preferenceStore)

const onSelectChange = (type: keyof PreferencesState, value: boolean): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}
</script>

<script lang="ts">
export default {
  name: 'Markdown'
}
</script>

<style scoped>
.pref-markdown {
}
</style>
