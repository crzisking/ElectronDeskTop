/**
 * useRepairSubmit — 提交報修頁面的 Facade Composable
 *
 * 此檔不含具體業務邏輯，只做兩件事：
 *  1. 編排 4 個子 composable，按依賴關係建構並串接
 *  2. 實作 handleSubmit（工單提交流程：校驗 → POST → 重置 → 通知父層）
 *
 * 對外接口（return）保持與舊版 useRepairSubmit 完全一致，
 * ITRepairView.vue 的解構不需任何改動。
 *
 * ── 子 composable 關係圖 ─────────────────────────────────────────────
 *
 *   useRepairForm   ←─ 提供 submitForm / submitFormRef / 校驗規則 / 工具函數
 *        │
 *        ├──→ useRepairUpload  （需要 form 寫附件、editor 插圖）
 *        │         │
 *        │         └──→ useRepairEditor  （需要 form/upload 同步狀態與粘貼上傳）
 *        │
 *        └──→ useRepairPolish  （需要 form 讀寫描述、工具函數）
 *
 * ── 為何拆分 ─────────────────────────────────────────────────────────
 * 舊版 697 行單檔承擔 4 個職責：表單、編輯器、上傳、AI 潤色。
 * 修改任一處都要在近 700 行裡搜，且子模塊難以單測。
 * 拆分後每個 composable < 200 行，職責清晰。
 *
 * 工具函數（getPlainText / normalizeEditorHtml / plainTextToHtml）
 * 從 useRepairForm 直接 re-export，保持向後兼容。
 */
import {ref} from 'vue'
import {ElMessage} from 'element-plus'
import {i18n} from '@/locales'
import {repairApi} from '../api'
import {logger} from '@/shared/utils/logger'

import {getPlainText, normalizeEditorHtml, useRepairForm} from './useRepairForm'
import {useRepairUpload} from './useRepairUpload'
import {useRepairEditor} from './useRepairEditor'
import {POLISH_LIMIT, useRepairPolish} from './useRepairPolish'

const t = (key: string, named?: Record<string, unknown>) =>
  named ? i18n.global.t(key, named) : i18n.global.t(key)

// 工具與常量 re-export，保持與舊版接口兼容
export {POLISH_LIMIT}

/**
 * 提交報修 Composable Facade。
 *
 * @param onSubmitSuccess 提交成功後由父層執行的回調（切 Tab + 刷新列表）
 */
export function useRepairSubmit(onSubmitSuccess: () => void) {
    // ── Step 1: 表單核心 ───────────────────────────────────────────
    const formApi = useRepairForm()
    const {submitFormRef, submitForm, richSubmitRules, descriptionWordCount} = formApi

    // ── Step 2: Editor 與 Upload 互相依賴，用「先聲明後賦值」打破循環 ──
    // editor 需要 upload 的 syncAttachments / uploadEditorImage，
    // upload 需要 editor 的 quillInstance（getEditor）。
    // 解法：upload 先用一個「待補的 getEditor」初始化，editor 構造完後 setEditor 注入。
    let editorGetterImpl: () => any | null = () => null
    const uploadApi = useRepairUpload(() => editorGetterImpl())
    const {
        uploadedAttachments,
        uploading,
        syncAttachmentsFromDescription,
        uploadEditorImage
    } = uploadApi

    // ── Step 3: Editor（持有 Quill 實例） ─────────────────────────
    const editorApi = useRepairEditor({
        submitForm,
        submitFormRef,
        normalizeEditorHtml,
        syncAttachmentsFromDescription,
        uploadEditorImage
    })
    const {quillEditorRef, handleEditorReady, handleEditorBlur, getEditor} = editorApi

    // 把真正的 getEditor 注入回 upload（之前是個空 stub）
    editorGetterImpl = getEditor

    // ── Step 4: AI 潤色 ─────────────────────────────────────────
    const polishApi = useRepairPolish({
        submitForm,
        normalizeEditorHtml,
        getPlainText
    })
    const {
        polishVisible,
        polishLoading,
        polishResult,
        polishUsedCount,
        polishLimitReached,
        polishDescription,
        applyPolish,
        closePolish,
        resetPolishCount
    } = polishApi

    // ── Step 5: 提交工單流程（本 facade 唯一保留的業務邏輯） ─────────

    /** 工單提交請求進行中：true 時提交按鈕顯示 loading，防重複點擊 */
  const submitting = ref(false)

  /**
   * 提交報修工單的完整流程。
   *
   * 步驟：
   *  1. 提交前 normalize + 同步附件（防止用戶沒觸發 blur 直接點提交）
   *  2. el-form 校驗（標題長度 + 描述非空/長度）
   *  3. 圖片若仍在上傳 → 拒絕，附件可能不完整
   *  4. POST /api/repair/create
   *  5. 成功 → 顯示工單號 + 清空表單與所有狀態 + 觸發父層回調
   *  6. finally 統一關閉 loading
   */
  async function handleSubmit(): Promise<void> {
      // 提交前最後一次同步狀態，不依賴最後一次 blur
    submitForm.description = normalizeEditorHtml(submitForm.description)
    syncAttachmentsFromDescription(submitForm.description)

    try {
      if (!submitFormRef.value) return
      await submitFormRef.value.validate()
    } catch {
        // Element Plus 已在輸入框下顯示紅色錯誤，這裡只需靜默 return
      return
    }

    // 圖片仍在上傳中，附件列表可能不完整，拒絕提交
    if (uploading.value) {
      // 原文：請等待圖片上傳完成後再提交
      ElMessage.warning(t('repair.uploadingHint'))
      return
    }

    submitting.value = true
    try {
      const result = await repairApi.create({
        title: submitForm.title,
          description: submitForm.description,    // 保留 HTML（含 <img>）
          attachments: uploadedAttachments.value
      })

      // 原文：報修提交成功！工單號：{no}
      ElMessage.success(t('repair.submitOk', {no: result.requestNo}))

        // 重置 Quill 內部 Delta（單純賦空字串無法清除已渲染的圖片節點）
        // 詳見 docs/開發記錄：@vueup/vue-quill 的 v-model 是單向「編輯器→外部」，
        // 外部賦空不會反向驅動 Quill 清 DOM。
        getEditor()?.setContents([])

      submitForm.title = ''
      submitForm.description = ''
      uploadedAttachments.value = []
        resetPolishCount()                        // 新工單 AI 整理計數從 0 開始
        submitFormRef.value?.resetFields()        // 清 Element Plus 校驗狀態（紅框等）

      onSubmitSuccess()
    } catch (err) {
        // 業務錯誤已由 axios 攔截器彈 ElMessage，這裡只記日誌做排查用
        logger.error('提交報修工單失敗', 'useRepairSubmit', err)
    } finally {
      submitting.value = false
    }
  }

    // ── 對外暴露：保持與舊版完全相同的接口 ─────────────────────
  return {
      submitFormRef,
      submitForm,
      quillEditorRef,
      richSubmitRules,
      descriptionWordCount,
      uploading,
      submitting,
      handleEditorReady,
      handleEditorBlur,
      handleSubmit,
      getPlainText,             // 模板中需要把 HTML 轉純文字顯示

      POLISH_LIMIT,
      polishVisible,
      polishLoading,
      polishResult,
      polishUsedCount,
      polishLimitReached,
      polishDescription,
      applyPolish,
      closePolish
  }
}
