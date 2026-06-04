<script lang="ts" setup>
/**
 * AI 服務商設置區 — 管理 LLM provider 列表 + 當前 active 選擇 + 測試連線 + 清除分析報告。
 *
 * 設計:
 *   - Provider 配置寫在 agent_configs.providers(由舊 Agent feature 沿用,共用 LlmClient 讀)
 *   - radio 選擇 = activeProviderId,所有要打 LLM 的 feature(工作分析、未來其他)都讀這個
 *   - 新增 / 編輯共用同一個 ProviderFormDialog
 *   - 第一次新增的 provider 自動設為 active
 *   - 刪除 active provider 時把 active 清空,提示使用者重選
 *   - 「測試連線」走 workAnalysis.testConnection IPC(內部 LlmClient.testConnection)
 *   - 「清除分析報告」走 workAnalysis.deleteAll(設置頁的逃生口)
 *
 * 為何取設置頁這個位置而非工作分析頁:
 *   provider 是全局配置(未來其他 feature 也用),語意上屬「應用設定」,
 *   不該綁在工作分析子頁裡。
 */

import {computed, onMounted, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {ElMessage, ElMessageBox} from 'element-plus'
import {Connection, Delete, Edit, Plus, Star} from '@element-plus/icons-vue'
import type {LlmProviderConfig} from '@shared/types/llm.types'
import SettingsRow from '../components/SettingsRow.vue'
import ProviderFormDialog from './components/ProviderFormDialog.vue'

const {t} = useI18n()

// ── 配置狀態(從 main 拉,本地維護) ───────────────────────────────
const providers = ref<LlmProviderConfig[]>([])
const activeId = ref<string | null>(null)
const loading = ref(false)

// ── 表單 dialog ──────────────────────────────────────────────────
const formVisible = ref(false)
/** 編輯模式時帶入,新增時為 null */
const editingProvider = ref<LlmProviderConfig | null>(null)

// ── 測試連線狀態(per provider) ─────────────────────────────────
/** providerId → 'testing' / 'ok' / 'fail',undefined = 從未測 */
const testStatus = ref<Record<string, 'testing' | 'ok' | 'fail'>>({})

// ─── 載入 / 儲存 ───────────────────────────────────────────────

async function loadConfig() {
  loading.value = true
  try {
    const cfg = await window.electronAPI.workAnalysis.readLlmConfig()
    providers.value = cfg.providers ?? []
    activeId.value = cfg.activeProviderId ?? null
  } catch (err) {
    ElMessage.error(t('settings.llm.loadFailed'))
    console.error('[LlmSection] load failed', err)
  } finally {
    loading.value = false
  }
}

const sortedProviders = computed(() => providers.value)

// ─── 操作 ──────────────────────────────────────────────────────

function openNew() {
  editingProvider.value = null
  formVisible.value = true
}

function openEdit(provider: LlmProviderConfig) {
  editingProvider.value = {...provider}  // 拷貝避免直接 mutate
  formVisible.value = true
}

async function handleFormSubmit(updated: LlmProviderConfig, isNew: boolean) {
  if (isNew) {
    providers.value = [...providers.value, updated]
    // 第一個 provider 自動設 active
    if (activeId.value === null) activeId.value = updated.id
  } else {
    providers.value = providers.value.map(p => p.id === updated.id ? updated : p)
  }
  await persist()
  formVisible.value = false
}

async function handleDelete(provider: LlmProviderConfig) {
  try {
    await ElMessageBox.confirm(
        t('settings.llm.confirmDelete', {label: provider.label}),
        t('common.confirm'),
        {type: 'warning', confirmButtonText: t('common.delete'), cancelButtonText: t('common.cancel')},
    )
  } catch {
    return  // 使用者取消
  }
  providers.value = providers.value.filter(p => p.id !== provider.id)
  // 刪到 active 就清空,提示重選
  if (activeId.value === provider.id) {
    activeId.value = providers.value[0]?.id ?? null
    if (activeId.value === null) {
      ElMessage.warning(t('settings.llm.activeCleared'))
    }
  }
  await persist()
}

async function handleActiveChange(id: string) {
  activeId.value = id
  await persist()
}

async function persist() {
  const ok = await window.electronAPI.workAnalysis.writeLlmConfig({
    providers: providers.value,
    activeProviderId: activeId.value ?? undefined,
  })
  if (!ok) {
    ElMessage.error(t('settings.llm.saveFailed'))
  }
}

async function handleTest(provider: LlmProviderConfig) {
  testStatus.value = {...testStatus.value, [provider.id]: 'testing'}
  try {
    const result = await window.electronAPI.workAnalysis.testConnection(provider.id)
    if (result.ok) {
      testStatus.value = {...testStatus.value, [provider.id]: 'ok'}
      ElMessage.success(t('settings.llm.testOk', {
        label: result.providerLabel,
        latency: result.latencyMs,
      }))
    } else {
      testStatus.value = {...testStatus.value, [provider.id]: 'fail'}
      ElMessage.error(t('settings.llm.testFail', {error: result.error}))
    }
  } catch (err) {
    testStatus.value = {...testStatus.value, [provider.id]: 'fail'}
    ElMessage.error(t('settings.llm.testFail', {error: String(err)}))
  }
}

async function handleClearReports() {
  try {
    await ElMessageBox.confirm(
        t('settings.llm.confirmClearReports'),
        t('common.confirm'),
        {type: 'warning', confirmButtonText: t('common.delete'), cancelButtonText: t('common.cancel')},
    )
  } catch {
    return
  }
  const result = await window.electronAPI.workAnalysis.deleteAll()
  if (result.ok) {
    ElMessage.success(t('settings.llm.reportsCleared', {count: result.deleted}))
  } else {
    ElMessage.error(t('settings.llm.reportsClearFailed'))
  }
}

onMounted(() => {
  void loadConfig()
})
</script>

<template>
  <div class="llm-section">
    <SettingsRow
        :description="t('settings.llm.providersDesc')"
        :title="t('settings.llm.providersTitle')"
    >
      <el-button :icon="Plus" size="small" type="primary" @click="openNew">
        {{ t('settings.llm.addProvider') }}
      </el-button>
    </SettingsRow>

    <!-- Provider 列表 -->
    <div v-if="sortedProviders.length === 0" class="llm-section__empty">
      {{ t('settings.llm.noProviders') }}
    </div>

    <ul v-else class="provider-list">
      <li
          v-for="provider in sortedProviders"
          :key="provider.id"
          :class="{ 'is-active': provider.id === activeId }"
          class="provider-item"
      >
        <!-- 左側 radio + 名稱 + url/model -->
        <label class="provider-item__main">
          <el-radio
              :model-value="activeId === provider.id ? provider.id : ''"
              :value="provider.id"
              @change="handleActiveChange(provider.id)"
          >
            <span class="provider-item__label">
              {{ provider.label }}
              <el-icon
                  v-if="provider.id === activeId"
                  :size="12"
                  class="provider-item__active-icon"
              ><Star/></el-icon>
            </span>
          </el-radio>
          <span class="provider-item__meta">
            {{ provider.baseUrl }}
            <template v-if="provider.model"> · {{ provider.model }}</template>
          </span>
          <span
              v-if="testStatus[provider.id]"
              :class="['provider-item__status', `is-${testStatus[provider.id]}`]"
          >
            {{ t(`settings.llm.testStatus.${testStatus[provider.id]}`) }}
          </span>
        </label>

        <!-- 右側操作 -->
        <div class="provider-item__actions">
          <el-button
              :icon="Connection"
              :loading="testStatus[provider.id] === 'testing'"
              :title="t('settings.llm.test')"
              circle
              size="small"
              @click="handleTest(provider)"
          />
          <el-button :icon="Edit" :title="t('common.edit')" circle size="small" @click="openEdit(provider)"/>
          <el-button
              :icon="Delete"
              :title="t('common.delete')"
              circle
              size="small"
              type="danger"
              @click="handleDelete(provider)"
          />
        </div>
      </li>
    </ul>

    <!-- 清除分析報告(逃生口) -->
    <SettingsRow
        :description="t('settings.llm.clearReportsDesc')"
        :title="t('settings.llm.clearReportsTitle')"
        compact
    >
      <el-button :icon="Delete" plain size="small" type="danger" @click="handleClearReports">
        {{ t('settings.llm.clearReports') }}
      </el-button>
    </SettingsRow>

    <!-- 新增 / 編輯表單 -->
    <ProviderFormDialog
        v-model:visible="formVisible"
        :provider="editingProvider"
        @submit="handleFormSubmit"
    />
  </div>
</template>

<style scoped>
.llm-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.llm-section__empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.provider-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.provider-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  transition: border-color 0.15s, background 0.15s;
}

.provider-item.is-active {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.provider-item__main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.provider-item__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  font-size: 14px;
}

.provider-item__active-icon {
  color: var(--el-color-primary);
}

.provider-item__meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.provider-item__status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.provider-item__status.is-testing {
  background: var(--el-color-info-light-8);
  color: var(--el-color-info);
}

.provider-item__status.is-ok {
  background: var(--el-color-success-light-8);
  color: var(--el-color-success);
}

.provider-item__status.is-fail {
  background: var(--el-color-danger-light-8);
  color: var(--el-color-danger);
}

.provider-item__actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
</style>
