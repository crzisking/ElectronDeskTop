<!--
  想法詳情抽屜(docs/21 §回顧)。三段分區 + 原文/AI版切換 + Action Items + 待確認點 +
  附件 + 狀態下拉 + 標籤增減 + 完善/刪除。只有擁有者能改(後端校驗;非擁有者操作會回錯誤)。
-->
<template>
  <el-drawer v-model="open" :title="detail?.title || '想法'" size="480px" @open="onOpen">
    <div v-if="loading" v-loading="true" style="height: 200px"/>
    <template v-else-if="detail">
      <div class="row">
        <el-select :model-value="detail.status" size="small" style="width: 120px" @change="changeStatus">
          <el-option v-for="(l, k) in STATUS_LABEL" :key="k" :label="l" :value="k"/>
        </el-select>
        <el-tag size="small" type="info">{{ TYPE_LABEL[detail.ideaType] }}</el-tag>
        <el-tag :type="detail.visibility === 'dept' ? 'warning' : 'info'" size="small">
          {{ detail.visibility === 'dept' ? '部門' : '自己' }}
        </el-tag>
        <span class="grow"/>
        <el-button
            v-if="detail.refineStatus === 'none' || detail.refineStatus === 'failed'"
            size="small" text type="primary" @click="doRefine"
        >✨完善
        </el-button>
        <el-tag v-else-if="detail.refineStatus === 'pending'" size="small">AI整理中…</el-tag>
      </div>

      <!-- 原文 / AI版 切換 -->
      <el-radio-group v-if="detail.polishedText" v-model="viewMode" class="view-toggle" size="small">
        <el-radio-button value="raw">原文</el-radio-button>
        <el-radio-button value="ai">✨AI版</el-radio-button>
      </el-radio-group>

      <template v-if="viewMode === 'ai' && detail.polishedText">
        <p class="polished">{{ detail.polishedText }}</p>
      </template>
      <template v-else>
        <section class="seg">
          <h4>💡 想法</h4>
          <p>{{ detail.content }}</p>
        </section>
        <section v-if="detail.scene" class="seg">
          <h4>🎯 場景</h4>
          <p>{{ detail.scene }}</p>
        </section>
        <section v-if="detail.expectation" class="seg">
          <h4>✅ 期望</h4>
          <p>{{ detail.expectation }}</p>
        </section>
      </template>

      <section v-if="detail.actionItems.length" class="seg">
        <h4>下一步</h4>
        <ul class="checklist">
          <li v-for="(a, i) in detail.actionItems" :key="i">☐ {{ a }}</li>
        </ul>
      </section>

      <section v-if="detail.aiQuestions.length" class="seg">
        <h4>AI 待確認</h4>
        <ul class="questions">
          <li v-for="(q, i) in detail.aiQuestions" :key="i">{{ q }}</li>
        </ul>
      </section>

      <!-- 標籤 -->
      <section class="seg">
        <h4>標籤</h4>
        <div class="tags">
          <el-tag v-for="t in detail.tags" :key="t" closable size="small" @close="removeTag(t)">{{ t }}</el-tag>
          <el-input
              v-model="newTag" placeholder="+ 標籤" size="small" style="width: 100px"
              @keyup.enter="addTag"
          />
        </div>
      </section>

      <!-- 附件 -->
      <section v-if="detail.attachments.length" class="seg">
        <h4>附件</h4>
        <div class="atts">
          <div v-for="a in detail.attachments" :key="a.id" class="att">
            <img v-if="a.isImage" :src="a.fileUrl" alt="" class="att-img" loading="lazy"/>
            <span class="att-name">{{ a.fileName }}</span>
          </div>
        </div>
      </section>

      <section v-if="detail.activeWindow" class="seg meta">
        <span>當時視窗:{{ detail.activeWindow }}</span>
      </section>

      <div class="footer">
        <el-popconfirm title="確定刪除這條想法?" @confirm="doDelete">
          <template #reference>
            <el-button size="small" text type="danger">刪除</el-button>
          </template>
        </el-popconfirm>
      </div>
    </template>
    <el-empty v-else description="想法不存在或無權查看"/>
  </el-drawer>
</template>

<script lang="ts" setup>
import {computed, ref} from 'vue'
import {ElMessage} from 'element-plus'
import type {IdeaDetail, IdeaStatus} from '@/features/idea-capture/types'
import {STATUS_LABEL, TYPE_LABEL} from '../composables/useIdeaLibrary'
import {ideaLibraryApi} from '../api'

const props = defineProps<{ modelValue: boolean; clientId: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'changed', clientId: string): void
  (e: 'deleted', clientId: string): void
}>()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const detail = ref<IdeaDetail | null>(null)
const loading = ref(false)
const viewMode = ref<'raw' | 'ai'>('raw')
const newTag = ref('')

async function onOpen() {
  if (!props.clientId) return
  loading.value = true
  detail.value = null
  viewMode.value = 'raw'
  try {
    detail.value = await ideaLibraryApi.detail(props.clientId)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}

async function mutate(fn: () => Promise<unknown>, okMsg?: string) {
  try {
    await fn()
    if (okMsg) ElMessage.success(okMsg)
    await onOpen()               // 重載詳情
    emit('changed', props.clientId) // 通知列表刷新
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function changeStatus(status: IdeaStatus) {
  void mutate(() => ideaLibraryApi.patch(props.clientId, {status}))
}

function addTag() {
  const t = newTag.value.trim()
  if (!t) return
  newTag.value = ''
  void mutate(() => ideaLibraryApi.patch(props.clientId, {addTags: [t]}))
}

function removeTag(tag: string) {
  void mutate(() => ideaLibraryApi.patch(props.clientId, {removeTags: [tag]}))
}

function doRefine() {
  void mutate(() => ideaLibraryApi.refine(props.clientId), '已交後台 AI 完善,稍後刷新')
}

async function doDelete() {
  try {
    await ideaLibraryApi.remove(props.clientId)
    ElMessage.success('已刪除')
    emit('deleted', props.clientId)
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
}

.grow {
  flex: 1;
}

.view-toggle {
  margin-bottom: 10px;
}

.seg {
  margin-bottom: 14px;
}

.seg h4 {
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
}

.seg p {
  margin: 0;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.polished {
  margin: 0 0 14px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.checklist, .questions {
  margin: 0;
  padding-left: 4px;
  list-style: none;
  line-height: 1.8;
}

.questions li {
  color: var(--el-text-color-secondary, #909399);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.atts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.att {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  max-width: 100px;
}

.att-img {
  width: 90px;
  height: 90px;
  object-fit: cover;
  border-radius: 6px;
}

.att-name {
  font-size: 11px;
  color: var(--el-text-color-secondary, #909399);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
}

.meta {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}

.footer {
  margin-top: 8px;
}
</style>
