<script lang="ts" setup>
/**
 * Provider 新增 / 編輯表單對話框。
 *
 * 對外契約:
 *   v-model:visible — 控制開關
 *   props.provider  — 編輯模式時帶入既有 provider;為 null 表示新增
 *   emit submit     — 提交時傳回 (provider, isNew),父層自己處理儲存
 *
 * 為何 dialog-in-dialog 沒問題:
 *   Element Plus 的 el-dialog 支援巢狀(都 teleport 到 body 的不同層)。
 *   設置 dialog 已開時點「新增」 → 本 dialog 從上方再彈出來,使用者體驗自然。
 *
 * 表單驗證走 el-form 內建 rules,簡單夠用,沒拉 vee-validate / zod。
 */

import {computed, ref, watch} from 'vue'
import {useI18n} from 'vue-i18n'
import type {FormInstance, FormRules} from 'element-plus'
import type {LlmProviderConfig} from '@shared/types/llm.types'

const props = defineProps<{
  visible: boolean
  /** null = 新增模式 */
  provider: LlmProviderConfig | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  submit: [provider: LlmProviderConfig, isNew: boolean]
}>()

const {t} = useI18n()

const isNew = computed(() => props.provider === null)

// 表單 state — 每次 visible 翻為 true 時 reset
const form = ref({
  id: '',
  label: '',
  baseUrl: '',
  apiKey: '',
  model: '',
})

const formRef = ref<FormInstance>()

watch(() => props.visible, (open) => {
  if (!open) return
  if (props.provider) {
    // 編輯模式 — 拷貝既有值進表單
    form.value = {
      id: props.provider.id,
      label: props.provider.label,
      baseUrl: props.provider.baseUrl,
      apiKey: props.provider.apiKey,
      model: props.provider.model ?? '',
    }
  } else {
    // 新增模式 — 清空
    form.value = {
      id: `custom-${Date.now()}`,
      label: '',
      baseUrl: '',
      apiKey: '',
      model: '',
    }
  }
})

const rules: FormRules = {
  label: [
    {required: true, message: () => t('settings.llm.form.labelRequired'), trigger: 'blur'},
  ],
  baseUrl: [
    {required: true, message: () => t('settings.llm.form.baseUrlRequired'), trigger: 'blur'},
    {
      pattern: /^https?:\/\/.+/,
      message: () => t('settings.llm.form.baseUrlInvalid'),
      trigger: 'blur',
    },
  ],
  apiKey: [
    {required: true, message: () => t('settings.llm.form.apiKeyRequired'), trigger: 'blur'},
  ],
}

/** API Key 預設 password 風格,點眼睛切明文 */
const apiKeyVisible = ref(false)

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  const payload: LlmProviderConfig = {
    id: form.value.id,
    label: form.value.label.trim(),
    baseUrl: form.value.baseUrl.trim().replace(/\/+$/, ''),  // 順手去尾 /
    apiKey: form.value.apiKey.trim(),
    model: form.value.model.trim() || undefined,
  }
  emit('submit', payload, isNew.value)
}

function close() {
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
      :close-on-click-modal="false"
      :model-value="visible"
      :title="isNew ? t('settings.llm.form.addTitle') : t('settings.llm.form.editTitle')"
      append-to-body
      width="480px"
      @update:model-value="emit('update:visible', $event)"
  >
    <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        size="default"
    >
      <el-form-item :label="t('settings.llm.form.label')" prop="label">
        <el-input
            v-model="form.label"
            :placeholder="t('settings.llm.form.labelPlaceholder')"
        />
      </el-form-item>

      <el-form-item :label="t('settings.llm.form.baseUrl')" prop="baseUrl">
        <el-input
            v-model="form.baseUrl"
            placeholder="https://api.deepseek.com"
        />
      </el-form-item>

      <el-form-item :label="t('settings.llm.form.apiKey')" prop="apiKey">
        <el-input
            v-model="form.apiKey"
            :placeholder="t('settings.llm.form.apiKeyPlaceholder')"
            :type="apiKeyVisible ? 'text' : 'password'"
            show-password
        />
      </el-form-item>

      <el-form-item :label="t('settings.llm.form.model')" prop="model">
        <el-input
            v-model="form.model"
            :placeholder="t('settings.llm.form.modelPlaceholder')"
        />
        <div class="form-hint">{{ t('settings.llm.form.modelHint') }}</div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" @click="handleSubmit">
        {{ isNew ? t('common.add') : t('common.save') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  line-height: 1.5;
}
</style>
