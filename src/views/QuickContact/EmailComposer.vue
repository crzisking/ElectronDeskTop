<script setup lang="ts">
/**
 * 郵件編輯器組件
 *
 * 彈出式郵件編輯抽屜，預填收件人和主題，讓用戶撰寫並發送郵件。
 *
 * 功能：
 *  - 預填收件人姓名和郵箱
 *  - 預填郵件主題（基於搜索關鍵詞）
 *  - 正文輸入（純文本）
 *  - 發送按鈕（調用後端 email API）
 *  - 發送成功/失敗提示
 */

import { ref, watch } from 'vue'
import { useContactApi } from '@/api/modules/contact.api'
import { ElMessage } from 'element-plus'
import type { Contact } from '@/types/api.types'

const props = defineProps<{
  /** 是否顯示編輯器（控制 drawer 開合） */
  visible: boolean
  /** 收件人聯繫人對象 */
  contact: Contact | null
  /** 預填主題（來自搜索關鍵詞） */
  defaultSubject?: string
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'sent'): void
}>()

/** 表單數據 */
const form = ref({
  subject: '',
  body: ''
})

/** 是否正在發送 */
const isSending = ref(false)

/** 表單校驗規則 */
const rules = {
  subject: [{ required: true, message: '請填寫郵件主題', trigger: 'blur' }],
  body: [
    { required: true, message: '請填寫郵件正文', trigger: 'blur' },
    { min: 10, message: '正文至少 10 個字', trigger: 'blur' }
  ]
}

/** 表單 ref（用於 validate()） */
const formRef = ref()

/** 抽屜打開時預填主題 */
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      form.value.subject = props.defaultSubject
        ? `關於「${props.defaultSubject}」的詢問`
        : ''
      form.value.body = ''
    }
  }
)

/** 關閉抽屜 */
function handleClose() {
  emit('update:visible', false)
}

/** 發送郵件 */
async function handleSend() {
  if (!props.contact) return

  // 表單校驗
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  isSending.value = true

  try {
    const contactApi = useContactApi()
    await contactApi.sendEmail({
      to: props.contact.email,
      toName: props.contact.name,
      subject: form.value.subject,
      body: form.value.body
    })

    ElMessage.success(`郵件已發送給 ${props.contact.name}`)
    emit('sent')
    handleClose()
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? '發送失敗'
    ElMessage.error(`郵件發送失敗：${msg}`)
  } finally {
    isSending.value = false
  }
}
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="撰寫郵件"
    size="500px"
    direction="rtl"
    :before-close="handleClose"
    @update:model-value="emit('update:visible', $event)"
  >
    <template v-if="contact">
      <!-- 收件人信息展示 -->
      <div class="recipient-info">
        <el-avatar :size="40" :src="contact.avatar">{{ contact.name.charAt(0) }}</el-avatar>
        <div>
          <div class="recipient-name">{{ contact.name }}</div>
          <div class="recipient-email">{{ contact.email }}</div>
        </div>
      </div>

      <el-divider />

      <!-- 郵件表單 -->
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        class="email-form"
      >
        <el-form-item label="主題" prop="subject">
          <el-input v-model="form.subject" placeholder="請輸入郵件主題" clearable />
        </el-form-item>

        <el-form-item label="正文" prop="body">
          <el-input
            v-model="form.body"
            type="textarea"
            :rows="10"
            placeholder="您好，

...

謝謝！"
            resize="none"
          />
        </el-form-item>
      </el-form>
    </template>

    <!-- 底部操作按鈕 -->
    <template #footer>
      <div class="drawer-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          :loading="isSending"
          :icon="Promotion"
          @click="handleSend"
        >
          {{ isSending ? '發送中...' : '發送郵件' }}
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script lang="ts">
import { Promotion } from '@element-plus/icons-vue'
export default { components: { Promotion } }
</script>

<style scoped>
.recipient-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0 16px;
}

.recipient-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.recipient-email {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.email-form {
  display: flex;
  flex-direction: column;
}

.email-form :deep(.el-form-item:last-child) {
  flex: 1;
}

.email-form :deep(.el-textarea) {
  height: 100%;
}

.email-form :deep(.el-textarea__inner) {
  height: 100% !important;
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
