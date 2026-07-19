<!--
  代辦頂部 dock(docs/23 §3)。
  平時**全透明看不見 + 滑鼠穿透**(主進程 setIgnoreMouseEvents);滑鼠移到螢幕頂部正中一小段 →
  面板用 CSS transform **平滑滑下**(窗口不縮放,故動畫連續、無 px 提示、內容完整);
  離開面板 → 滑回 + 恢復穿透。資料本地,PUSH_TODO_CHANGED 即時刷新。
-->
<template>
  <div class="root">
    <div ref="panelEl" :class="{ open: expanded }" class="panel">
      <!-- 操作區(和卡片分開) -->
      <div class="bar">
        <span class="bar-title">今天</span>
        <span class="bar-date">{{ dateLabel }}</span>
        <span class="grow"></span>
        <button class="op" type="button" @click="openCapture">＋ 快速記錄 <span class="kbd">Ctrl /</span></button>
      </div>

      <!-- 顯示區:竖向卡片列表(緊湊;第一條為焦點,加左邊框) -->
      <div class="lane">
        <div v-if="!active.length && !inbox.length" class="empty">
          按 <span class="kbd">Ctrl /</span> 記一條,或點右上「快速記錄」
        </div>

        <div
            v-for="(t, i) in active"
            :key="t.id"
            :class="[urgency(t), {focus: i === 0, editing: editingId === t.id}]"
            class="card"
            @click="toggleEdit(t.id)"
        >
          <div class="row1">
            <span class="circle" title="完成" @click.stop="complete(t.id)"></span>
            <span class="title">{{ t.title }}</span>
            <span :class="urgency(t)" class="time">
              <template v-if="t.aiState === 'pending'">分析中…</template>
              <template v-else>{{ fmtTime(t.dueAt) }}</template>
            </span>
            <span v-if="t.aiState === 'done' && t.priority >= 1" :class="'p' + t.priority"
                  class="pri">{{ priLabel(t.priority) }}</span>
          </div>
          <div class="row2">
            <span v-if="t.note" class="note-mark" title="有備注">📝</span>
            <span class="hint">{{ t.aiHint ? '✨ ' + t.aiHint : '' }}</span>
            <span class="grow"></span>
            <button class="mini" title="延後到明天" type="button" @click.stop="snooze(t.id)">延後</button>
          </div>

          <!-- 漸進式完善:隔天仍沒截止的舊任務,輕提補時間 -->
          <div v-if="needsEnrich(t)" class="enrich" @click.stop>
            <span class="e-q">✨ 補個時間?</span>
            <button class="chip" type="button" @click="setDue(t.id, 'today')">今天</button>
            <button class="chip" type="button" @click="setDue(t.id, 'tomorrow')">明天</button>
            <button class="chip muted" type="button" @click="dismissEnrich(t.id)">不用</button>
          </div>

          <!-- 就地編輯(點卡片展開):純點選,不打字 -->
          <div v-if="editingId === t.id" class="edit" @click.stop>
            <div class="e-line">
              <span class="e-label">截止</span>
              <button :class="{ on: sameDay(t.dueAt, 0) }" class="chip" type="button" @click="setDue(t.id, 'today')">
                今天
              </button>
              <button :class="{ on: sameDay(t.dueAt, 1) }" class="chip" type="button" @click="setDue(t.id, 'tomorrow')">
                明天
              </button>
              <button class="chip" type="button" @click="setDue(t.id, 'friday')">本週五</button>
              <button :class="{ on: t.dueAt == null }" class="chip" type="button" @click="setDue(t.id, 'clear')">無
              </button>
            </div>
            <div class="e-line">
              <span class="e-label">優先</span>
              <button :class="{ on: t.priority === 2 }" class="chip" type="button" @click="setPriority(t.id, 2)">高
              </button>
              <button :class="{ on: t.priority === 1 }" class="chip" type="button" @click="setPriority(t.id, 1)">中
              </button>
              <button :class="{ on: t.priority === 0 }" class="chip" type="button" @click="setPriority(t.id, 0)">低
              </button>
            </div>
            <div class="e-line">
              <span class="e-label">備注</span>
              <button class="chip" type="button" @click="openNote(t.id)">{{ t.note ? '編輯' : '添加' }}</button>
              <span v-if="t.note" class="note-preview" :title="t.note">{{ t.note }}</span>
            </div>
          </div>
        </div>

        <!-- 收件箱卡 -->
        <div v-if="inbox.length" class="card inbox">
          <div class="inbox-h">收件箱 · 待整理</div>
          <div v-for="t in inbox.slice(0, 4)" :key="t.id" class="inbox-item">{{ t.title }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {computed, onMounted, onUnmounted, ref} from 'vue'
import type {Todo, TodoCounts} from '@shared/types/todo.types'
import * as du from './dock-utils'

const api = () => window.electronAPI.todo

const expanded = ref(false)
const todos = ref<Todo[]>([])
const counts = ref<TodoCounts>({today: 0, inbox: 0, active: 0})
const now = ref(Date.now())
const panelEl = ref<HTMLElement | null>(null)

async function call<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T | null> {
  try {
    const r = await p
    return r.ok ? r.data : null
  } catch {
    return null
  }
}

async function load() {
  now.value = Date.now()
  const [list, cnt] = await Promise.all([call<Todo[]>(api().listOpen()), call<TodoCounts>(api().counts())])
  todos.value = list ?? []
  if (cnt) counts.value = cnt
}

// ── 分組(service 已按 dueAt 升冪 + 優先級降冪排好;第一條 = 焦點)──
const active = computed(() => todos.value.filter((t) => t.status === 'active'))
const inbox = computed(() => todos.value.filter((t) => t.status === 'inbox'))

// ── 緊急度 / 顯示(純邏輯在 dock-utils,這裡只把 now.value 傳進去)──
const urgency = (t: Todo) => du.urgency(t, now.value)
const fmtTime = (due: number | null) => du.fmtTime(due, now.value)
const priLabel = du.priLabel
const dateLabel = computed(() => du.formatDateLabel(now.value))

// ── 動作 ──
async function complete(id: string) {
  await api().complete(id)  // 廣播回來會觸發 load
}

async function snooze(id: string) {
  const d = new Date(now.value + 86400000)
  d.setHours(9, 0, 0, 0)
  await api().snooze(id, d.getTime())
}

function openCapture() {
  void api().openCapture()
}

// ── 就地編輯(點卡片展開;純點選)──
const editingId = ref('')

function toggleEdit(id: string) {
  editingId.value = editingId.value === id ? '' : id
}

async function setDue(id: string, preset: string) {
  await api().patch(id, {dueAt: du.presetDue(preset, now.value), dueKind: 'none'})
}

async function setPriority(id: string, p: number) {
  await api().patch(id, {priority: p as 0 | 1 | 2})
}

/** 備注:dock 不能打字 → 開可聚焦備注小窗編輯 */
function openNote(id: string) {
  void api().openNote(id)
}

/** dueAt 是否等於今天(offset 0)/ 明天(offset 1) —— 給編輯 chip 高亮用 */
const sameDay = (dueAt: number | null, offset: number) => du.sameDay(dueAt, offset, now.value)

// ── 漸進式完善:隔天仍無截止的舊任務,輕提一次 ──
const needsEnrich = (t: Todo) => du.needsEnrich(t, now.value)

async function dismissEnrich(id: string) {
  await api().patch(id, {enrichPromptedAt: now.value})
}

// ── 懸停偵測(整窗 mousemove;頂部正中一小段觸發,劃過不觸發)──
const TRIGGER_Y = 6
const CENTER_HALF = 240
let enterTimer: number | undefined

function expand() {
  expanded.value = true
  api().dockSetInteractive(true)
}

function collapse() {
  if (enterTimer) {
    window.clearTimeout(enterTimer)
    enterTimer = undefined
  }
  if (!expanded.value) return
  expanded.value = false
  api().dockSetInteractive(false)
}

function onMove(e: MouseEvent) {
  const cx = window.innerWidth / 2
  if (!expanded.value) {
    const atTop = e.clientY <= TRIGGER_Y && Math.abs(e.clientX - cx) <= CENTER_HALF
    if (atTop) {
      if (!enterTimer) enterTimer = window.setTimeout(() => {
        enterTimer = undefined
        expand()
      }, 150)
    } else if (enterTimer) {
      window.clearTimeout(enterTimer)
      enterTimer = undefined
    }
    return
  }
  // 已展開:離開面板矩形就收起(留一點邊距防抖)
  const r = panelEl.value?.getBoundingClientRect()
  if (!r) return
  const m = 16
  const inside = e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m
  if (!inside) collapse()
}

// ── 生命週期 ──
const onChanged = () => void load()
let timer: number | undefined

onMounted(() => {
  void load()
  window.electronAPI.on('todo:push:changed', onChanged)
  window.addEventListener('mousemove', onMove)
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})

onUnmounted(() => {
  window.electronAPI.off('todo:push:changed', onChanged)
  window.removeEventListener('mousemove', onMove)
  if (timer) window.clearInterval(timer)
  if (enterTimer) window.clearTimeout(enterTimer)
})
</script>

<style scoped>
.root {
  width: 100%;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  overflow: hidden;
  color: #1f2329;
}

/* 面板:平時滑到螢幕上方外(看不見),.open 時滑下 */
.panel {
  width: 520px;
  max-width: 94vw;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-top: none;
  border-radius: 0 0 16px 16px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  transform: translateY(-110%);
  opacity: 0;
  transition: transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.18s ease;
}

.panel.open {
  transform: translateY(0);
  opacity: 1;
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: #fafbfc;
}

.bar-title {
  font-size: 15px;
  font-weight: 500;
}

.bar-date {
  font-size: 12px;
  color: #9aa0a6;
}

.grow {
  flex: 1;
}

.op {
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  border-radius: 8px;
  height: 30px;
  padding: 0 12px;
  font-size: 12.5px;
  cursor: pointer;
  color: #2f6fed;
}

.op:hover {
  background: #f2f6ff;
}

.kbd {
  font-size: 11px;
  color: #9aa0a6;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 5px;
  padding: 1px 5px;
}

/* 竖向卡片列表:紧凑,滚轮滚,隐藏滚动条 */
.lane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  max-height: 62vh;
  overflow-y: auto;
  scrollbar-width: none;
}

.lane::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.empty {
  color: #9aa0a6;
  font-size: 13px;
  padding: 8px 4px;
}

.card {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  padding: 7px 12px;
  background: #fff;
  cursor: pointer;
}

.card.focus {
  border-color: rgba(216, 74, 58, 0.45);
}

.card.overdue {
  border-color: rgba(216, 74, 58, 0.4);
}

.row1 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid #c7ccd3;
  cursor: pointer;
  flex-shrink: 0;
}

.circle:hover {
  border-color: #34a853;
  background: rgba(52, 168, 83, 0.12);
}

.title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: 12px;
  color: #6b7280;
  flex-shrink: 0;
}

.time.overdue {
  color: #d84a3a;
}

.time.today {
  color: #c77d11;
}

.pri {
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}

.pri.p2 {
  color: #d84a3a;
}

.pri.p1 {
  color: #c77d11;
}

/* 第二行:AI 提示(左,單行省略)+ 延後(右);對齊標題讓開圓圈 */
.row2 {
  display: flex;
  align-items: center;
  padding-left: 24px;
}

.hint {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  line-height: 1.3;
  color: #5b5fd6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini {
  border: none;
  background: transparent;
  color: #9aa0a6;
  font-size: 12px;
  cursor: pointer;
  padding: 1px 4px;
}

.mini:hover {
  color: #2f6fed;
}

/* 就地編輯 / 漸進式完善:純點選 chip */
.enrich {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 24px;
}

.e-q {
  font-size: 11.5px;
  color: #5b5fd6;
}

.edit {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-left: 24px;
  margin-top: 2px;
}

.e-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.e-label {
  font-size: 11px;
  color: #9aa0a6;
  width: 28px;
  flex-shrink: 0;
}

.chip {
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  border-radius: 12px;
  font-size: 11px;
  padding: 2px 9px;
  cursor: pointer;
  color: #4b5563;
}

.chip:hover {
  background: #f2f6ff;
  border-color: #2f6fed;
  color: #2f6fed;
}

.chip.on {
  background: #2f6fed;
  border-color: #2f6fed;
  color: #fff;
}

.chip.muted {
  color: #9aa0a6;
}

/* 備注:編輯行的預覽 + 卡片上的小標記 */
.note-preview {
  font-size: 11px;
  color: #8a94a6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.note-mark {
  font-size: 11px;
  flex-shrink: 0;
  opacity: 0.7;
}

.card.editing {
  border-color: #c9d6f5;
  background: #fcfdff;
}

.card.inbox {
  width: 100%;
  box-sizing: border-box;
  border-style: dashed;
  background: #fafbfc;
}

.inbox-h {
  font-size: 11px;
  color: #9aa0a6;
  margin-bottom: 4px;
}

.inbox-item {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
