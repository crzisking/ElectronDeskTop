<script setup lang="ts">
/**
 * 登錄頁面
 *
 * 對接 Portal OAuth 登錄接口：
 *   POST /api/portal/oauth/login
 *   body: { userName, password }
 *
 * 登錄成功後跳轉到統一平台首頁。
 */

import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()

/** 開發環境自動登錄：將 env 值填入表單，再走正常登錄流程 */
onMounted(() => {
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_AUTO_LOGIN === 'true') {
    const username = import.meta.env.VITE_DEV_USERNAME
    const password = import.meta.env.VITE_DEV_PASSWORD
    console.log('[Login] 開發環境自動填入帳號：', username)
    if (username && password) {
      form.userName = username
      form.password = password
      handleLogin()
    }
  }
})

/** 表單 ref（用於手動觸發驗證） */
const formRef = ref<FormInstance>()

/** 表單數據 */
const form = reactive({
  userName: '',
  password: ''
})

/** 前端基礎校驗規則 */
const rules: FormRules = {
  userName: [
    { required: true, message: '請輸入工號', trigger: 'blur' },
    { min: 2, message: '工號格式不正確', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '請輸入密碼', trigger: 'blur' },
    { min: 1, message: '密碼不能為空', trigger: 'blur' }
  ]
}

/** 登錄中狀態（控制按鈕 loading） */
const loading = ref(false)

/** 錯誤提示（接口返回的錯誤信息） */
const errorMsg = ref('')

/**
 * 提交登錄
 * 1. 前端校驗
 * 2. 調用 authStore.login()（調用後端接口 + 存 Token）
 * 3. 成功跳轉，失敗顯示錯誤
 */
async function handleLogin() {
  // 觸發 el-form 驗證，不通過則中止
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  errorMsg.value = ''

  try {
    await authStore.login(form.userName, form.password)
    // 登錄成功 → 跳轉首頁
    await router.push({name: 'unified-platform'})
  } catch (err: unknown) {
    // 顯示後端返回的錯誤信息或通用提示
    errorMsg.value = err instanceof Error
      ? err.message
      : '登錄失敗，請稍後再試'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-view">
    <div class="login-card">
      <!-- 品牌標識 -->
      <div class="login-brand">
        <img class="brand-icon" src="@/assets/logo.png" alt="ichia" />
        <h2 class="brand-name">ichiaDesktop</h2>
        <p class="brand-desc">統一平台 · AI 助手 · 業務管理</p>
      </div>

      <!-- 登錄表單 -->
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        size="large"
        @submit.prevent="handleLogin"
      >
        <el-form-item label="工號" prop="userName">
          <el-input
            v-model="form.userName"
            placeholder="請輸入工號，如 S2403279"
            clearable
            :prefix-icon="User"
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-form-item label="密碼" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="請輸入密碼"
            show-password
            :prefix-icon="Lock"
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <!-- 錯誤提示 -->
        <el-alert
          v-if="errorMsg"
          :title="errorMsg"
          type="error"
          show-icon
          :closable="false"
          class="login-error"
        />

        <el-button
          type="primary"
          native-type="submit"
          :loading="loading"
          class="login-btn"
        >
          {{ loading ? '登錄中...' : '登 錄' }}
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script lang="ts">
import { User, Lock } from '@element-plus/icons-vue'
export default { components: { User, Lock } }
</script>

<style scoped>
.login-view {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: linear-gradient(135deg, var(--el-color-primary-light-9) 0%, var(--el-bg-color-page) 100%);
}

.login-card {
  width: 400px;
  background: var(--el-bg-color);
  border-radius: 16px;
  padding: 40px 36px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}

.login-brand {
  text-align: center;
  margin-bottom: 32px;
}

.brand-icon {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  object-fit: contain;
  margin: 0 auto 16px;
  display: block;
}

.brand-name {
  font-size: 22px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 6px;
}

.brand-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

.login-error {
  margin-bottom: 16px;
}

.login-btn {
  width: 100%;
  margin-top: 8px;
  height: 44px;
  font-size: 15px;
  letter-spacing: 4px;
}
</style>
