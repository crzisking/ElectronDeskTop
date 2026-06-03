<script lang="ts" setup>
/**
 * Agent 設定浮層。
 *
 * 含三段:
 *  1. LLM 廠商:active provider 選擇 + 增刪改 + model 列表拉取
 *  2. Thinking 模式:開關 + reasoning effort
 *  3. 對話控制:maxTurns
 *
 * Provider 管理 + model 拉取邏輯自帶,父層只控 open / close + 收 save 事件。
 */
import {ref, watch} from 'vue'
import {useAgentStore} from '../store'
import {fetchModels, invalidateModelsCache} from '../composables/fetch-models'
import type {ProviderConfig} from '../types'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'save'): void
}>()

const store = useAgentStore()

const modelOptions = ref<string[]>([])
const modelLoading = ref(false)

/**
 * 對當前 active provider 拉一份 model 列表。
 * 觸發點:打開設定 / 切換 provider / 編輯 apiKey 後手動點「↻」
 */
async function loadModels(force = false): Promise<void> {
  const p = store.activeProvider
  if (!p?.apiKey || !p.baseUrl) {
    modelOptions.value = []
    return
  }
  if (force) invalidateModelsCache(p.baseUrl, p.apiKey)
  modelLoading.value = true
  try {
    modelOptions.value = await fetchModels(p.baseUrl, p.apiKey)
  } finally {
    modelLoading.value = false
  }
}

/** 開啟時自動拉一次 */
watch(() => props.open, (open) => {
  if (open) void loadModels()
})

function onSelectProvider(id: string): void {
  store.setActiveProviderId(id)
  modelOptions.value = []
  void loadModels()
}

/** 編輯 apiKey 後清快取重拉(換 key 後 model 列表可能變動) */
function onApiKeyChange(): void {
  const p = store.activeProvider
  if (p) invalidateModelsCache(p.baseUrl, p.apiKey)
}

function onAddProvider(): void {
  const newProvider: ProviderConfig = {
    id: `custom-${Date.now()}`,
    label: '自訂',
    baseUrl: 'https://',
    apiKey: '',
    model: '',
  }
  const list = [...(store.config.providers ?? []), newProvider]
  store.setProviders(list)
  store.setActiveProviderId(newProvider.id)
  modelOptions.value = []
}

function onDeleteProvider(): void {
  const list = store.config.providers ?? []
  if (list.length <= 1) return  // 至少留 1 個
  const filtered = list.filter((p) => p.id !== store.config.activeProviderId)
  store.setProviders(filtered)  // setProviders 內部自動指到第一個
  modelOptions.value = []
  void loadModels()
}
</script>

<template>
  <transition name="overlay">
    <div v-if="open" class="overlay" @click.self="emit('update:open', false)">
      <div class="modal">
        <div class="modal__head">
          <h3>設定</h3>
          <button class="x-btn" @click="emit('update:open', false)">✕</button>
        </div>
        <div class="modal__body">
          <!-- ───── Section 1:廠商 ───── -->
          <section class="settings-section">
            <header class="settings-section__head">
              <h4>LLM 廠商</h4>
              <span class="settings-section__hint">未來由 TMBOM 後端同步</span>
            </header>

            <div class="provider-bar">
              <select
                  :value="store.config.activeProviderId"
                  class="provider-bar__select"
                  @change="onSelectProvider(($event.target as HTMLSelectElement).value)"
              >
                <option
                    v-for="p in store.config.providers ?? []"
                    :key="p.id"
                    :value="p.id"
                >{{ p.label }}
                </option>
              </select>
              <button class="icon-btn" title="添加廠商" type="button" @click="onAddProvider">
                <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-width="2"
                     viewBox="0 0 24 24" width="14">
                  <line x1="12" x2="12" y1="5" y2="19"/>
                  <line x1="5" x2="19" y1="12" y2="12"/>
                </svg>
              </button>
              <button
                  :disabled="(store.config.providers?.length ?? 0) <= 1"
                  class="icon-btn icon-btn--danger"
                  title="刪除目前廠商"
                  type="button"
                  @click="onDeleteProvider"
              >
                <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
                     stroke-width="2" viewBox="0 0 24 24" width="14">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                </svg>
              </button>
            </div>

            <template v-if="store.activeProvider">
              <label class="field">
                <span class="field__label">名稱</span>
                <input
                    :value="store.activeProvider.label"
                    class="field__input"
                    @input="store.updateActiveProvider({label: ($event.target as HTMLInputElement).value})"
                />
              </label>
              <label class="field">
                <span class="field__label">Base URL</span>
                <input
                    :value="store.activeProvider.baseUrl"
                    class="field__input"
                    @input="store.updateActiveProvider({baseUrl: ($event.target as HTMLInputElement).value})"
                />
              </label>
              <label class="field">
                <span class="field__label">API Key</span>
                <input
                    :value="store.activeProvider.apiKey"
                    class="field__input"
                    placeholder="貼上該廠商的 API Key"
                    type="password"
                    @change="onApiKeyChange"
                    @input="store.updateActiveProvider({apiKey: ($event.target as HTMLInputElement).value})"
                />
              </label>
              <div class="field">
                <span class="field__label">Model</span>
                <div class="model-row">
                  <select
                      v-if="modelOptions.length > 0"
                      :value="store.activeProvider.model"
                      class="field__input model-row__select"
                      @change="store.updateActiveProvider({model: ($event.target as HTMLSelectElement).value})"
                  >
                    <option disabled value="">— 選擇 model —</option>
                    <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
                  </select>
                  <input
                      v-else
                      :value="store.activeProvider.model"
                      class="field__input model-row__select"
                      placeholder="填 API Key 後點 ↻ 拉取;或手填"
                      @input="store.updateActiveProvider({model: ($event.target as HTMLInputElement).value})"
                  />
                  <button
                      :class="{loading: modelLoading}"
                      :disabled="modelLoading"
                      class="icon-btn"
                      title="重新拉取 model 列表(忽略快取)"
                      type="button"
                      @click="loadModels(true)"
                  >
                    <svg fill="none" height="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
                         stroke-width="2" viewBox="0 0 24 24" width="14">
                      <polyline points="23 4 23 10 17 10"/>
                      <polyline points="1 20 1 14 7 14"/>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                  </button>
                </div>
              </div>
            </template>
          </section>

          <!-- ───── Section 2:Thinking 模式 ───── -->
          <section class="settings-section">
            <header class="settings-section__head">
              <h4>Thinking 模式</h4>
              <span class="settings-section__hint">DeepSeek V4 / Claude / o-series 才支援</span>
            </header>

            <label class="switch">
              <input v-model="store.config.thinkingEnabled" type="checkbox"/>
              <span class="switch__track"/>
              <span class="switch__label">啟用思考鏈輸出</span>
            </label>

            <div v-if="store.config.thinkingEnabled" class="field">
              <span class="field__label">Reasoning Effort</span>
              <select v-model="store.config.reasoningEffort" class="field__input">
                <option value="high">high — 預設,平衡速度與深度</option>
                <option value="max">max — Agent 類複雜任務,代價更高</option>
              </select>
            </div>
          </section>

          <!-- ───── Section 3:對話控制 ───── -->
          <section class="settings-section">
            <header class="settings-section__head">
              <h4>對話控制</h4>
            </header>

            <label class="field">
              <span class="field__label">最大輪數</span>
              <input
                  v-model.number="store.config.maxTurns"
                  class="field__input"
                  max="30"
                  min="1"
                  type="number"
              />
              <span class="field__hint">單次對話最多走幾輪工具調用;達到上限自動停止</span>
            </label>
          </section>
        </div>
        <div class="modal__foot">
          <button class="btn-ghost" @click="emit('update:open', false)">取消</button>
          <button class="btn-primary" @click="emit('save')">保存</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal {
  width: min(500px, 92vw);
  background: var(--bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

.modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.modal__head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.x-btn {
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 14px;
}

.x-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.modal__body {
  padding: 18px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

select.field__input {
  cursor: pointer;
  appearance: auto;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}

.settings-section:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.settings-section__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.settings-section__head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.settings-section__hint {
  font-size: 11.5px;
  color: var(--text-muted);
}

.provider-bar {
  display: flex;
  gap: 6px;
  align-items: center;
}

.provider-bar__select {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-size: 13.5px;
  background: var(--bg);
  color: var(--text);
  outline: none;
  cursor: pointer;
}

.provider-bar__select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.12);
}

.icon-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
  border-color: var(--accent);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.icon-btn--danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
  background: #fef2f2;
}

.icon-btn.loading svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.model-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.model-row__select {
  flex: 1;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}

.switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch__track {
  width: 36px;
  height: 20px;
  background: var(--border-strong);
  border-radius: 999px;
  position: relative;
  transition: background 0.18s;
  flex-shrink: 0;
}

.switch__track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 0.18s;
}

.switch input:checked + .switch__track {
  background: var(--accent);
}

.switch input:checked + .switch__track::after {
  transform: translateX(16px);
}

.switch__label {
  font-size: 13.5px;
  color: var(--text);
}

.field__label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field__input {
  padding: 9px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-size: 13.5px;
  font-family: var(--font);
  color: var(--text);
  background: var(--bg);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.field__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.12);
}

.field__hint {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
}

.btn-ghost {
  padding: 8px 14px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 13.5px;
  cursor: pointer;
}

.btn-ghost:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.btn-primary {
  padding: 8px 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.overlay-enter-from, .overlay-leave-to {
  opacity: 0;
}

.overlay-enter-active, .overlay-leave-active {
  transition: opacity 0.18s;
}

.overlay-enter-active .modal, .overlay-leave-active .modal {
  transition: transform 0.18s;
}

.overlay-enter-from .modal {
  transform: translateY(8px) scale(0.98);
}

.overlay-leave-to .modal {
  transform: translateY(8px) scale(0.98);
}
</style>
