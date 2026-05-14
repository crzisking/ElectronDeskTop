<script setup lang="ts">
/**
 * 左側邊欄導航組件 — Warm Editorial 風格
 *
 * 結構：
 *  ┌──────────────────────┐
 *  │ Brand：logo + 客戶端名 + 版本
 *  │ ──── 工作台（section）
 *  │   工作台導航項（config 驅動，可帶 badge 計數）
 *  │ ──── 系統（section）
 *  │   設定 / 幫助與回饋
 *  │ ──── 用戶卡片（底部）
 *  │ ──── 收合按鈕
 *  └──────────────────────┘
 *
 * 完全由 configStore.sidebarItems 驅動工作台分組；
 * 系統分組固定（設定 / 幫助與回饋）。
 */

import {computed, ref} from 'vue'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import {ElMessage} from 'element-plus'
import {useI18n} from 'vue-i18n'
import {useConfigStore} from '@/stores/config.store'
import {useUiStore} from '@/stores/ui.store'
import {useAuthStore} from '@/stores/auth.store'
import {useConfigText} from '@/composables/useConfigText'
import {useLanguage, LANGUAGE_OPTIONS} from '@/composables/useLanguage'
import SidebarNavItem from './SidebarNavItem.vue'
import SettingsDialog from '@/views/Settings/SettingsDialog.vue'
import {ArrowLeftBold, Check, Setting} from '@element-plus/icons-vue'
import type {SidebarItem, SystemLinkItem} from '@/types/config.types'
import type {SupportedLocale} from '@/locales'

const configStore = useConfigStore()
const uiStore = useUiStore()
const authStore = useAuthStore()
const {t} = useI18n()
const {ct} = useConfigText()
const {currentLocale, switching, switchLanguage} = useLanguage()

/**
 * 用戶點擊語言下拉項。
 * 展示用 toast 提示成功/失敗（這裡需要的話可以保留也可以省略，
 * 因為界面語言會立即切換，視覺反饋已經很明顯）。
 */
async function handleLanguageSelect(target: SupportedLocale) {
  const ok = await switchLanguage(target)
  // 失敗才提示；成功時界面已換語言，無需多餘 toast
  // 原文：語言切換失敗，已恢復原設定
  if (!ok) ElMessage.error(t('settings.language.switchFailed'))
}

/**
 * 工作台分組：基於 configStore.sidebarItems，並動態注入計數徽標。
 * 徽標規則：
 *  - unified-platform   → 平台系統數量（zero-pad 兩位）
 *  - internal-functions → 內部工具數量
 * 其餘 routeName 不顯示徽標。
 */
const workspaceItems = computed<SidebarItem[]>(() => {
  const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return configStore.sidebarItems.map((item) => {
    let badge: string | undefined
    switch (item.routeName) {
      case 'unified-platform':
        badge = pad2(configStore.platformSystems.length)
        break
      case 'internal-functions':
        badge = pad2((configStore.functionsConfig?.tools?.length ?? 0))
        break
    }
    return badge ? { ...item, badge } : item
  })
})

/** 系統分組外部連結（來自 config.systemLinks.items） */
const systemLinks = computed<SystemLinkItem[]>(() => configStore.systemLinkItems)

/** 動態解析 Element Plus 圖標組件（系統連結用） */
function resolveIcon(name: string) {
  const icons = ElementPlusIconsVue as Record<string, unknown>
  return icons[name] ?? null
}

/**
 * 點擊系統連結 → 用默認瀏覽器打開
 * 在 Electron 中 window.open 被 setWindowOpenHandler 攔截，
 * 內部會調用 shell.openExternal 交給系統瀏覽器處理
 */
function openSystemLink(link: SystemLinkItem) {
  window.open(link.url, '_blank')
}

/** 當前是否折疊 */
const collapsed = computed(() => uiStore.sidebarCollapsed)

/**
 * 用戶顯示信息。
 * AppLayout 由 requiresAuth 守衛保護,未登入會被導向 /login 而不會渲染側邊欄,
 * 因此這裡 user 理論上必定有值;極端 race condition(認證完成前的一瞬)用空字串兜底,
 * 不再用「訪客」之類的佔位文案 —— AD 失敗就是登入失敗,直接走 /login,沒有訪客身份。
 */
const userName = computed(() => authStore.user?.name ?? '')
const userInitial = computed(() => userName.value.charAt(0))

/** 切換折疊狀態 */
function toggleCollapse() {
  uiStore.toggleSidebar()
}

// ── 設置彈窗 ────────────────────────────────────────────────────
/**
 * 設置彈窗顯示狀態（v-model 綁定到 SettingsDialog）。
 * 由用戶名旁邊的齒輪按鈕觸發。
 */
const settingsVisible = ref(false)

function openSettings() {
  settingsVisible.value = true
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--collapsed': collapsed }">
    <!-- ── 工作台分組 ──────────────────────────────────────── -->
    <!-- 原文 section label：工作台 -->
    <div class="sidebar-section">
      <div v-show="!collapsed" class="section-label">{{ t('sidebar.sectionWorkspace') }}</div>
      <nav class="section-nav" role="menu" :aria-label="t('sidebar.sectionWorkspace')">
        <SidebarNavItem
          v-for="item in workspaceItems"
          :key="item.id"
          :item="item"
          :collapsed="collapsed"
        />
        <!-- 原文：菜單配置為空 -->
        <div v-if="workspaceItems.length === 0" class="nav-empty">
          <el-text type="info" size="small">{{ t('sidebar.emptyMenu') }}</el-text>
        </div>
      </nav>
    </div>

    <!-- ── 系統分組：外部連結（文檔中心等） ──────────────── -->
    <!-- 原文 section label：系统 -->
    <!-- link.label 走 useConfigText：字典裡有就翻譯，沒有就 fallback 到 JSON 原值 -->
    <div v-if="systemLinks.length > 0" class="sidebar-section">
      <div v-show="!collapsed" class="section-label">{{ t('sidebar.sectionSystem') }}</div>
      <nav class="section-nav" role="menu" :aria-label="t('sidebar.sectionSystem')">
        <button
          v-for="link in systemLinks"
          :key="link.id"
          type="button"
          class="nav-item"
          :class="{ 'is-collapsed': collapsed }"
          :title="collapsed ? ct(`config.systemLinks.${link.id}`, link.label) : ''"
          role="menuitem"
          @click="openSystemLink(link)"
        >
          <span class="nav-icon">
            <el-icon v-if="resolveIcon(link.icon)" :size="16">
              <component :is="resolveIcon(link.icon)" />
            </el-icon>
            <span v-else class="icon-placeholder">{{ ct(`config.systemLinks.${link.id}`, link.label).charAt(0) }}</span>
          </span>
          <span v-show="!collapsed" class="nav-label">{{ ct(`config.systemLinks.${link.id}`, link.label) }}</span>
        </button>
      </nav>
    </div>

    <!-- ── 底部：用戶卡片（頭像 + 姓名 + 設置按鈕） ────────── -->
    <div class="sidebar-spacer" />
    <div class="sidebar-user">
      <div class="user-avatar">{{ userInitial }}</div>
      <div v-show="!collapsed" class="user-info">
        <div class="user-name">{{ userName }}</div>
      </div>
      <!--
        設置按鈕：折疊狀態下也保留（小屏依然能進設定），
        完全隱藏會讓收合後找不到設定入口
      -->
      <!-- ── 語言切換快捷按鈕（齒輪左側） ──────────────────
           原文 tooltip：界面語言；點擊彈出 dropdown 列表，
           當前語言用 ✓ 高亮。配置寫入由 useLanguage composable 統一處理 -->
      <el-dropdown
        trigger="click"
        placement="top-start"
        :disabled="switching"
        @command="handleLanguageSelect"
      >
        <button
          type="button"
          class="settings-btn lang-btn"
          :title="t('settings.language.label')"
          :aria-label="t('settings.language.label')"
        >
          <!-- 文字按鈕：顯示當前語言代碼，緊湊不占地方 -->
          <span class="lang-btn__text">{{ currentLocale === 'zh-TW' ? '繁' : 'EN' }}</span>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item
              v-for="opt in LANGUAGE_OPTIONS"
              :key="opt.value"
              :command="opt.value"
              :disabled="opt.value === currentLocale || switching"
            >
              <span class="lang-item__label">{{ opt.label }}</span>
              <el-icon v-if="opt.value === currentLocale" class="lang-item__check" :size="14">
                <Check />
              </el-icon>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <!-- 原文 title：設定 -->
      <button
        type="button"
        class="settings-btn"
        :title="t('sidebar.settings')"
        @click="openSettings"
      >
        <el-icon :size="16"><Setting /></el-icon>
      </button>
    </div>

    <!-- ── 收合按鈕 ───────────────────────────────────────── -->
    <!-- 原文 title：展開側邊欄 / 收合側邊欄；按鈕文字：收合側邊欄 -->
    <button class="collapse-handle" type="button" :title="collapsed ? t('sidebar.expand') : t('sidebar.collapse')" @click="toggleCollapse">
      <el-icon :size="14" :style="{ transform: collapsed ? 'rotate(180deg)' : 'none' }">
        <ArrowLeftBold />
      </el-icon>
      <span v-show="!collapsed" class="collapse-label">{{ t('sidebar.collapse') }}</span>
    </button>

    <!-- 設置彈窗（透過 Teleport 渲染到 body，不受側邊欄裁剪） -->
    <SettingsDialog v-model="settingsVisible" />
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  height: 100%;
  background: var(--app-bg-sidebar);
  border-radius: var(--app-radius-lg);
  padding: 22px 14px 14px;
  flex-shrink: 0;
  overflow: hidden;
  transition: width 0.25s ease;
}

.sidebar--collapsed {
  width: var(--sidebar-width-collapsed);
  padding: 22px 10px 14px;
}

/* ── Section ─────────────────────────────────────────────── */
.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  margin-bottom: 18px;
}

.section-label {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--app-text-muted);
  padding: 0 8px;
  margin-bottom: 4px;
}

.section-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-empty {
  padding: 8px;
  text-align: center;
}

/* ── 系統分組：外部連結按鈕（樣式對齊 SidebarNavItem，但無路由激活態） ── */
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--app-text-secondary);
  cursor: pointer;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 500;
  text-align: left;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  overflow: hidden;
}

.nav-item.is-collapsed {
  justify-content: center;
  padding: 0;
}

.nav-item:hover {
  background: var(--app-bg-surface);
  color: var(--app-text-primary);
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

.icon-placeholder {
  width: 18px;
  height: 18px;
  background: var(--app-bg-muted);
  color: inherit;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.02em;
}

/* ── Spacer：把用戶卡片推到底 ──────────────────────────────── */
.sidebar-spacer {
  flex: 1;
  min-height: 12px;
}

/* ── 用戶卡片 ────────────────────────────────────────────── */
.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-top: 1px solid var(--app-border-subtle);
  margin-top: 8px;
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  /* 品牌藍底 + 白字,小而搶眼的使用者標記 */
  background: var(--app-brand);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-inverse);
  flex-shrink: 0;
}

.user-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 用戶名旁的設置按鈕 ─────────────────────────────────────── */
.settings-btn {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s, transform 0.18s;
  flex-shrink: 0;
}

.settings-btn:hover {
  background: var(--app-bg-surface);
  color: var(--app-text-primary);
  transform: rotate(60deg);
}

.settings-btn:active {
  transform: rotate(60deg) scale(0.95);
}

/* ── 語言切換按鈕（覆蓋 settings-btn 的旋轉動畫） ─────────── */
/* 文字按鈕用 12px 等寬字體，視覺重量與齒輪 icon 持平 */
.lang-btn .lang-btn__text {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  font-family: var(--app-font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
  color: inherit;
}

/* 覆蓋父類旋轉效果，語言按鈕不需要轉 */
.settings-btn.lang-btn:hover {
  transform: none;
}

.settings-btn.lang-btn:active {
  transform: scale(0.95);
}

/* ── 語言下拉項（當前語言尾部 ✓） ─────────────────────────── */
:global(.el-dropdown-menu__item) .lang-item__label {
  margin-right: 8px;
}

:global(.el-dropdown-menu__item) .lang-item__check {
  color: var(--app-success, var(--el-color-success));
  margin-left: auto;
}

/* ── 收合按鈕 ────────────────────────────────────────────── */
.collapse-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  margin-top: 6px;
  border: none;
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  border-radius: 6px;
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}

.collapse-handle:hover {
  background: var(--app-bg-surface);
  color: var(--app-text-primary);
}

.collapse-label {
  letter-spacing: 0.05em;
}
</style>
