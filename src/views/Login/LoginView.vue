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

import {onMounted, reactive, ref} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'
import {useAuthStore} from '@/stores/auth.store'
import {useUpdate} from '@/features/update/use-update'
import {useUserProfileStore} from '@/features/user-profile/store'
import {logger} from '@/shared/utils/logger'
import {Lock, User} from '@element-plus/icons-vue'
import type {FormInstance, FormRules} from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()
const {t} = useI18n()

/** 開發環境自動登錄：將 env 值填入表單，再走正常登錄流程 */
onMounted(() => {
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_AUTO_LOGIN === 'true') {
    const username = import.meta.env.VITE_DEV_USERNAME
    const password = import.meta.env.VITE_DEV_PASSWORD
    logger.debug('開發環境自動填入帳號', 'Login', {username})
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

/**
 * 前端基礎校驗規則。
 * message 用 t() 動態讀取 → 切換語言時 form 校驗提示自動跟著變。
 * 原文：請輸入工號 / 工號格式不正確 / 請輸入密碼 / 密碼不能為空
 */
const rules: FormRules = {
  userName: [
    { required: true, message: () => t('login.rules.userNameRequired'), trigger: 'blur' },
    { min: 2, message: () => t('login.rules.userNameInvalid'), trigger: 'blur' }
  ],
  password: [
    { required: true, message: () => t('login.rules.passwordRequired'), trigger: 'blur' },
    { min: 1, message: () => t('login.rules.passwordEmpty'), trigger: 'blur' }
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

    // 登錄成功 → 同步使用者身份(從 /api/UserInfo/ding/userinfo 拉 dingId / unionId 寫進本機 SQLite)。
    // 失敗不阻塞登入(store 內已 catch,UI 後續可從 userProfileStore.profileError 讀錯誤)。
    // 不 await:讓登入跳轉先行,身份同步背景完成。
    void useUserProfileStore().syncAfterLogin()

    // 登錄成功 → 觸發一次靜默更新檢查（不 await，不阻塞跳轉）
    // 與每日 11:00 的定時檢查互補：用戶每次重新登錄即可立刻得知是否有新版
    // loginCheck 內部已包含失敗兜底，不會把錯誤拋出影響登錄流程
    void useUpdate().loginCheck()

    // 跳轉首頁
    await router.push({name: 'unified-platform'})
  } catch (err: unknown) {
    // 顯示後端返回的錯誤信息或通用提示
    // 原文 fallback：登錄失敗，請稍後再試
    errorMsg.value = err instanceof Error
      ? err.message
      : t('login.errorFallback')
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
        <div class="brand-mark">
          <span class="brand-mark__letter">i</span>
        </div>
        <div class="brand-eyebrow">
          <!-- 原文：ICHIA ENTERPRISE -->
          <span>{{ t('login.eyebrowEn') }}</span>
          <!-- 原文：· 企業客戶端 -->
          <span class="brand-eyebrow__zh">{{ t('login.eyebrowZh') }}</span>
        </div>
        <!-- 原文：歡迎回來（拆兩段給「回來」單獨的 accent 樣式） -->
        <h1 class="brand-title">
          {{ t('login.welcomeBack1') }}<span class="brand-title__accent">{{ t('login.welcomeBack2') }}</span>
        </h1>
        <!-- 原文：統一平台 · AI 助手 · 業務管理 -->
        <p class="brand-desc">{{ t('login.desc') }}</p>
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
        <!-- 原文 label：工號 -->
        <el-form-item :label="t('login.fieldUserName')" prop="userName">
          <el-input
            v-model="form.userName"
            :placeholder="t('login.placeholderUserName')"
            clearable
            :prefix-icon="User"
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <!-- 原文 label：密碼 -->
        <el-form-item :label="t('login.fieldPassword')" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="t('login.placeholderPassword')"
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

        <!-- 原文：登錄中... / 登 錄 -->
        <el-button
          type="primary"
          native-type="submit"
          :loading="loading"
          class="login-btn"
        >
          {{ loading ? t('login.submitting') : t('login.submit') }}
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.login-view {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--app-bg-canvas);
}

.login-card {
  width: 420px;
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--app-radius-lg);
  padding: 44px 40px 36px;
  box-shadow: var(--app-shadow-lg);
}

.login-brand {
  text-align: center;
  margin-bottom: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.brand-mark {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.brand-mark__letter {
  font-family: var(--app-font-display);
  font-style: italic;
  font-weight: 600;
  font-size: 32px;
  color: var(--app-brand);
  line-height: 1;
}

.brand-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--app-text-secondary);
}

.brand-eyebrow__zh {
  letter-spacing: 0.1em;
  color: var(--app-text-muted);
}

.brand-title {
  font-size: 32px;
  font-weight: 700;
  color: var(--app-text-primary);
  margin: 4px 0 0;
  letter-spacing: -0.02em;
}

.brand-title__accent {
  font-family: var(--app-font-display);
  font-style: italic;
  font-weight: 500;
  color: var(--app-accent);
  margin: 0 0.06em;
}

.brand-desc {
  font-size: 13px;
  color: var(--app-text-secondary);
  margin: 0;
  letter-spacing: 0.04em;
}

.login-error {
  margin-bottom: 16px;
}

.login-btn {
  width: 100%;
  margin-top: 8px;
  height: 46px;
  font-size: 15px;
  letter-spacing: 0.4em;
}
</style>
