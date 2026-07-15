<!--
  靈感速記速記小窗(docs/21 §2)。
  引導式三段結構(想法 / 場景 / 期望),問題隨類型切換;附件走貼圖 / 拖放 / 選檔(皆 base64)。
  [保存] 純存;[✨AI完善] 存 + 交後台 AI(不等待)。Esc 關(草稿保留,窗只隱藏不銷毀)。
-->
<template>
  <div class="idea" @paste="onPaste" @dragover.prevent @drop.prevent="onDrop">
    <!-- 標題列(可拖動) -->
    <header class="bar">
      <span class="bar-title">💡 靈光一閃</span>
      <button class="bar-close" title="關閉 (Esc)" @click="close">✕</button>
    </header>

    <div class="body">
      <!-- 類型 -->
      <div class="types">
        <button
            v-for="t in IDEA_TYPES" :key="t"
            :class="{active: ideaType === t}" class="type-chip" type="button"
            @click="ideaType = t"
        >{{ GUIDE_BY_TYPE[t].label }}
        </button>
      </div>

      <!-- 三段引導 -->
      <label class="field-label">💡 一句話說想法<span class="req">*</span></label>
      <textarea
          ref="contentEl" v-model="content" :placeholder="guide.contentEg" class="field"
          rows="2" @input="warned = false"
      />

      <label class="field-label">🎯 {{ guide.sceneQ }}<span class="hint">(建議填)</span></label>
      <textarea v-model="scene" :placeholder="guide.sceneEg" class="field" rows="2" @input="warned = false"/>

      <label class="field-label">✅ {{ guide.expectQ }}<span class="hint">(可空)</span></label>
      <textarea v-model="expectation" :placeholder="guide.expectEg" class="field" rows="2"/>

      <!-- 標籤 -->
      <input v-model="tagsInput" class="tags-input" placeholder="標籤(逗號分隔,可空)"/>

      <!-- 附件 -->
      <div class="attachments">
        <button class="att-add" type="button" @click="pickFiles">📎 附件</button>
        <span class="att-hint">或直接 Ctrl+V 貼圖 / 拖放檔案</span>
        <input ref="fileEl" hidden multiple type="file" @change="onPick"/>
      </div>
      <div v-if="attachments.length" class="att-list">
        <span v-for="(a, i) in attachments" :key="i" class="att-item">
          <img v-if="a.preview" :src="a.preview" alt="" class="att-thumb"/>
          <span class="att-name">{{ a.fileName }}</span>
          <button class="att-x" type="button" @click="attachments.splice(i, 1)">✕</button>
        </span>
      </div>
    </div>

    <!-- 底部:可見範圍 + 保存 -->
    <footer class="foot">
      <div class="vis">
        <label :class="{on: visibility === 'private'}"><input v-model="visibility" type="radio"
                                                              value="private"/>自己</label>
        <label :class="{on: visibility === 'dept'}"><input v-model="visibility" type="radio" value="dept"/>部門</label>
      </div>
      <span v-if="warnMsg" class="warn">{{ warnMsg }}</span>
      <span v-if="error" class="err">{{ error }}</span>
      <div class="actions">
        <button :disabled="saving" class="btn ai" type="button" @click="save(true)">✨AI完善</button>
        <button :disabled="saving" class="btn primary" type="button" @click="save(false)">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </footer>
  </div>
</template>

<script lang="ts" setup>
import {computed, nextTick, onMounted, onUnmounted, ref} from 'vue'
import {GUIDE_BY_TYPE, guideFor, IDEA_TYPES, normalizeTags, softWarn, validateCreate} from '@shared/idea-capture/guided'
import type {IdeaCreateMeta, IdeaDraftAttachment, IdeaType, IdeaVisibility} from '@shared/types/idea-capture.types'

interface DraftAtt extends IdeaDraftAttachment {
  preview?: string // 圖片縮略 dataURL
}

const api = () => window.electronAPI.ideaCapture

const ideaType = ref<IdeaType>('improve')
const content = ref('')
const scene = ref('')
const expectation = ref('')
const tagsInput = ref('')
const visibility = ref<IdeaVisibility>('private')
const attachments = ref<DraftAtt[]>([])
const activeWindow = ref('')

const saving = ref(false)
const error = ref('')
const warned = ref(false)
const contentEl = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)

const guide = computed(() => guideFor(ideaType.value))
const warnMsg = computed(() => (warned.value ? softWarn({scene: scene.value}) : null))

// ── 附件 ──
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result)
      resolve(s.slice(s.indexOf(',') + 1)) // 去掉 data:...;base64, 前綴
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

async function addFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (!file || file.size === 0) continue
    try {
      const base64 = await readAsBase64(file)
      const isImage = file.type.startsWith('image/')
      attachments.value.push({
        fileName: file.name || (isImage ? `貼圖-${stamp()}.png` : `檔案-${stamp()}`),
        contentType: file.type || 'application/octet-stream',
        base64,
        preview: isImage ? `data:${file.type};base64,${base64}` : undefined,
      })
    } catch {
      error.value = `附件讀取失敗:${file.name}`
    }
  }
}

function pickFiles() {
  fileEl.value?.click()
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) void addFiles(input.files)
  input.value = '' // 允許再次選同一檔
}

function onDrop(e: DragEvent) {
  if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files)
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const imgs: File[] = []
  for (const it of Array.from(items)) {
    if (it.kind === 'file') {
      const f = it.getAsFile()
      if (f) imgs.push(f)
    }
  }
  if (imgs.length) {
    e.preventDefault()
    void addFiles(imgs)
  }
}

// ── 保存 ──
async function save(wantAI: boolean) {
  if (saving.value) return
  error.value = ''
  const meta: Pick<IdeaCreateMeta, 'content' | 'ideaType' | 'visibility'> = {
    content: content.value, ideaType: ideaType.value, visibility: visibility.value,
  }
  const v = validateCreate(meta)
  if (!v.ok) {
    error.value = v.error!
    return
  }
  // 軟提醒:場景空先提示一次,再按才存(不阻塞、只提醒一次)
  if (!warned.value && softWarn({scene: scene.value})) {
    warned.value = true
    return
  }

  saving.value = true
  try {
    const payload: IdeaCreateMeta = {
      clientId: crypto.randomUUID(),
      ideaType: ideaType.value,
      visibility: visibility.value,
      content: content.value.trim(),
      scene: scene.value.trim() || undefined,
      expectation: expectation.value.trim() || undefined,
      tags: normalizeTags(tagsInput.value),
      activeWindow: activeWindow.value || undefined,
      wantAI,
    }
    const files: IdeaDraftAttachment[] = attachments.value.map((a) => ({
      fileName: a.fileName, contentType: a.contentType, base64: a.base64,
    }))
    const r = await api().create(payload, files)
    if (!r.ok) throw new Error(r.error)
    resetAndClose()
  } catch (e) {
    error.value = (e as Error).message || '保存失敗,請重試'
  } finally {
    saving.value = false
  }
}

function resetAndClose() {
  content.value = ''
  scene.value = ''
  expectation.value = ''
  tagsInput.value = ''
  attachments.value = []
  visibility.value = 'private'
  ideaType.value = 'improve'
  warned.value = false
  error.value = ''
  void api().hideCapture()
}

function close() {
  void api().hideCapture()
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// ── 每次喚起:抓一次上下文 + 聚焦(窗持久,靠 focus 事件刷新) ──
async function onFocus() {
  try {
    const r = await api().getContext()
    if (r.ok) activeWindow.value = r.data.activeWindow
  } catch { /* 忽略 */
  }
  void nextTick(() => contentEl.value?.focus())
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void save(false)
  }
}

onMounted(() => {
  window.addEventListener('focus', onFocus)
  window.addEventListener('keydown', onKeydown)
  void onFocus()
})
onUnmounted(() => {
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style>
html, body, #idea-app {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
</style>

<style scoped>
.idea {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  color: #303133;
  font-size: 13px;
  font-family: system-ui, "Microsoft JhengHei", sans-serif;
}

.bar {
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #ebeef5;
}

.bar-title {
  font-weight: 600;
  color: #606266;
}

.bar-close {
  -webkit-app-region: no-drag;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #909399;
  font-size: 14px;
}

.bar-close:hover {
  color: #f56c6c;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
}

.types {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.type-chip {
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 14px;
  padding: 3px 12px;
  cursor: pointer;
  color: #606266;
}

.type-chip.active {
  background: #ecf5ff;
  border-color: #409eff;
  color: #409eff;
}

.field-label {
  display: block;
  margin: 8px 0 4px;
  color: #606266;
  font-size: 12.5px;
}

.req {
  color: #f56c6c;
  margin-left: 2px;
}

.hint {
  color: #c0c4cc;
  margin-left: 4px;
}

.field, .tags-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 7px 9px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
}

.field:focus, .tags-input:focus {
  border-color: #409eff;
}

.tags-input {
  margin-top: 8px;
}

.attachments {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.att-add {
  border: 1px dashed #c0c4cc;
  background: transparent;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  color: #606266;
}

.att-add:hover {
  border-color: #409eff;
  color: #409eff;
}

.att-hint {
  color: #c0c4cc;
  font-size: 12px;
}

.att-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.att-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 2px 6px;
  max-width: 180px;
}

.att-thumb {
  width: 22px;
  height: 22px;
  object-fit: cover;
  border-radius: 3px;
}

.att-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.att-x {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #c0c4cc;
}

.att-x:hover {
  color: #f56c6c;
}

.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid #ebeef5;
  background: #fafbfc;
  flex-wrap: wrap;
}

.vis label {
  cursor: pointer;
  color: #909399;
  margin-right: 8px;
}

.vis label.on {
  color: #409eff;
}

.warn {
  color: #e6a23c;
  font-size: 12px;
}

.err {
  color: #f56c6c;
  font-size: 12px;
}

.actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.btn {
  border: 1px solid #dcdfe6;
  background: #fff;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  color: #606266;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.ai:hover {
  border-color: #409eff;
  color: #409eff;
}

.btn.primary {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}

.btn.primary:hover {
  background: #66b1ff;
}
</style>
