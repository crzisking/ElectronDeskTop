<script lang="ts" setup>
/**
 * Agent 對話輸入框 — composer 區域。
 *
 * v-model 雙向綁文字內容,running 狀態下變紅色「中止」按鈕。
 * Enter 發送 / Shift+Enter 換行 由本檔處理,父層只收事件。
 */
import {ref} from 'vue'

const props = defineProps<{
  /** v-model 綁的輸入文字 */
  modelValue: string
  /** 是否可發送(文字非空 + provider 就緒) */
  canSend: boolean
  /** AI 是否正在跑(true 切換成「中止」按鈕) */
  isRunning: boolean
  /** textarea 是否禁用(通常跟 isRunning 一致) */
  disabled: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'send'): void
  (e: 'abort'): void
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)

/** 父層通過 ref 拿到 → focus(),用於新對話建好後自動聚焦 */
defineExpose({
  focus: () => textareaRef.value?.focus(),
})

function onInput(evt: Event): void {
  emit('update:modelValue', (evt.target as HTMLTextAreaElement).value)
}

function onKeydown(evt: KeyboardEvent): void {
  if (evt.key === 'Enter' && !evt.shiftKey && !evt.isComposing) {
    evt.preventDefault()
    if (props.canSend && !props.isRunning) emit('send')
  }
}
</script>

<template>
  <footer class="composer">
    <div class="composer__wrap">
      <textarea
          ref="textareaRef"
          :disabled="disabled"
          :value="modelValue"
          class="composer__input"
          placeholder="傳訊息給 AI Agent...(Enter 發送,Shift+Enter 換行)"
          rows="1"
          @input="onInput"
          @keydown="onKeydown"
      />
      <button
          v-if="isRunning"
          class="composer__btn composer__btn--stop"
          title="中止"
          @click="emit('abort')"
      >
        <svg fill="currentColor" height="16" viewBox="0 0 24 24" width="16">
          <rect height="12" rx="2" width="12" x="6" y="6"/>
        </svg>
      </button>
      <button
          v-else
          :disabled="!canSend"
          class="composer__btn"
          title="發送"
          @click="emit('send')"
      >
        <svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"
             stroke-width="2.4" viewBox="0 0 24 24" width="16">
          <line x1="12" x2="12" y1="19" y2="5"/>
          <polyline points="5 12 12 5 19 12"/>
        </svg>
      </button>
    </div>
    <div class="composer__hint">
      AI Agent 可能會出錯,涉及刪除 / 覆寫請仔細確認。
    </div>
  </footer>
</template>

<style scoped>
.composer {
  flex-shrink: 0;
  padding: 12px 24px 18px;
  background: var(--bg);
  border-top: 1px solid var(--border);
}

.composer__wrap {
  max-width: 780px;
  margin: 0 auto;
  position: relative;
  display: flex;
  align-items: flex-end;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.composer__wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.12);
}

.composer__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  padding: 14px 14px 14px 18px;
  font-family: var(--font);
  font-size: 14.5px;
  color: var(--text);
  line-height: 1.55;
  max-height: 200px;
  min-height: 24px;
}

.composer__input::placeholder {
  color: var(--text-muted);
}

.composer__input:disabled {
  opacity: 0.5;
}

.composer__btn {
  width: 32px;
  height: 32px;
  margin: 8px 8px 8px 0;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, opacity 0.15s;
  flex-shrink: 0;
}

.composer__btn:hover {
  background: var(--accent-hover);
}

.composer__btn:disabled {
  background: var(--bg-active);
  color: var(--text-faint);
  cursor: not-allowed;
}

.composer__btn--stop {
  background: var(--danger);
}

.composer__btn--stop:hover {
  background: #c93737;
}

.composer__hint {
  max-width: 780px;
  margin: 8px auto 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
