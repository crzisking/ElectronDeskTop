<script lang="ts" setup>
/**
 * 側邊欄底部用戶卡片 — 頭像 + 姓名 + 語言切換 + 設置按鈕。
 *
 * 設置 dialog 的 visible state 走 ui.store(原本本檔自管 ref,但跨頁觸發
 * 像「工作分析 toast 打開設定」場景需要全域控制,所以集中)。
 * SettingsDialog 仍掛在這個元件內,因為它是「最常駐」的容器(主視窗常駐)。
 */
import {computed} from 'vue'
import {Check, Setting} from '@element-plus/icons-vue'
import {useI18n} from 'vue-i18n'
import {ElMessage} from 'element-plus'
import {useAuthStore} from '@/stores/auth.store'
import {useUiStore} from '@/stores/ui.store'
import {LANGUAGE_OPTIONS, useLanguage} from '@/shared/composables/useLanguage'
import SettingsDialog from '@/views/Settings/SettingsDialog.vue'
import type {SupportedLocale} from '@/locales'

defineProps<{
  collapsed: boolean
}>()

const {t} = useI18n()
const authStore = useAuthStore()
const uiStore = useUiStore()
const {currentLocale, switching, switchLanguage} = useLanguage()

const userName = computed(() => authStore.user?.name ?? '')
const userInitial = computed(() => userName.value.charAt(0))

async function handleLanguageSelect(target: SupportedLocale) {
  const ok = await switchLanguage(target)
  // 失敗才提示;成功時界面已換語言,無需多餘 toast
  if (!ok) ElMessage.error(t('settings.language.switchFailed'))
}
</script>

<template>
  <div class="sidebar-user">
    <div class="user-avatar">{{ userInitial }}</div>
    <div v-show="!collapsed" class="user-info">
      <div class="user-name">{{ userName }}</div>
    </div>

    <!-- 語言切換 dropdown(齒輪左側)。當前語言用 ✓ 高亮 -->
    <el-dropdown
        :disabled="switching"
        placement="top-start"
        trigger="click"
        @command="handleLanguageSelect"
    >
      <button
          :aria-label="t('settings.language.label')"
          :title="t('settings.language.label')"
          class="settings-btn lang-btn"
          type="button"
      >
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
            <el-icon v-if="opt.value === currentLocale" :size="14" class="lang-item__check">
              <Check/>
            </el-icon>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <!-- 設置按鈕:折疊狀態下也保留(小屏依然能進設定) -->
    <button
        :title="t('sidebar.settings')"
        class="settings-btn"
        type="button"
        @click="uiStore.openSettings()"
    >
      <el-icon :size="16">
        <Setting/>
      </el-icon>
    </button>

    <!-- 設置彈窗(Teleport 到 body,不受側邊欄裁剪) -->
    <!-- v-model 綁 ui.store.settingsVisible,任何頁面 call openSettings 都能觸發 -->
    <SettingsDialog
        :model-value="uiStore.settingsVisible"
        @update:model-value="(v: boolean) => v ? uiStore.openSettings(uiStore.settingsFocusSection ?? undefined) : uiStore.closeSettings()"
    />
  </div>
</template>

<style scoped>
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

/* 語言按鈕:文字 12px 等寬字體 + 不轉動 */
.lang-btn .lang-btn__text {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  font-family: var(--app-font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
  color: inherit;
}

.settings-btn.lang-btn:hover {
  transform: none;
}

.settings-btn.lang-btn:active {
  transform: scale(0.95);
}

/* 語言下拉項(當前語言尾部 ✓) */
:global(.el-dropdown-menu__item) .lang-item__label {
  margin-right: 8px;
}

:global(.el-dropdown-menu__item) .lang-item__check {
  color: var(--app-success, var(--el-color-success));
  margin-left: auto;
}
</style>
