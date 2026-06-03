<script lang="ts" setup>
/**
 * System Prompt 編輯浮層。
 *
 * 直接綁 store.config.systemPrompt;父層只控 open / close + 觸發保存。
 * 跟 Settings 共用 onSaveSettings handler(在父層)。
 */
import {useAgentStore} from '../store'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'save'): void
}>()

const store = useAgentStore()
</script>

<template>
  <transition name="overlay">
    <div v-if="open" class="overlay" @click.self="emit('update:open', false)">
      <div class="modal modal--lg">
        <div class="modal__head">
          <h3>System Prompt</h3>
          <button class="x-btn" @click="emit('update:open', false)">✕</button>
        </div>
        <div class="modal__body">
          <textarea
              v-model="store.config.systemPrompt"
              class="prompt-area"
              rows="20"
          />
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
  background: var(--bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

.modal--lg {
  width: min(640px, 92vw);
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
}

.modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}

.prompt-area {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text);
  background: var(--bg);
  resize: vertical;
  outline: none;
  line-height: 1.6;
}

.prompt-area:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.12);
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
