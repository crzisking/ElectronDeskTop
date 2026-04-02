<script setup lang="ts">
/**
 * 聯繫人搜索結果列表
 *
 * 展示搜索到的聯繫人卡片，每張卡片包含：
 *  - 頭像（有 avatar URL 則加載，否則顯示姓名首字）
 *  - 姓名、部門、郵箱
 *  - 負責範圍標籤（responsibilities）
 *  - "聯繫他/她"按鈕
 */

import type { Contact } from '@/types/api.types'

defineProps<{
  contacts: Contact[]
  loading: boolean
  keyword: string
}>()

const emit = defineEmits<{
  (e: 'contact', contact: Contact): void
}>()
</script>

<template>
  <div class="result-list">
    <!-- 加載中 -->
    <div v-if="loading" class="state-center">
      <el-icon :size="28" class="spin"><Loading /></el-icon>
      <span>搜索中...</span>
    </div>

    <!-- 有結果 -->
    <template v-else-if="contacts.length > 0">
      <div
        v-for="contact in contacts"
        :key="contact.id"
        class="contact-card"
      >
        <!-- 頭像 -->
        <el-avatar
          :size="48"
          :src="contact.avatar"
          class="contact-avatar"
        >
          {{ contact.name.charAt(0) }}
        </el-avatar>

        <!-- 基本信息 -->
        <div class="contact-info">
          <div class="contact-name">{{ contact.name }}</div>
          <div class="contact-dept">{{ contact.department }}</div>

          <!-- 聯繫方式 -->
          <div class="contact-detail">
            <el-icon :size="12"><Message /></el-icon>
            <span>{{ contact.email }}</span>
            <template v-if="contact.phone">
              <el-icon :size="12" style="margin-left:8px"><Phone /></el-icon>
              <span>{{ contact.phone }}</span>
            </template>
          </div>

          <!-- 負責範圍 -->
          <div class="contact-responsibilities">
            <el-tag
              v-for="resp in contact.responsibilities"
              :key="resp"
              size="small"
              effect="plain"
              style="margin:2px"
            >
              {{ resp }}
            </el-tag>
          </div>
        </div>

        <!-- 聯繫按鈕 -->
        <el-button
          type="primary"
          size="small"
          plain
          @click="emit('contact', contact)"
        >
          聯繫他/她
        </el-button>
      </div>
    </template>

    <!-- 無結果 -->
    <div v-else-if="keyword" class="state-center">
      <el-empty :description="`未找到與「${keyword}」相關的負責人`" :image-size="80" />
    </div>

    <!-- 初始狀態（未搜索） -->
    <div v-else class="state-center state-initial">
      <el-icon :size="40" style="color:var(--el-border-color)"><Search /></el-icon>
      <p>輸入問題關鍵詞開始搜索</p>
    </div>
  </div>
</template>

<script lang="ts">
import { Message, Phone, Search } from '@element-plus/icons-vue'
export default { components: { Message, Phone, Search } }
</script>

<style scoped>
.result-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 狀態居中（加載中、無結果、初始狀態） */
.state-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.state-initial { color: var(--el-text-color-placeholder); }

.spin { animation: rotate 1s linear infinite; color: var(--el-color-primary); }
@keyframes rotate { to { transform: rotate(360deg); } }

/* 聯繫人卡片 */
.contact-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.contact-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 2px 12px rgba(64,158,255,0.1);
}

.contact-avatar {
  flex-shrink: 0;
  font-size: 18px;
  font-weight: bold;
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
}

.contact-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.contact-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.contact-dept {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.contact-detail {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.contact-responsibilities {
  display: flex;
  flex-wrap: wrap;
  margin-top: 4px;
}
</style>
