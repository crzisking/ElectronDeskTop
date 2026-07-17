<!--
  代辦錄入小窗(docs/23 鐵律一)。
  整個窗只有一行輸入:Enter 存、Esc 關,2 秒結束。
  🎤 為 P4 語音(Win+H)預留的觸發點,P1 只做占位提示。
-->
<template>
  <div class="wrap" @keydown.esc="close">
    <div class="card">
      <span aria-hidden="true" class="lead">📝</span>
      <input
          ref="inputEl"
          v-model="text"
          class="field"
          placeholder="記錄點什麼…"
          type="text"
          @keydown.enter="save"
      />
      <button class="mic" tabindex="-1" title="語音輸入(Win+H)" type="button" @click="onMic" @mousedown.prevent>
        🎤
      </button>
      <span class="hint">Enter</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {nextTick, onMounted, onUnmounted, ref} from 'vue'

const text = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

function focusField() {
  void nextTick(() => {
    inputEl.value?.focus()
    inputEl.value?.select()
  })
}

async function save() {
  const content = text.value.trim()
  if (!content) {
    close()
    return
  }
  try {
    await window.electronAPI.todo.create({content, source: 'keyboard'})
  } catch {
    /* 存失敗也關窗,不擴散(P1 靜默;後續可加 toast) */
  }
  text.value = ''
  close()
}

function close() {
  void window.electronAPI.todo.hideCapture()
}

/** 觸發系統語音輸入(Win+H):先確保輸入框聚焦,再讓主進程合成 Win+H,語音打進本框 */
function onMic() {
  inputEl.value?.focus()
  void window.electronAPI.todo.triggerVoice()
}

// 每次窗口重新聚焦(快捷鍵再次喚起,窗是 hide 不 destroy)→ 重新聚焦輸入框
function onWindowFocus() {
  focusField()
}

onMounted(() => {
  focusField()
  window.addEventListener('focus', onWindowFocus)
})

onUnmounted(() => {
  window.removeEventListener('focus', onWindowFocus)
})
</script>

<style scoped>
/* 透明窗:body 透明,卡片自己畫圓角 + 陰影(spotlight 觀感) */
.wrap {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  box-sizing: border-box;
}

.card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 60px;
  padding: 0 14px 0 16px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  -webkit-app-region: drag;
}

.lead {
  font-size: 18px;
  flex-shrink: 0;
}

.field {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 17px;
  color: #1f2329;
  -webkit-app-region: no-drag;
}

.field::placeholder {
  color: #b6bcc4;
}

.mic {
  flex-shrink: 0;
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s;
  -webkit-app-region: no-drag;
}

.mic:hover {
  opacity: 1;
}

.hint {
  flex-shrink: 0;
  font-size: 11px;
  color: #b6bcc4;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 5px;
  padding: 2px 6px;
  -webkit-app-region: no-drag;
}
</style>
