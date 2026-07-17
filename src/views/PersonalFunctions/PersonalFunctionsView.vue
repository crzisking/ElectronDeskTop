<script setup lang="ts">
/**
 * 個人功能入口 — 薄殼。
 *
 * 跟「內部功能」「統一平台」同層級的主功能,展示「為使用者個人服務」的卡片清單。
 * 卡片由 config.personalFunctions.tools 驅動,改 JSON 不重打包就能加 / 改 / 隱藏入口。
 *
 * 共用元件:ToolCard / ComingSoonCard / PageFooter(都在 components/common/)。
 */

import {computed} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {useConfigStore} from '@/stores/config.store'
import {useConfigText} from '@/shared/composables/useConfigText'
import {logger} from '@/shared/utils/logger'
import type {PersonalTool} from '@shared/types/config'
import ToolCard from '@/components/common/ToolCard.vue'
import ComingSoonCard from '@/components/common/ComingSoonCard.vue'
import PageFooter from '@/components/common/PageFooter.vue'

const router = useRouter()
const configStore = useConfigStore()
const {t} = useI18n()
const {ct} = useConfigText()

function toolName(tool: PersonalTool): string {
  return ct(`config.personalTools.${tool.id}.name`, tool.name)
}

function toolDesc(tool: PersonalTool): string {
  return ct(`config.personalTools.${tool.id}.description`, tool.description)
}

const tools = computed<PersonalTool[]>(
    () => configStore.appConfig?.personalFunctions?.tools.filter((tl) => tl.enabled) ?? [],
)

function handleOpen(tool: PersonalTool) {
  if (tool.openMode === 'page' && tool.routeName) {
    router.push({name: tool.routeName}).catch((err) => {
      logger.warn('個人功能路由跳轉失敗', 'PersonalFunctions', {routeName: tool.routeName, err})
    })
    return
  }
  if (tool.openMode === 'window' && tool.windowId) {
    // 目前只有 todo 一個;之後加新窗在這 switch
    if (tool.windowId === 'todo') {
      window.electronAPI.window.openTodoCapture().catch((err) => {
        logger.warn('打開代辦錄入窗失敗', 'PersonalFunctions', err as Error)
      })
    }
  }
}

const appVersion = computed(() => configStore.appConfig?.version ?? '—')
</script>

<template>
  <div class="app-page personal-functions-view">
    <!-- ── 頁面標題 ──────────────────────────────────────── -->
    <div class="app-page-header app-page-header--compact">
      <div class="app-page-header__left">
        <h1 class="page-title">{{ t('personal.title') }}</h1>
        <p class="page-subtitle">{{ t('personal.subtitle') }}</p>
      </div>
    </div>

    <!-- ── Section 標題列 ──────────────────────────────────── -->
    <div class="section-bar">
      <div class="app-section-title">
        <span class="app-section-title__main">{{ t('personal.mySection') }}</span>
        <span class="app-section-title__count">
          {{ String(tools.length).padStart(2, '0') }} {{ t('internal.itemsLabel') }}
        </span>
      </div>
    </div>

    <!-- ── 卡片網格 ───────────────────────────────────────── -->
    <div class="tools-grid">
      <ToolCard
          v-for="tool in tools"
          :key="tool.id"
          :description="toolDesc(tool)"
          :icon="tool.icon"
          :meta="toolDesc(tool)"
          :title="toolName(tool)"
          @click="handleOpen(tool)"
      />
      <ComingSoonCard :description="t('personal.comingSoonDesc')" :title="t('internal.comingSoon')"/>
    </div>

    <!-- 空狀態 -->
    <el-empty
        v-if="tools.length === 0"
        :description="t('personal.emptyAll')"
        :image-size="120"
    />

    <PageFooter :version="appVersion"/>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: var(--app-text-primary);
  letter-spacing: -0.01em;
}

.page-subtitle {
  margin: 6px 0 0 0;
  font-size: 14px;
  color: var(--app-text-secondary);
}

.section-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  margin-top: 6px;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: 18px;
  align-content: start;
  flex: 1;
  min-height: 0;
}
</style>
