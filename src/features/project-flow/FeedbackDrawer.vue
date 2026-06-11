<!--
  反饋通知抽屜(docs/20 §5.7)。

  全局共用,由側欄紅點圖標觸發開啟;列出未讀反饋,點擊跳轉到 target(報告 / 備忘錄)。
  收到 SignalR project-flow.feedback-new 時 store 會自動 refetch,本組件 reactive 跟著動。
-->
<template>
  <el-drawer v-model="visible" :title="$t('projectFlow.feedback.title')" direction="rtl" size="420px">
    <div v-if="!store.unreadFeedbacks.length" class="empty">
      <el-empty :description="$t('projectFlow.feedback.empty')"/>
    </div>
    <ul v-else class="list">
      <li v-for="f in store.unreadFeedbacks" :key="f.feedbackId" class="item" @click="onClick(f)">
        <div class="from">{{ f.fromUserId }}</div>
        <div class="content">{{ f.content }}</div>
        <div class="meta">
          <el-tag :type="targetTagType(f.targetType)" size="small">{{ f.targetType }}</el-tag>
          <span class="time">{{ formatTime(f.createdAt) }}</span>
        </div>
      </li>
    </ul>
  </el-drawer>
</template>

<script lang="ts" setup>
import {ref} from 'vue'
import {useRouter} from 'vue-router'
import {ElMessage} from 'element-plus'
import {useProjectFlowStore} from './store'
import {projectFlowApi} from './api'
import type {FeedbackResponse} from './types'
import {formatDateTime as formatTime} from '@/shared/utils/format'

const store = useProjectFlowStore()
const router = useRouter()
const visible = ref(false)

function open() {
  visible.value = true
  store.refreshUnread()
}

defineExpose({open})

/**
 * 點未讀反饋:先跳到目標,**到達後才標已讀** —
 * 反過來的話跳轉失敗(目標被刪 / 無權限)這條反饋就從未讀消失,再也找不回。
 * node 類反饋帶 projectId(後端批量解析),直接進對應項目畫布。
 */
async function onClick(f: FeedbackResponse) {
  try {
    if (f.targetType === 'report') {
      await router.push({name: 'report-editor', params: {reportId: String(f.targetId)}})
    } else if (f.targetType === 'node' && f.projectId) {
      await router.push({name: 'project-canvas', params: {projectId: String(f.projectId)}})
    } else {
      // 沒有 projectId(舊資料 / 目標已刪)→ 退到項目列表,但不標已讀,使用者還能再看到
      await router.push({name: 'project-flow'})
      visible.value = false
      return
    }
    visible.value = false
    await projectFlowApi.markFeedbackRead(f.feedbackId)
    await store.refreshUnread()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function targetTagType(t: string) {
  return t === 'report' ? 'success' : 'info'
}
</script>

<style scoped>
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.item {
  padding: 12px;
  border-bottom: 1px solid #e4e7ed;
  cursor: pointer;
}

.item:hover {
  background: #f5f7fa;
}

.from {
  font-weight: 600;
  margin-bottom: 4px;
}

.content {
  color: #606266;
  margin-bottom: 6px;
}

.meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.time {
  color: #909399;
}

.empty {
  padding: 32px 0;
}
</style>
