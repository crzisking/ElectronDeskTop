<script setup lang="ts">
/**
 * 快速聯繫頁面
 *
 * 完整流程：
 *  1. 用戶輸入問題關鍵詞
 *  2. 防抖後調用搜索 API，顯示聯繫人結果
 *  3. 用戶點擊"聯繫他/她"
 *  4. 彈出郵件編輯器（右側 Drawer）
 *  5. 填寫正文並發送
 *  6. 顯示成功提示
 */

import { ref } from 'vue'
import { useContactApi } from '@/api/modules/contact.api'
import { ElMessage } from 'element-plus'
import ContactSearchBar from './ContactSearchBar.vue'
import ContactResultList from './ContactResultList.vue'
import EmailComposer from './EmailComposer.vue'
import type { Contact } from '@/types/api.types'

/** 搜索關鍵詞（傳給 ContactResultList 用於顯示"未找到XXX相關的..."） */
const keyword = ref('')
/** 搜索結果列表 */
const contacts = ref<Contact[]>([])
/** 是否正在搜索 */
const isSearching = ref(false)

/** 是否顯示郵件編輯器 */
const emailVisible = ref(false)
/** 當前選中的聯繫人（準備發送郵件） */
const selectedContact = ref<Contact | null>(null)

/**
 * 執行搜索
 * 由 ContactSearchBar 的 search 事件觸發（已防抖）
 */
async function handleSearch(kw: string) {
  keyword.value = kw

  if (!kw) {
    contacts.value = []
    return
  }

  isSearching.value = true
  try {
    const contactApi = useContactApi()
    contacts.value = await contactApi.searchContacts(kw)
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? '搜索失敗'
    ElMessage.error(`搜索失敗：${msg}`)
    contacts.value = []
  } finally {
    isSearching.value = false
  }
}

/**
 * 用戶點擊"聯繫他/她"
 * 打開郵件編輯器，預填主題
 */
function handleContact(contact: Contact) {
  selectedContact.value = contact
  emailVisible.value = true
}

/** 郵件發送成功回調 */
function handleEmailSent() {
  emailVisible.value = false
  selectedContact.value = null
}
</script>

<template>
  <div class="contact-view">
    <!-- 頁面頭部 -->
    <div class="page-header">
      <h2 class="page-title">快速聯繫</h2>
      <p class="page-subtitle">搜索問題負責人，一鍵發送郵件聯繫</p>
    </div>

    <!-- 搜索欄 -->
    <ContactSearchBar :loading="isSearching" @search="handleSearch" />

    <!-- 搜索結果 -->
    <ContactResultList
      :contacts="contacts"
      :loading="isSearching"
      :keyword="keyword"
      @contact="handleContact"
    />

    <!-- 郵件編輯器（右側抽屜） -->
    <EmailComposer
      v-model:visible="emailVisible"
      :contact="selectedContact"
      :default-subject="keyword"
      @sent="handleEmailSent"
    />
  </div>
</template>

<style scoped>
.contact-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  box-sizing: border-box;
  gap: 20px;
}

.page-header { flex-shrink: 0; }
.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin: 0 0 4px;
}
.page-subtitle {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0;
}
</style>
