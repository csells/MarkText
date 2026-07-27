<template>
  <div
    v-show="showSideBar"
    ref="sideBar"
    class="side-bar"
    :style="[!rightColumn ? { 'min-width': '45px' } : {}, { width: `${finalSideBarWidth}px` }]"
  >
    <div class="left-column">
      <ul>
        <li
          v-for="c of sideBarIcons"
          :key="c.id"
          :class="{ active: c.id === rightColumn }"
        >
          <button
            type="button"
            class="side-bar-action"
            :data-side-bar-action="c.id"
            :title="c.name()"
            :aria-label="c.name()"
            :aria-pressed="c.id === rightColumn"
            @click="handleLeftIconClick(c.id)"
            @keydown.enter.prevent="handleLeftIconClick(c.id)"
            @keydown.space.prevent="handleLeftIconClick(c.id)"
          >
            <component
              :is="c.icon"
              aria-hidden="true"
            />
            <span
              v-if="c.id === 'review' && reviewCount > 0"
              class="review-count"
              aria-hidden="true"
            >
              {{ reviewBadgeText }}
            </span>
          </button>
        </li>
      </ul>
      <ul class="bottom">
        <li
          v-for="c of sideBarBottomIcons"
          :key="c.id"
        >
          <button
            type="button"
            class="side-bar-action"
            :data-side-bar-action="c.id"
            :title="c.name()"
            :aria-label="c.name()"
            @click="handleLeftBottomClick(c.id)"
            @keydown.enter.prevent="handleLeftBottomClick(c.id)"
            @keydown.space.prevent="handleLeftBottomClick(c.id)"
          >
            <component
              :is="c.icon"
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
    </div>
    <div
      v-show="rightColumn"
      class="right-column"
    >
      <tree
        v-if="rightColumn === 'files'"
        :project-tree="projectTree"
        :opened-files="openedFiles"
        :tabs="tabs"
      />
      <side-bar-search v-else-if="rightColumn === 'search'" />
      <toc v-else-if="rightColumn === 'toc'" />
      <review v-else-if="rightColumn === 'review'" />
    </div>
    <div
      v-show="rightColumn"
      ref="dragBar"
      class="drag-bar"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, nextTick, watch } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'
import { useCriticMarkupReviewStore } from '@/store/criticMarkupReview'

import { sideBarIcons, sideBarBottomIcons } from './help'
import Tree from './tree.vue'
import SideBarSearch from './search.vue'
import Toc from './toc.vue'
import Review from './review.vue'
import { storeToRefs } from 'pinia'
import type { TabDescriptor } from './types'
import bus from '@/bus'

const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const editorStore = useEditorStore()
const criticMarkupReviewStore = useCriticMarkupReviewStore()

const sideBar = ref<HTMLDivElement | null>(null)
const dragBar = ref<HTMLDivElement | null>(null)

const openedFiles = ref<TabDescriptor[]>([])
const sideBarViewWidth = ref(280)

const { rightColumn, showSideBar, sideBarWidth } = storeToRefs(layoutStore)

const { projectTree } = storeToRefs(projectStore)
const { tabs } = storeToRefs(editorStore)
const {
  snapshot: criticMarkupReview,
  composing: criticMarkupComposing,
  commentEditRequest: criticMarkupCommentEditRequest
} = storeToRefs(criticMarkupReviewStore)

// Starting a comment (Add Comment) reveals the Review sidebar with its compose
// box. Opening the sidebar is a view concern, so it lives here rather than in
// the review controller.
watch(criticMarkupComposing, (composing) => {
  if (composing) {
    layoutStore.SET_LAYOUT({ rightColumn: 'review', showSideBar: true })
  }
})

watch(criticMarkupCommentEditRequest, (request) => {
  if (request) {
    layoutStore.SET_LAYOUT({ rightColumn: 'review', showSideBar: true })
  }
}, { immediate: true })

const reviewCount = computed(() => criticMarkupReview.value.items.length)
const reviewBadgeText = computed(() => reviewCount.value > 99 ? '99+' : `${reviewCount.value}`)

const finalSideBarWidth = computed<number>(() => {
  if (!showSideBar.value) return 0
  if (rightColumn.value === '') return 45
  return sideBarViewWidth.value < 220 ? 220 : sideBarViewWidth.value
})

onMounted(() => {
  bus.on('critic-markup-open-review', openReview)
  nextTick(() => {
    const dragBarEl = dragBar.value
    if (!dragBarEl) return
    let startX = 0
    let currentSideBarWidth = +sideBarWidth.value
    let startWidth = currentSideBarWidth

    sideBarViewWidth.value = currentSideBarWidth

    const mouseUpHandler = (): void => {
      document.removeEventListener('mousemove', mouseMoveHandler, false)
      document.removeEventListener('mouseup', mouseUpHandler, false)
      layoutStore.CHANGE_SIDE_BAR_WIDTH(currentSideBarWidth < 220 ? 220 : currentSideBarWidth)
    }

    const mouseMoveHandler = (event: MouseEvent): void => {
      const offset = event.clientX - startX
      currentSideBarWidth = startWidth + offset
      sideBarViewWidth.value = currentSideBarWidth
    }

    const mouseDownHandler = (event: MouseEvent): void => {
      startX = event.clientX
      startWidth = +sideBarWidth.value
      document.addEventListener('mousemove', mouseMoveHandler, false)
      document.addEventListener('mouseup', mouseUpHandler, false)
    }

    dragBarEl.addEventListener('mousedown', mouseDownHandler, false)
  })
})

onBeforeUnmount(() => {
  bus.off('critic-markup-open-review', openReview)
})

function openReview (): void {
  layoutStore.SET_LAYOUT({ rightColumn: 'review', showSideBar: true })
}

const handleLeftIconClick = (name: string): void => {
  if (rightColumn.value === name) {
    // Capture the expanded width BEFORE collapsing: once rightColumn is '',
    // finalSideBarWidth evaluates to the 45px icon strip and would overwrite
    // the user's real width with the clamped 220px minimum (#2421).
    const widthToPersist = finalSideBarWidth.value
    layoutStore.SET_LAYOUT({ rightColumn: '' })
    layoutStore.CHANGE_SIDE_BAR_WIDTH(widthToPersist)
  } else {
    const needDispatch = rightColumn.value === ''
    layoutStore.SET_LAYOUT({ rightColumn: name })
    sideBarViewWidth.value = +sideBarWidth.value
    if (needDispatch) {
      layoutStore.CHANGE_SIDE_BAR_WIDTH(finalSideBarWidth.value)
    }
  }
}

const handleLeftBottomClick = (name: string): void => {
  if (name === 'settings') {
    projectStore.OPEN_SETTING_WINDOW()
  }
}
</script>

<style scoped>
.side-bar {
  display: flex;
  flex-shrink: 0;
  flex-grow: 0;
  width: 280px;
  height: 100vh;
  min-width: 220px;
  position: relative;
  color: var(--sideBarColor);
  user-select: none;
  background: var(--sideBarBgColor);
  border-right: 1px solid var(--itemBgColor);
}

.side-bar .left-column svg {
  color: var(--iconColor);
}

.left-column {
  height: 100%;
  width: 45px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding-top: 28px;
  box-sizing: border-box;
}

.left-column > ul {
  opacity: 1;
}

.left-column ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
}

.left-column ul > li {
  width: 45px;
  height: 45px;
  margin: 0;
  padding: 0;
  position: relative;
}

.side-bar-action {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  display: flex;
  justify-content: space-around;
  align-items: center;
  position: relative;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.side-bar-action:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--themeColor);
  outline-offset: -3px;
}

.review-count {
  position: absolute;
  top: 5px;
  right: 4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  box-sizing: border-box;
  border-radius: 7px;
  background: var(--themeColor);
  color: var(--sideBarBgColor);
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
}

.left-column ul > li > .side-bar-action > svg {
  width: 18px;
  height: 18px;
  color: var(--sideBarIconColor);
  opacity: 1;
  transition: transform 0.25s ease-in-out;
}

.left-column ul > li.active > .side-bar-action > svg {
  color: var(--themeColor);
}

.side-bar:hover .left-column ul li svg {
  opacity: 1;
}

.right-column {
  flex: 1;
  width: calc(100% - 50px);
  overflow: hidden;
}

.drag-bar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  height: 100%;
  width: 3px;
  cursor: col-resize;
}

.drag-bar:hover {
  border-right: 2px solid var(--iconColor);
}
</style>
