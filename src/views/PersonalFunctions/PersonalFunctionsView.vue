<script setup lang="ts">
/**
 * 個人功能入口頁。
 *
 * 跟「內部功能」「統一平台」同層級的主功能,展示「為使用者個人服務」的卡片清單。
 * 目前收錄:
 *   - 工作自動採集(openMode: 'page',走 router.push)
 *   - 代辦事項(規劃中,openMode: 'native-window',點擊派發 IPC 開常駐視窗)
 *
 * 卡片由 config.personalFunctions.tools 驅動,改 JSON 不重打包就能加 / 改 / 隱藏入口。
 */

import {computed} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {useConfigStore} from '@/stores/config.store'
import {useConfigText} from '@/composables/useConfigText'
import {logger} from '@/utils/logger'
import type {PersonalTool} from '@/types/config.types'
import {ArrowRight, Plus} from '@element-plus/icons-vue'

const router = useRouter()
const configStore = useConfigStore()
const {t} = useI18n()
const {ct} = useConfigText()

/** 工具顯示名(i18n 字典缺失時 fallback 到 JSON name) */
function toolName(tool: PersonalTool): string {
  return ct(`config.personalTools.${tool.id}.name`, tool.name)
}

function toolDesc(tool: PersonalTool): string {
  return ct(`config.personalTools.${tool.id}.description`, tool.description)
}

/** 啟用中的工具卡片列表 */
const tools = computed<PersonalTool[]>(
  () => configStore.appConfig?.personalFunctions?.tools.filter((tl) => tl.enabled) ?? []
)

/**
 * 點擊卡片分派處理。
 *  - 'page'          → router.push({ name })
 *  - 'native-window' → 派發 IPC 開常駐視窗(目前只支援 'todo',未來其他常駐視窗在此擴展)
 */
function handleOpen(tool: PersonalTool) {
  if (tool.openMode === 'page' && tool.routeName) {
    router.push({name: tool.routeName}).catch((err) => {
      logger.warn('個人功能路由跳轉失敗', 'PersonalFunctions', {routeName: tool.routeName, err})
    })
    return
  }

  if (tool.openMode === 'native-window') {
    switch (tool.routeName) {
      case 'todo':
        // todoWindow 由代辦事項 feature 落地時暴露;尚未實作就 warn
        if (window.electronAPI?.todoWindow?.toggle) {
          window.electronAPI.todoWindow.toggle()
        } else {
          logger.warn('代辦事項視窗尚未實作', 'PersonalFunctions')
        }
        break
      default:
        logger.warn('未知的 native-window dispatch key', 'PersonalFunctions', {routeName: tool.routeName})
    }
  }
}

/** 應用版本 */
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
      <div
        v-for="tool in tools"
        :key="tool.id"
        class="app-card app-card--interactive tool-card"
        @click="handleOpen(tool)"
      >
        <div class="tool-card__top">
          <div class="tool-card__icon">
            <el-icon :size="20">
              <component :is="tool.icon"/>
            </el-icon>
          </div>
        </div>

        <div class="tool-card__body">
          <h3 class="tool-card__title">{{ toolName(tool) }}</h3>
          <p class="tool-card__desc">{{ toolDesc(tool) }}</p>
        </div>

        <div class="tool-card__footer">
          <span class="tool-card__meta">{{ toolDesc(tool) }}</span>
          <el-icon class="tool-card__arrow" :size="16">
            <ArrowRight/>
          </el-icon>
        </div>
      </div>

      <!-- 即將推出占位卡 -->
      <div class="app-card app-card--dashed coming-soon">
        <div class="coming-soon__icon">
          <el-icon :size="22">
            <Plus/>
          </el-icon>
        </div>
        <div class="coming-soon__title">{{ t('internal.comingSoon') }}</div>
        <div class="coming-soon__desc">{{ t('personal.comingSoonDesc') }}</div>
      </div>
    </div>

    <!-- 空狀態 -->
    <el-empty
      v-if="tools.length === 0"
      :description="t('personal.emptyAll')"
      :image-size="120"
    />

    <!-- ── 頁面底部 ───────────────────────────────────────── -->
    <div class="page-footer">
      <div class="page-footer__left">
        <span class="status-dot"/>
        <span>{{ t('internal.statusOk') }}</span>
      </div>
      <div class="page-footer__right">
        © {{ new Date().getFullYear() }} ICHIA Enterprise {{ appVersion }}
      </div>
    </div>
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

.tool-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 22px 18px;
  min-height: 200px;
}

.tool-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.tool-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--app-bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-primary);
  flex-shrink: 0;
}

.tool-card__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tool-card__title {
  font-size: 17px;
  font-weight: 600;
  color: var(--app-text-primary);
  margin: 0;
}

.tool-card__desc {
  font-size: 13px;
  line-height: 1.55;
  color: var(--app-text-secondary);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tool-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--app-border-subtle);
}

.tool-card__meta {
  font-size: 11px;
  color: var(--app-text-muted);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-card__arrow {
  color: var(--app-text-secondary);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.tool-card:hover .tool-card__arrow {
  transform: translateX(2px);
}

.coming-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 22px;
  min-height: 200px;
  gap: 8px;
}

.coming-soon__icon {
  color: var(--app-text-muted);
  margin-bottom: 4px;
}

.coming-soon__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.coming-soon__desc {
  font-size: 12px;
  color: var(--app-text-muted);
}

.page-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 14px;
  font-size: 12px;
  color: var(--app-text-muted);
}

.page-footer__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #67c23a;
}
</style>
