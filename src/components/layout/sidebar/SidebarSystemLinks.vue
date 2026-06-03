<script lang="ts" setup>
/**
 * 側邊欄「系統」分組 — 外部連結列表(文檔中心等)。
 *
 * 純展示按鈕,點擊用系統瀏覽器打開(走 setWindowOpenHandler → shell.openExternal)。
 * label 走 useConfigText 翻譯。
 */
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import {useI18n} from 'vue-i18n'
import {useConfigText} from '@/shared/composables/useConfigText'
import type {SystemLinkItem} from '@/types/config'

defineProps<{
  links: SystemLinkItem[]
  collapsed: boolean
}>()

const {t} = useI18n()
const {ct} = useConfigText()

function resolveIcon(name: string) {
  const icons = ElementPlusIconsVue as Record<string, unknown>
  return icons[name] ?? null
}

function openSystemLink(link: SystemLinkItem) {
  // Electron 內 window.open 被 setWindowOpenHandler 攔截,改走 shell.openExternal
  window.open(link.url, '_blank')
}
</script>

<template>
  <div v-if="links.length > 0" class="sidebar-section">
    <div v-show="!collapsed" class="section-label">{{ t('sidebar.sectionSystem') }}</div>
    <nav :aria-label="t('sidebar.sectionSystem')" class="section-nav" role="menu">
      <button
          v-for="link in links"
          :key="link.id"
          :class="{'is-collapsed': collapsed}"
          :title="collapsed ? ct(`config.systemLinks.${link.id}`, link.label) : ''"
          class="nav-item"
          role="menuitem"
          type="button"
          @click="openSystemLink(link)"
      >
        <span class="nav-icon">
          <el-icon v-if="resolveIcon(link.icon)" :size="16">
            <component :is="resolveIcon(link.icon)"/>
          </el-icon>
          <span v-else class="icon-placeholder">
            {{ ct(`config.systemLinks.${link.id}`, link.label).charAt(0) }}
          </span>
        </span>
        <span v-show="!collapsed" class="nav-label">
          {{ ct(`config.systemLinks.${link.id}`, link.label) }}
        </span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
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
</style>
