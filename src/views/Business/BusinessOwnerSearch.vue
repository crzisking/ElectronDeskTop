<script setup lang="ts">
/**
 * 尋找業務負責人
 *
 * ── 功能概述 ──────────────────────────────────────────────────────────
 * 用戶輸入業務相關關鍵詞（如「採購審批」「合同簽署」），
 * 系統搜索並展示對應的業務負責人信息。
 *
 * ── 頁面佈局 ──────────────────────────────────────────────────────────
 * ┌─────────────────────────────────────────┐
 * │ 🔍 搜索欄（帶防抖，300ms）             │
 * ├─────────────────────────────────────────┤
 * │ 搜索結果列表                            │
 * │ ┌──────────────────────────────────┐    │
 * │ │ 頭像 | 姓名 | 部門 | 職位       │    │
 * │ │      | 負責範圍 tags            │    │
 * │ │      | 📧 郵箱  📱 電話        │    │
 * │ └──────────────────────────────────┘    │
 * │ ...更多結果                             │
 * └─────────────────────────────────────────┘
 *
 * ── API 接口預留 ─────────────────────────────────────────────────────
 * 搜索功能調用 businessApi.searchOwners()，接口已預留但未連接後端。
 * 後端實現後，只需在 business.api.ts 中填入真實的 HTTP 請求即可。
 */

import {ref} from 'vue'
import {ElMessage} from 'element-plus'
import {Loading, Message, Phone, Search} from '@element-plus/icons-vue'
import type {BusinessOwner} from '@/types/api.types'

// ── 狀態 ──────────────────────────────────────────────────────────
/** 搜索關鍵詞 */
const keyword = ref('')

/** 搜索結果 */
const owners = ref<BusinessOwner[]>([])

/** 是否正在搜索 */
const isSearching = ref(false)

/** 是否已執行過搜索（用於區分「初始狀態」和「無結果」） */
const hasSearched = ref(false)

/** 防抖計時器 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// ── 方法 ──────────────────────────────────────────────────────────

/**
 * 搜索輸入防抖處理
 * 用戶停止輸入 300ms 後才觸發實際搜索，減少不必要的 API 調用
 */
function handleInput() {
  if (debounceTimer) clearTimeout(debounceTimer)

  debounceTimer = setTimeout(() => {
    doSearch()
  }, 300)
}

/**
 * 執行搜索
 *
 * TODO: 接入後端 API（business.api.ts 中已預留接口）
 *
 * 調用示例：
 *   import { useBusinessApi } from '@/api/modules/business.api'
 *   const businessApi = useBusinessApi()
 *   const result = await businessApi.searchOwners(keyword.value)
 *   owners.value = result.owners
 */
async function doSearch() {
  const kw = keyword.value.trim()

  if (!kw) {
    owners.value = []
    hasSearched.value = false
    return
  }

  isSearching.value = true
  hasSearched.value = true

  try {
    // ══════════════════════════════════════════════════════════════
    // TODO: 替換為真實 API 調用
    //
    //   import { useBusinessApi } from '@/api/modules/business.api'
    //   const businessApi = useBusinessApi()
    //   const response = await businessApi.searchOwners(kw)
    //   owners.value = response.owners
    //
    // 目前使用模擬數據，方便開發調試和 UI 驗證
    // ══════════════════════════════════════════════════════════════

    // 模擬 API 延遲
    await new Promise((resolve) => setTimeout(resolve, 500))

    // 模擬搜索結果（開發階段用，接入 API 後刪除）
    owners.value = [
      {
        id: 'mock-1',
        name: '（模擬數據）張三',
        email: 'zhangsan@ichia.com',
        department: '採購部',
        title: '採購經理',
        responsibilities: ['供應商管理', '採購審批', '合同談判'],
        phone: '0912-345-678'
      },
      {
        id: 'mock-2',
        name: '（模擬數據）李四',
        email: 'lisi@ichia.com',
        department: '業務部',
        title: '業務主管',
        responsibilities: ['客戶關係', '業務拓展', '報價審核'],
        phone: '0923-456-789'
      }
    ]
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? '搜索失敗'
    ElMessage.error(`搜索失敗：${msg}`)
    owners.value = []
  } finally {
    isSearching.value = false
  }
}

/**
 * 獲取頭像文字（取姓名最後一個字）
 * 當沒有頭像圖片時，用文字做 fallback
 */
function getAvatarText(name: string): string {
  return name.replace('（模擬數據）', '').slice(-1)
}
</script>

<template>
  <div class="owner-search">
    <!-- ── 搜索欄 ─────────────────────────────────────────── -->
    <div class="search-bar">
      <el-input
        v-model="keyword"
        placeholder="輸入業務關鍵詞搜索負責人（如：採購審批、合同簽署）"
        size="large"
        clearable
        :prefix-icon="Search"
        @input="handleInput"
        @clear="() => { owners = []; hasSearched = false }"
      />
    </div>

    <!-- ── 搜索中 Loading ─────────────────────────────────── -->
    <div v-if="isSearching" class="loading-area">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>搜索中...</span>
    </div>

    <!-- ── 搜索結果列表 ───────────────────────────────────── -->
    <div v-else-if="owners.length > 0" class="result-list">
      <div
        v-for="owner in owners"
        :key="owner.id"
        class="owner-card"
      >
        <!-- 頭像 -->
        <div class="owner-avatar">
          <img
            v-if="owner.avatar"
            :src="owner.avatar"
            :alt="owner.name"
            class="avatar-img"
          />
          <span v-else class="avatar-text">{{ getAvatarText(owner.name) }}</span>
        </div>

        <!-- 信息 -->
        <div class="owner-info">
          <!-- 姓名 + 部門 + 職位 -->
          <div class="owner-header">
            <span class="owner-name">{{ owner.name }}</span>
            <el-tag size="small" type="info">{{ owner.department }}</el-tag>
            <el-tag v-if="owner.title" size="small">{{ owner.title }}</el-tag>
          </div>

          <!-- 負責範圍標籤 -->
          <div class="owner-responsibilities">
            <el-tag
              v-for="resp in owner.responsibilities"
              :key="resp"
              size="small"
              type="success"
              effect="plain"
            >
              {{ resp }}
            </el-tag>
          </div>

          <!-- 聯繫方式 -->
          <div class="owner-contact">
            <span v-if="owner.email" class="contact-item">
              <el-icon><Message /></el-icon>
              {{ owner.email }}
            </span>
            <span v-if="owner.phone" class="contact-item">
              <el-icon><Phone /></el-icon>
              {{ owner.phone }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 無結果 ─────────────────────────────────────────── -->
    <div v-else-if="hasSearched" class="empty-state">
      <el-empty description="未找到相關的業務負責人" />
    </div>

    <!-- ── 初始提示 ───────────────────────────────────────── -->
    <div v-else class="initial-hint">
      <el-icon :size="48" color="#c0c4cc"><Search /></el-icon>
      <p>輸入業務關鍵詞開始搜索</p>
    </div>
  </div>
</template>

<style scoped>
/* ── 搜索容器 ──────────────────────────────────────────── */
.owner-search {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 16px;
  min-height: 0;
}

/* ── 搜索欄 ────────────────────────────────────────────── */
.search-bar {
  flex-shrink: 0;
}

/* ── Loading ───────────────────────────────────────────── */
.loading-area {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--el-text-color-secondary);
}

/* ── 結果列表 ──────────────────────────────────────────── */
.result-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
}

/* ── 負責人卡片 ────────────────────────────────────────── */
.owner-card {
  display: flex;
  gap: 16px;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  transition: box-shadow 0.2s;
}

.owner-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

/* ── 頭像 ──────────────────────────────────────────────── */
.owner-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--el-color-primary-light-7);
  color: var(--el-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  flex-shrink: 0;
  overflow: hidden;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ── 信息區 ────────────────────────────────────────────── */
.owner-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.owner-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.owner-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.owner-responsibilities {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.owner-contact {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

/* ── 空狀態 / 初始提示 ────────────────────────────────── */
.empty-state,
.initial-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  gap: 12px;
}

.initial-hint p {
  color: var(--el-text-color-placeholder);
  font-size: 14px;
  margin: 0;
}
</style>
