<template>
  <div class="print-settings-dialog">
    <el-dialog
      v-model="showExportSettingsDialog"
      :show-close="false"
      :modal="true"
      custom-class="ag-dialog-table"
      width="500px"
    >
      <h3>{{ t('exportSettings.title') }}</h3>
      <el-tabs v-model="activeName">
        <el-tab-pane
          :label="t('exportSettings.info.label')"
          name="info"
        >
          <span class="text">{{ t('exportSettings.info.description') }}</span>
        </el-tab-pane>
        <el-tab-pane
          :label="t('exportSettings.page.label')"
          name="page"
        >
          <!-- HTML -->
          <div v-if="!isPrintable">
            <text-box
              :description="t('exportSettings.page.pageTitle')"
              :input="htmlTitle"
              :emit-time="0"
              :on-change="(value: unknown) => onSelectChange('htmlTitle', value)"
            />
          </div>

          <!-- PDF/Print -->
          <div v-if="isPrintable">
            <div v-if="exportType === 'pdf'">
              <cur-select
                class="page-size-select"
                :description="t('exportSettings.page.pageSize')"
                :value="pageSize"
                :options="pageSizeList"
                :on-change="(value: unknown) => onSelectChange('pageSize', value)"
              />
              <div
                v-if="pageSize === 'custom'"
                class="row"
              >
                <div>{{ t('exportSettings.page.widthHeight') }}</div>
                <el-input-number
                  v-model="pageSizeWidth"
                  size="mini"
                  controls-position="right"
                  :min="100"
                />
                <el-input-number
                  v-model="pageSizeHeight"
                  size="mini"
                  controls-position="right"
                  :min="100"
                />
              </div>

              <bool
                :description="t('exportSettings.page.landscapeOrientation')"
                :bool="isLandscape"
                :on-change="(value: unknown) => onSelectChange('isLandscape', value)"
              />
            </div>

            <div class="row">
              <div class="description">
                {{ t('exportSettings.page.pageMargin') }}
              </div>
              <div>
                <div class="label">
                  {{ t('exportSettings.page.topBottom') }}
                </div>
                <el-input-number
                  v-model="pageMarginTop"
                  size="mini"
                  controls-position="right"
                  :min="0"
                  :max="100"
                />
                <el-input-number
                  v-model="pageMarginBottom"
                  size="mini"
                  controls-position="right"
                  :min="0"
                  :max="100"
                />
              </div>
              <div>
                <div class="label">
                  {{ t('exportSettings.page.leftRight') }}
                </div>
                <el-input-number
                  v-model="pageMarginLeft"
                  size="mini"
                  controls-position="right"
                  :min="0"
                  :max="100"
                />
                <el-input-number
                  v-model="pageMarginRight"
                  size="mini"
                  controls-position="right"
                  :min="0"
                  :max="100"
                />
              </div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane
          :label="t('exportSettings.style.label')"
          name="style"
        >
          <bool
            :description="t('exportSettings.style.overwriteThemeFont')"
            :bool="fontSettingsOverwrite"
            :on-change="(value: unknown) => onSelectChange('fontSettingsOverwrite', value)"
          />
          <div v-if="fontSettingsOverwrite">
            <font-text-box
              :description="t('exportSettings.style.fontFamily')"
              :value="fontFamily"
              :on-change="(value: unknown) => onSelectChange('fontFamily', value)"
            />
            <range
              :description="t('exportSettings.style.fontSize')"
              :value="fontSize"
              :min="8"
              :max="32"
              unit="px"
              :step="1"
              :on-change="(value: unknown) => onSelectChange('fontSize', value)"
            />
            <range
              :description="t('exportSettings.style.lineHeight')"
              :value="lineHeight"
              :min="1.0"
              :max="2.0"
              :step="0.1"
              :on-change="(value: unknown) => onSelectChange('lineHeight', value)"
            />
          </div>
          <bool
            :description="t('exportSettings.autoNumberingHeadings')"
            :bool="autoNumberingHeadings"
            :on-change="(value: unknown) => onSelectChange('autoNumberingHeadings', value)"
          />
          <bool
            :description="t('exportSettings.showFrontMatter')"
            :bool="showFrontMatter"
            :on-change="(value: unknown) => onSelectChange('showFrontMatter', value)"
          />
        </el-tab-pane>
        <el-tab-pane
          :label="t('exportSettings.theme.label')"
          name="theme"
        >
          <div class="text">
            {{ t('exportSettings.theme.description') }}
          </div>
          <cur-select
            :description="t('exportSettings.theme.theme')"
            more="documentation-export-themes"
            :value="theme"
            :options="themeList"
            :on-change="(value: unknown) => onSelectChange('theme', value)"
          />
        </el-tab-pane>
        <el-tab-pane
          v-if="isPrintable"
          :label="t('exportSettings.headerFooter.label')"
          name="header"
        >
          <div class="text">
            {{ t('exportSettings.headerFooter.description') }}
          </div>
          <cur-select
            :description="t('exportSettings.headerFooter.headerType')"
            :value="headerType"
            :options="headerFooterTypes"
            :on-change="(value: unknown) => onSelectChange('headerType', value)"
          />
          <text-box
            v-if="headerType === 2"
            :description="t('exportSettings.headerFooter.leftHeaderText')"
            :input="headerTextLeft"
            :emit-time="0"
            :on-change="(value: unknown) => onSelectChange('headerTextLeft', value)"
          />
          <text-box
            v-if="headerType !== 0"
            :description="t('exportSettings.headerFooter.mainHeaderText')"
            :input="headerTextCenter"
            :emit-time="0"
            :on-change="(value: unknown) => onSelectChange('headerTextCenter', value)"
          />
          <text-box
            v-if="headerType === 2"
            :description="t('exportSettings.headerFooter.rightHeaderText')"
            :input="headerTextRight"
            :emit-time="0"
            :on-change="(value: unknown) => onSelectChange('headerTextRight', value)"
          />

          <cur-select
            :description="t('exportSettings.headerFooter.footerType')"
            :value="footerType"
            :options="headerFooterTypes"
            :on-change="(value: unknown) => onSelectChange('footerType', value)"
          />
          <text-box
            v-if="footerType === 2"
            :description="t('exportSettings.headerFooter.leftFooterText')"
            :input="footerTextLeft"
            :emit-time="0"
            :on-change="(value: unknown) => onSelectChange('footerTextLeft', value)"
          />
          <text-box
            v-if="footerType !== 0"
            :description="t('exportSettings.headerFooter.mainFooterText')"
            :input="footerTextCenter"
            :emit-time="0"
            :on-change="(value: unknown) => onSelectChange('footerTextCenter', value)"
          />
          <text-box
            v-if="footerType === 2"
            :description="t('exportSettings.headerFooter.rightFooterText')"
            :input="footerTextRight"
            :emit-time="0"
            :on-change="(value: unknown) => onSelectChange('footerTextRight', value)"
          />

          <bool
            :description="t('exportSettings.headerFooter.customizeStyle')"
            :bool="headerFooterCustomize"
            :on-change="(value: unknown) => onSelectChange('headerFooterCustomize', value)"
          />

          <div v-if="headerFooterCustomize">
            <bool
              :description="t('exportSettings.headerFooter.allowStyled')"
              :bool="headerFooterStyled"
              :on-change="(value: unknown) => onSelectChange('headerFooterStyled', value)"
            />
            <range
              :description="t('exportSettings.headerFooter.fontSize')"
              :value="headerFooterFontSize"
              :min="8"
              :max="20"
              unit="px"
              :step="1"
              :on-change="(value: unknown) => onSelectChange('headerFooterFontSize', value)"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane
          :label="t('exportSettings.toc.label')"
          name="toc"
        >
          <bool
            :description="t('exportSettings.toc.includeTopHeading')"
            :detailed-description="t('exportSettings.toc.includeTopHeadingDetail')"
            :bool="tocIncludeTopHeading"
            :on-change="(value: unknown) => onSelectChange('tocIncludeTopHeading', value)"
          />
          <text-box
            :description="t('exportSettings.toc.title')"
            :input="tocTitle"
            :emit-time="0"
            :on-change="(value: unknown) => onSelectChange('tocTitle', value)"
          />
        </el-tab-pane>
      </el-tabs>
      <div class="button-controlls">
        <button
          class="button-primary"
          @click="handleClicked"
        >
          {{ t('exportSettings.export') }}
        </button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, type Ref } from 'vue'
import bus from '../../bus'
import { loadExportSettings, saveExportSettings } from './persistence'
import Bool from '@/prefComponents/common/bool/index.vue'
import CurSelect from '@/prefComponents/common/select/index.vue'
import FontTextBox from '@/prefComponents/common/fontTextBox/index.vue'
import Range from '@/prefComponents/common/range/index.vue'
import TextBox from '@/prefComponents/common/textBox/index.vue'
import { getPageSizeList, getHeaderFooterTypes, getExportThemeList } from './exportOptions'
import { useI18n } from 'vue-i18n'
import type {
  DocumentCoreExportHeaderFooter,
  DocumentCoreExportOptions,
  DocumentCoreExportPageSize,
  DocumentCoreExportThemeDescriptor
} from '@shared/types/documentCore'

type NamedExportPageSize = Extract<
  DocumentCoreExportPageSize,
  { readonly kind: 'named' }
>['name']

const { t } = useI18n()

const exportType = ref('')
const themesLoaded = ref(false)
const customThemes = ref<readonly DocumentCoreExportThemeDescriptor[]>([])
const isPrintable = ref(true)
const showExportSettingsDialog = ref(false)
const activeName = ref('info')
const htmlTitle = ref('')
const pageSize = ref('A4')
const pageSizeWidth = ref(210)
const pageSizeHeight = ref(297)
const isLandscape = ref(false)
const pageMarginTop = ref(20)
const pageMarginRight = ref(15)
const pageMarginBottom = ref(20)
const pageMarginLeft = ref(15)
const fontSettingsOverwrite = ref(false)
const fontFamily = ref('Default')
const fontSize = ref(14)
const lineHeight = ref(1.5)
const autoNumberingHeadings = ref(false)
const showFrontMatter = ref(false)
const theme = ref('default')
const themeList = ref(getExportThemeList())
const pageSizeList = ref(getPageSizeList())
const headerFooterTypes = ref(getHeaderFooterTypes())
const headerType = ref(0)
const headerTextLeft = ref('')
const headerTextCenter = ref('')
const headerTextRight = ref('')
const footerType = ref(0)
const footerTextLeft = ref('')
const footerTextCenter = ref('')
const footerTextRight = ref('')
const headerFooterCustomize = ref(false)
const headerFooterStyled = ref(true)
const headerFooterFontSize = ref(12)
const tocTitle = ref('')
const tocIncludeTopHeading = ref(true)

// #2287 — persist the chosen export options across sessions. Every option ref
// is registered here; changes are saved to localStorage and restored on mount.
const persistableSettings: Record<string, Ref<unknown>> = {
  htmlTitle,
  pageSize,
  pageSizeWidth,
  pageSizeHeight,
  isLandscape,
  pageMarginTop,
  pageMarginRight,
  pageMarginBottom,
  pageMarginLeft,
  fontSettingsOverwrite,
  fontFamily,
  fontSize,
  lineHeight,
  autoNumberingHeadings,
  showFrontMatter,
  theme,
  headerType,
  headerTextLeft,
  headerTextCenter,
  headerTextRight,
  footerType,
  footerTextLeft,
  footerTextCenter,
  footerTextRight,
  headerFooterCustomize,
  headerFooterStyled,
  headerFooterFontSize,
  tocTitle,
  tocIncludeTopHeading
}

const restoreExportSettings = () => {
  const saved = loadExportSettings()
  for (const [key, settingRef] of Object.entries(persistableSettings)) {
    if (key in saved) settingRef.value = saved[key]
  }
}

watch(Object.values(persistableSettings), () => {
  saveExportSettings(
    Object.fromEntries(
      Object.entries(persistableSettings).map(([key, settingRef]) => [key, settingRef.value])
    )
  )
})

onMounted(() => {
  restoreExportSettings()
  bus.on('showExportDialog', showDialog)
  bus.on('language-changed', updateTranslations)
})

onBeforeUnmount(() => {
  bus.off('showExportDialog', showDialog)
  bus.off('language-changed', updateTranslations)
})

const updateTranslations = () => {
  updateThemeList()
  pageSizeList.value = getPageSizeList()
  headerFooterTypes.value = getHeaderFooterTypes()
}

const updateThemeList = () => {
  themeList.value = [
    ...getExportThemeList(),
    ...customThemes.value.map(({ name, label }) => ({
      value: name,
      label
    }))
  ]
}

const showDialog = (type: unknown) => {
  const exportTypeValue = String(type ?? '')
  exportType.value = exportTypeValue
  isPrintable.value = exportTypeValue !== 'styledHtml'
  if (!isPrintable.value && (activeName.value === 'header' || activeName.value === 'page')) {
    activeName.value = 'info'
  }

  showExportSettingsDialog.value = true
  bus.emit('editor-blur')

  if (!themesLoaded.value) {
    themesLoaded.value = true
    loadCustomThemes()
  }
}

const headerFooter = (
  type: number,
  left: string,
  center: string,
  right: string
): DocumentCoreExportHeaderFooter | null => type === 0
  ? null
  : Object.freeze({
    layout: type === 1 ? 'single' : 'three-columns',
    left,
    center,
    right
  })

const handleClicked = () => {
  const builtInTheme =
    theme.value === 'default' ||
    theme.value === 'academic' ||
    theme.value === 'liber'
  const options: DocumentCoreExportOptions = {
    title: htmlTitle.value,
    page: {
      size: pageSize.value === 'custom'
        ? {
            kind: 'custom',
            widthMm: pageSizeWidth.value,
            heightMm: pageSizeHeight.value
          }
        : {
            kind: 'named',
            name: pageSize.value as NamedExportPageSize
          },
      landscape: isLandscape.value,
      marginsMm: {
        top: pageMarginTop.value,
        right: pageMarginRight.value,
        bottom: pageMarginBottom.value,
        left: pageMarginLeft.value
      }
    },
    theme: builtInTheme
      ? {
          kind: 'built-in',
          name: theme.value as 'default' | 'academic' | 'liber'
        }
      : { kind: 'custom', name: theme.value },
    typography: fontSettingsOverwrite.value
      ? {
          fontFamily: fontFamily.value === 'Default'
            ? null
            : fontFamily.value,
          fontSizePx: fontSize.value,
          lineHeight: lineHeight.value
        }
      : null,
    autoNumberHeadings: autoNumberingHeadings.value,
    showFrontMatter: showFrontMatter.value,
    toc: {
      title: tocTitle.value,
      includeTopHeading: tocIncludeTopHeading.value
    },
    header: headerFooter(
      headerType.value,
      headerTextLeft.value,
      headerTextCenter.value,
      headerTextRight.value
    ),
    footer: headerFooter(
      footerType.value,
      footerTextLeft.value,
      footerTextCenter.value,
      footerTextRight.value
    ),
    headerFooterAppearance: headerFooterCustomize.value
      ? {
          drawRules: headerFooterStyled.value,
          fontSizePx: headerFooterFontSize.value
        }
      : null
  }

  showExportSettingsDialog.value = false
  bus.emit('export', {
    type: exportType.value,
    options
  })
}

const onSelectChange = (key: string, value: unknown) => {
  const state: Record<string, Ref<unknown>> = {
    htmlTitle,
    pageSize,
    isLandscape,
    fontSettingsOverwrite,
    fontFamily,
    fontSize,
    lineHeight,
    autoNumberingHeadings,
    showFrontMatter,
    theme,
    headerType,
    headerTextLeft,
    headerTextCenter,
    headerTextRight,
    footerType,
    footerTextLeft,
    footerTextCenter,
    footerTextRight,
    headerFooterCustomize,
    headerFooterStyled,
    headerFooterFontSize,
    tocIncludeTopHeading,
    tocTitle
  }
  if (key in state) {
    state[key]!.value = value
  }
}

const loadCustomThemes = async () => {
  try {
    customThemes.value = await window.electron.ipcRenderer.invoke(
      'mt::document-core::list-export-themes'
    )
    updateThemeList()
  } catch (error) {
    console.error('Loading export themes failed:', error)
  }
}
</script>

<style scoped>
.print-settings-dialog {
  user-select: none;
}
.row {
  margin-bottom: 8px;
}
.description {
  margin-bottom: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}
.label {
  margin-bottom: 5px;
}
.label ~ div {
  margin-right: 20px;
}
.text {
  white-space: pre-wrap;
  word-break: break-word;
}

.button-controlls {
  margin-top: 8px;
  text-align: right;
}

.button-controlls .button-primary {
  font-size: 14px;
}

.el-tab-pane section:first-child {
  margin-top: 0;
}
</style>
<style>
.print-settings-dialog #pane-header .pref-text-box-item .el-input {
  width: 90% !important;
}

.print-settings-dialog .el-dialog__body {
  padding: 0 20px 20px 20px;
}
.print-settings-dialog .pref-select-item .el-select {
  width: 240px;
}
.print-settings-dialog .el-tabs__content {
  max-height: 350px;
  overflow-x: hidden;
  overflow-y: auto;
}

.print-settings-dialog .el-tabs__content::-webkit-scrollbar:vertical {
  width: 5px;
}

.el-input-number {
  & div {
    background: var(--inputBgColor);
  }
  & input {
    border: none !important;
  }
}
</style>
