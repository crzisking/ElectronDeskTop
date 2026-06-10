<!--
  首頁 — 登入後的個人儀表板。

  目前內容:「今日學習建議」(每天 08:00 主進程本地生成,詳見
  electron/main/services/daily-advice/scheduler.ts);版面留了往後加卡片的空間。

  三種狀態:
   - 前置未滿足 → 引導卡(去綁定工作模板 / 去配置 AI ApiKey)
   - 有今日建議 → 建議卡(summary + 2~4 條建議,每條附理由)
   - 前置滿足但還沒生成 → 「立即生成」
-->
<template>
  <div class="home-view">
    <header class="page-header">
      <h2>{{ $t('home.title') }}</h2>
      <span class="date">{{ todayText }}</span>
    </header>

    <section v-loading="loading" class="card advice-card">
      <header class="card-head">
        <h3>📚 {{ $t('home.adviceTitle') }}</h3>
        <div class="head-right">
                    <span v-if="status?.today" class="meta">
                        {{ $t('home.generatedAt', {time: formatTime(status.today.createdAt)}) }}
                    </span>
          <el-button
              v-if="ready"
              :loading="generating"
              size="small"
              @click="onGenerate"
          >
            {{ status?.today ? $t('home.regenerate') : $t('home.generateNow') }}
          </el-button>
        </div>
      </header>

      <!-- 前置未滿足:逐項引導 -->
      <div v-if="status && !ready" class="setup-guide">
        <p>{{ $t('home.setupIntro') }}</p>
        <div :class="{done: status.templateBound}" class="guide-item">
          <span>{{ status.templateBound ? '✅' : '⬜' }}</span>
          <span>{{ $t('home.needTemplate') }}</span>
          <el-button v-if="!status.templateBound" link type="primary" @click="$router.push({name: 'work-collect'})">
            {{ $t('home.goBind') }}
          </el-button>
          <el-tag v-else size="small" type="success">{{ status.templateName }}</el-tag>
        </div>
        <div :class="{done: status.llmConfigured}" class="guide-item">
          <span>{{ status.llmConfigured ? '✅' : '⬜' }}</span>
          <span>{{ $t('home.needLlm') }}</span>
          <el-button v-if="!status.llmConfigured" link type="primary" @click="ui.openSettings('llm')">
            {{ $t('home.goConfig') }}
          </el-button>
        </div>
      </div>

      <!-- 今日建議 -->
      <template v-else-if="content">
        <p class="summary">{{ content.summary }}</p>
        <div v-for="(s, i) in content.suggestions" :key="i" class="sug">
          <div class="sug-title">{{ i + 1 }}. {{ s.title }}</div>
          <div class="sug-detail">{{ s.detail }}</div>
          <div class="sug-reason">💡 {{ s.reason }}</div>
        </div>
        <p v-if="status?.today" class="foot-meta">
          {{ $t('home.basedOn', {n: status.today.recordCount, job: status.today.templateName ?? '-'}) }}
        </p>
      </template>

      <!-- 前置滿足但今天還沒生成 -->
      <el-empty v-else-if="!loading" :description="$t('home.noAdviceYet')" :image-size="64"/>
    </section>

    <!-- 之後的卡片(待辦摘要 / 項目逾期提醒等)往下加 section.card 即可 -->
  </div>
</template>

<script lang="ts" setup>
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {IpcChannels} from '@shared/ipc-channels'
import {useUiStore} from '@/stores/ui.store'
import type {DailyAdviceContent, DailyAdviceRow, DailyAdviceStatus} from '@/types/electron/daily-advice'

const ui = useUiStore()

const loading = ref(false)
const generating = ref(false)
const status = ref<DailyAdviceStatus | null>(null)

/** 兩個前置都滿足才能生成 */
const ready = computed(() => !!status.value?.templateBound && !!status.value?.llmConfigured)

/** contentJson → 結構化;解析失敗回 null(顯示空狀態,不白屏) */
const content = computed<DailyAdviceContent | null>(() => {
  const json = status.value?.today?.contentJson
  if (!json) return null
  try {
    return JSON.parse(json) as DailyAdviceContent
  } catch {
    return null
  }
})

const todayText = new Date().toLocaleDateString()

onMounted(() => {
  void load()
  // 排程生成完成 → 即時刷新(不用重進頁面)
  window.electronAPI.on(IpcChannels.PUSH_DAILY_ADVICE, onPush)
})
onUnmounted(() => {
  window.electronAPI.off(IpcChannels.PUSH_DAILY_ADVICE, onPush)
})

function onPush(...args: unknown[]) {
  const row = args[0] as DailyAdviceRow
  if (status.value) status.value.today = row
}

async function load() {
  loading.value = true
  try {
    const r = await window.electronAPI.dailyAdvice.status()
    if (r.ok) status.value = r.data
    else ElMessage.error(r.error)
  } finally {
    loading.value = false
  }
}

async function onGenerate() {
  generating.value = true
  try {
    const r = await window.electronAPI.dailyAdvice.generate()
    if (r.ok) {
      if (status.value) status.value.today = r.data
    } else {
      ElMessage.error(r.error)
    }
  } finally {
    generating.value = false
  }
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.home-view {
  padding: 24px;
  max-width: 860px;
}

.page-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0;
}

.date {
  color: #909399;
  font-size: 13px;
}

.card {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 10px;
  padding: 18px 20px;
  margin-bottom: 16px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.card-head h3 {
  margin: 0;
  font-size: 15px;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.meta {
  font-size: 12px;
  color: #909399;
}

.setup-guide p {
  color: #606266;
  font-size: 13px;
}

.guide-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 13px;
}

.guide-item.done {
  color: #67c23a;
}

.summary {
  color: #303133;
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 12px;
}

.sug {
  border-left: 3px solid #409eff;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: #fafbfc;
  border-radius: 0 6px 6px 0;
}

.sug-title {
  font-weight: 600;
  font-size: 13px;
  color: #303133;
}

.sug-detail {
  font-size: 13px;
  color: #606266;
  margin-top: 4px;
  line-height: 1.6;
}

.sug-reason {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.foot-meta {
  font-size: 12px;
  color: #c0c4cc;
  margin: 8px 0 0;
}
</style>
