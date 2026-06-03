<script lang="ts" setup>
/**
 * 日誌查看器根佈局 — 左側 nav + 右側面板(預留多 tab 擴展)。
 *
 * 兩個 pane:
 *   - logs        系統日誌(原 LogViewerView)
 *   - workCollect 工作採集(從主視窗移過來,密碼保護內才可見)
 *
 * 未來加新管理員頁:在 PANES 陣列裡多塞一個就好,不用改 layout 結構。
 *
 * Pinia / i18n / Element Plus 由 main.ts 注入,configStore + workCollectStore
 * 都可用。WorkCollectStore 必須以 'viewer' 模式 bootstrap,否則會跟主窗口重複訂閱 tick。
 */
import {type Component, onMounted, ref, shallowRef} from 'vue'
import {Document, VideoCamera} from '@element-plus/icons-vue'
import {useConfigStore} from '@/stores/config.store'
import {useWorkCollectStore} from '@/features/work-collect/store'
import LogViewerView from './LogViewerView.vue'
import WorkCollectView from '@/features/work-collect/WorkCollectView.vue'

interface Pane {
  key: string
  label: string
  icon: Component
  component: Component
}

const PANES: Pane[] = [
  {key: 'logs', label: '日誌', icon: Document, component: LogViewerView},
  {key: 'workCollect', label: '工作採集', icon: VideoCamera, component: WorkCollectView},
]

const active = ref<string>(PANES[0].key)
const activeComponent = shallowRef<Component>(PANES[0].component)

function pick(key: string) {
  const p = PANES.find((x) => x.key === key)
  if (!p) return
  active.value = key
  activeComponent.value = p.component
}

const configStore = useConfigStore()
const workStore = useWorkCollectStore()

onMounted(async () => {
  // configStore 在此 window 是獨立 instance(跨 renderer 不共享),要自己 load 一次
  await configStore.loadConfig()
  // viewer 模式:只訂閱 PUSH_WORK_RECORD_NEW,refresh 流水線,不會跟主窗口重複跑 tick
  workStore.bootstrap('viewer')
  // 先 refresh 一次,進來就有資料
  await workStore.refresh().catch(() => undefined)
})
</script>

<template>
  <div class="lv-shell">
    <!-- 左側 nav。預留多 tab 結構,加 pane 不用動 layout -->
    <aside class="lv-nav">
      <div class="lv-nav__brand">管理員工具</div>
      <button
          v-for="p in PANES"
          :key="p.key"
          :class="{'is-active': active === p.key}"
          class="lv-nav__item"
          type="button"
          @click="pick(p.key)"
      >
        <el-icon :size="16">
          <component :is="p.icon"/>
        </el-icon>
        <span>{{ p.label }}</span>
      </button>
    </aside>

    <!-- 右側主面板。用 KeepAlive 把切走的 pane 狀態保留,避免每次切回都重 fetch -->
    <main class="lv-main">
      <keep-alive>
        <component :is="activeComponent" :embedded="true"/>
      </keep-alive>
    </main>
  </div>
</template>

<style>
/* 全局基線:避免 body 預設邊距,讓佈局滿版 */
html, body, #log-viewer-app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
  'Microsoft JhengHei', 'PingFang TC', sans-serif;
  background: #f3f4f6;
  color: #1f2937;
}
</style>

<style scoped>
.lv-shell {
  display: flex;
  height: 100vh;
  width: 100%;
}

.lv-nav {
  width: 160px;
  flex-shrink: 0;
  background: #1f2937;
  color: #e5e7eb;
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lv-nav__brand {
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #9ca3af;
  padding: 0 8px 12px;
  margin-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.lv-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: #d1d5db;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s;
}

.lv-nav__item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.lv-nav__item.is-active {
  background: #2563eb;
  color: #fff;
}

.lv-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
</style>
