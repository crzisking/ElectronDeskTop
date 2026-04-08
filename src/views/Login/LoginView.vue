<script setup lang="ts">
/**
 * 登錄頁面（預留占位）
 *
 * 當前狀態：展示"開發中"占位頁面
 * 所有登錄接口已在 authStore 和 auth.api.ts 中預留
 *
 * 後續實現步驟：
 *  1. 取消 src/router/index.ts 中的路由守衛注釋
 *  2. 實現 authStore.login() 方法
 *  3. 完善此頁面的表單 UI 和提交邏輯
 *
 * 預留的表單結構已在注釋中給出，方便後續快速實現。
 */

// 預留：import { ref } from 'vue'
// 預留：import { useAuthStore } from '@/stores/auth.store'
// 預留：const authStore = useAuthStore()
// 預留：const form = ref({ username: '', password: '' })
// 預留：const loading = ref(false)
// 預留：async function handleLogin() { ... }
</script>

<template>
  <div class="login-view">
    <div class="login-card">
      <!-- 應用標識 -->
      <div class="login-brand">
        <img class="brand-icon" src="@/assets/logo.png" alt="ichia" />
        <h2 class="brand-name">ichiaDesktop</h2>
        <p class="brand-desc">統一平台 · AI 助手 · 快速聯繫</p>
      </div>

      <!-- 開發中提示 -->
      <el-result
        icon="info"
        title="登錄功能開發中"
        sub-title="認證模塊已完成架構預留，功能即將上線"
      >
        <template #extra>
          <el-tag type="info" size="large">auth.store.ts · auth.api.ts · keytar 已就緒</el-tag>
        </template>
      </el-result>

      <!--
        預留登錄表單（取消注釋即可使用）：

        <el-form :model="form" label-position="top" @submit.prevent="handleLogin">
          <el-form-item label="用戶名 / 郵箱" required>
            <el-input v-model="form.username" placeholder="請輸入用戶名或郵箱" clearable />
          </el-form-item>
          <el-form-item label="密碼" required>
            <el-input v-model="form.password" type="password" placeholder="請輸入密碼" show-password />
          </el-form-item>
          <el-button type="primary" native-type="submit" :loading="loading" style="width:100%">
            登錄
          </el-button>
        </el-form>
      -->
    </div>
  </div>
</template>

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
}

.brand-name {
  font-size: 22px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 8px;
}

.brand-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0;
}
</style>
