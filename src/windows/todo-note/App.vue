<!--
  代辦備注小窗(docs/23 鐵律三的補位)。
  dock 不能打字,備注在這裡編輯:回填當前備注,Ctrl+Enter 存、Esc 關。
-->
<template>
  <div class="wrap" @keydown.esc="close">
    <div class="card">
      <div class="head">
        <span class="lead" aria-hidden="true">📝</span>
        <span class="title" :title="title">{{ title || '備注' }}</span>
      </div>
      <textarea
          ref="areaEl"
          v-model="text"
          class="field"
          placeholder="寫點備注…(Ctrl + Enter 保存)"
          @keydown.enter.ctrl.prevent="save"
      ></textarea>
      <div class="foot">
        <span class="tip">Ctrl + Enter 保存 · Esc 取消</span>
        <span class="grow"></span>
        <button class="btn ghost" type="button" @click="close">取消</button>
        <button class="btn" type="button" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {nextTick, onMounted, onUnmounted, ref} from 'vue'

const api = () => window.electronAPI.todo

const id = ref('')
const title = ref('')
const text = ref('')
const areaEl = ref<HTMLTextAreaElement | null>(null)

function focusField() {
  void nextTick(() => {
    areaEl.value?.focus()
    // 游標移到末尾,方便接著寫
    const el = areaEl.value
    if (el) el.selectionStart = el.selectionEnd = el.value.length
  })
}

/** 載入(或切換到)當前編輯目標,回填備注 */
async function loadTarget() {
  try {
    const r = await api().noteTarget()
    const t = r.ok ? r.data : null
    id.value = t?.id ?? ''
    title.value = t?.title ?? ''
    text.value = t?.note ?? ''
  } catch {
    id.value = ''
    title.value = ''
    text.value = ''
  }
  focusField()
}

async function save() {
  if (!id.value) {
    close()
    return
  }
  const note = text.value.trim()
  try {
    await api().patch(id.value, {note: note || null})
  } catch {
    /* 存失敗也關窗,不擴散 */
  }
  close()
}

function close() {
  void api().hideNote()
}

onMounted(() => {
  void loadTarget()
  // 窗已開時 dock 又點了別條代辦的備注 → 重新回填
  window.electronAPI.on('todo:note-target-changed', loadTarget)
})

onUnmounted(() => {
  window.electronAPI.off('todo:note-target-changed', loadTarget)
})
</script>

<style scoped>
.wrap {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 14px;
  box-sizing: border-box;
}

.card {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px 12px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  box-sizing: border-box;
  -webkit-app-region: drag;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.lead {
  font-size: 16px;
  flex-shrink: 0;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field {
  height: 120px;
  resize: none;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: #1f2329;
  outline: none;
  font-family: inherit;
  -webkit-app-region: no-drag;
}

.field:focus {
  border-color: #7aa0d8;
}

.field::placeholder {
  color: #b6bcc4;
}

.foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tip {
  font-size: 11px;
  color: #b6bcc4;
}

.grow {
  flex: 1;
}

.btn {
  -webkit-app-region: no-drag;
  border: none;
  border-radius: 8px;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
  background: #305a9e;
  color: #fff;
}

.btn:hover {
  background: #29508c;
}

.btn.ghost {
  background: transparent;
  color: #6b7280;
}

.btn.ghost:hover {
  background: rgba(0, 0, 0, 0.05);
}
</style>
