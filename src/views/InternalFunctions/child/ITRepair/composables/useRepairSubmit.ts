/**
 * useRepairSubmit — 提交報修表單 Composable
 *
 * 封裝「提交報修」Tab 的所有狀態與業務邏輯，包含：
 *  1. 表單欄位（title / description）與 Element Plus 校驗規則
 *  2. Quill 富文本編輯器的初始化、text-change 監聽、貼圖攔截
 *  3. 圖片上傳流程：上傳 → 取得 OSS URL → insertEmbed 插入編輯器
 *  4. 附件列表同步：每次編輯器內容變更後自動掃描 <img> 更新 uploadedAttachments
 *  5. 工單提交：表單校驗 → POST → 重置狀態 → 回調 onSubmitSuccess
 *  6. AI 潤色（Dify SSE 串流）：計次限制、串流接收、中止請求、回填結果保留圖片
 *
 * 使用方：ITRepairView.vue
 * @param onSubmitSuccess 提交成功後由父層執行的回調，負責切換 Tab 和刷新列表
 */
import { ref, reactive, computed, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { QuillEditor } from '@vueup/vue-quill'
import { useAuthStore } from '@/stores/auth.store'
import { repairApi } from '@/api/modules/repair.api'
import type { RepairAttachment } from '@/types/api.types'

/** Dify Chat API 的 SSE 串流端點 */
const DIFY_URL = 'http://192.168.19.62/v1/chat-messages'

/** Dify 應用的 API Key，用於請求頭 Authorization: Bearer */
const DIFY_API_KEY = 'app-aJSqbQXsd4NUHBtQUheWR1ST'

/**
 * 同一份描述允許 AI 整理的最大次數。
 * 超過後按鈕變灰，需修改描述內容後計數才重置。
 * export 供模板顯示「剩餘 x 次」使用。
 */
export const POLISH_LIMIT = 5

export function useRepairSubmit(onSubmitSuccess: () => void) {
  /** 當前登入用戶的 store，用於取 userName 作為 Dify 請求的 user 字段 */
  const authStore = useAuthStore()

  // ══════════════════════════════════════════════════════════════════
  // 表單狀態
  // ══════════════════════════════════════════════════════════════════

  /**
   * Element Plus 表單實例引用。
   * 用於手動調用 validate()（提交前校驗）和 resetFields()（提交成功後重置）。
   * 類型為 FormInstance | undefined，使用前需判斷是否已掛載。
   */
  const submitFormRef = ref<FormInstance>()

  /**
   * 表單雙向綁定資料對象。
   * - title: 工單標題，最多 100 字，提交時傳給後端
   * - description: 富文本 HTML 字串，由 Quill 編輯器寫入，提交時傳給後端
   */
  const submitForm = reactive({ title: '', description: '' })

  /**
   * QuillEditor 組件實例引用（目前預留，未直接調用）。
   * 若後續需要從外部操作編輯器（如清空內容），可通過此 ref 訪問組件暴露的方法。
   */
  const quillEditorRef = ref<InstanceType<typeof QuillEditor>>()

  /**
   * Quill 原生編輯器實例。
   * 在 handleEditorReady 回調中由 @vueup/vue-quill 傳入並保存。
   * 用於調用 insertEmbed()（插入圖片）、getSelection()（獲取游標位置）等底層 API。
   * 聲明為 any 因 Quill 的 TypeScript 類型定義不完整。
   */
  let quillInstance: any = null

  /**
   * 貼圖事件處理函數的引用，保存是為了在以下情況準確移除監聽：
   * 1. 組件卸載時（onBeforeUnmount）防止內存洩漏
   * 2. 編輯器重新初始化時（destroy-on-close 後重新掛載）防止重複綁定
   */
  let quillPasteHandler: ((event: ClipboardEvent) => void) | null = null

  /**
   * 已成功上傳並出現在編輯器 HTML 中的圖片附件列表。
   * 由 syncAttachmentsFromDescription 在每次 text-change 後自動維護：
   * - 插入圖片 → URL 自動加入
   * - 刪除圖片 → URL 自動移除
   * 提交時連同描述 HTML 一起傳給後端，後端存入附件表。
   */
  const uploadedAttachments = ref<RepairAttachment[]>([])

  /**
   * 當前正在上傳中的圖片數量。
   * 使用計數器而非布爾值，是因為用戶可能同時粘貼多張圖片。
   * > 0 時禁用提交按鈕，確保所有圖片上傳完成後才能提交。
   */
  const uploadingCount = ref(0)

  /** 工單提交請求是否進行中，true 時顯示按鈕 loading 狀態，防止重複點擊 */
  const submitting = ref(false)

  /**
   * 是否有圖片正在上傳中（uploadingCount > 0 的語義化計算屬性）。
   * 模板中使用 :disabled="uploading" 而非 :disabled="uploadingCount > 0"，更直觀。
   */
  const uploading = computed(() => uploadingCount.value > 0)

  // ══════════════════════════════════════════════════════════════════
  // AI 潤色狀態
  // ══════════════════════════════════════════════════════════════════

  /** 潤色彈窗（RepairPolishDialog）是否可見，通過 v-model 與子組件雙向綁定 */
  const polishVisible = ref(false)

  /**
   * 是否正在接收 SSE 串流。
   * true 時：AI 整理按鈕顯示 loading、彈窗底部顯示「生成中...」Tag。
   * false 時：串流結束或發生錯誤，用戶可查看/編輯結果。
   */
  const polishLoading = ref(false)

  /**
   * SSE 串流逐步累積的潤色結果文字。
   * 每收到一個 answer chunk 就追加，實現逐字顯示效果。
   * 用戶可在彈窗中手動微調後再點擊「使用此版本」。
   */
  const polishResult = ref('')

  /**
   * 本次報修已使用 AI 整理的次數。
   * 初始為 0，每次調用 polishDescription 前先 +1。
   * 提交報修成功後重置為 0（新工單重新計數）。
   */
  const polishUsedCount = ref(0)

  /**
   * 是否已達整理上限（>= POLISH_LIMIT）。
   * true 時 AI 整理按鈕禁用並顯示灰色，提示用戶修改描述。
   */
  const polishLimitReached = computed(() => polishUsedCount.value >= POLISH_LIMIT)

  /**
   * fetch 請求的 AbortController 實例。
   * 用於在用戶關閉彈窗時調用 abort() 中止未完成的 SSE 串流，避免浪費資源。
   * 請求結束後（finally 塊）置為 null，防止殘留引用誤調用 abort()。
   */
  let polishAbort: AbortController | null = null

  // ══════════════════════════════════════════════════════════════════
  // 工具函數
  // ══════════════════════════════════════════════════════════════════

  /**
   * 將富文本 HTML 轉換為純文字。
   *
   * 使用場景：
   * - 表單字數校驗（校驗 HTML 會把標籤字符計入，導致長度誤判）
   * - 傳給 AI 的 prompt（只需文字內容，圖片無法被 AI 處理）
   * - 潤色彈窗的「原始描述」展示區
   *
   * 實現方式：借助 DOM API 解析 HTML，取 textContent 而非 innerText，
   * 因為 innerText 在某些環境下不可用。
   * \u00a0 是 HTML 的 &nbsp;（不換行空格），替換為普通空格避免字數統計偏差。
   *
   * @param html 富文本 HTML 字串（可為空）
   * @returns 去除所有 HTML 標籤後的純文字，已 trim
   */
  function getPlainText(html: string): string {
    if (!html) return ''
    const container = document.createElement('div')
    container.innerHTML = html
    return (container.textContent ?? '').replace(/\u00a0/g, ' ').trim()
  }

  /**
   * 將 Quill 的空編輯器標準化為空字串。
   *
   * 問題背景：Quill 編輯器清空後，root.innerHTML 不是 '' 而是 '<p><br></p>'。
   * 如果不處理，submitForm.description 會是 '<p><br></p>'，
   * 導致表單校驗認為有內容（plainText 為空但 HTML 不為空），產生誤判。
   *
   * @param html Quill root.innerHTML 的值
   * @returns 空內容時回傳 ''，其餘原樣回傳
   */
  function normalizeEditorHtml(html: string): string {
    return html === '<p><br></p>' ? '' : html
  }

  /**
   * 將 AI 回傳的純文字安全地轉換為 Quill 可渲染的 HTML。
   *
   * 步驟：
   * 1. HTML 轉義（防 XSS：將 <、>、& 等特殊字符轉為實體）
   * 2. 按連續兩個以上換行符切割為段落（模擬 Markdown 段落）
   * 3. 段落內的單個換行符轉為 <br>（軟換行）
   * 4. 每個段落包裹在 <p> 標籤中（Quill 的標準段落格式）
   *
   * @param text AI 回傳的純文字（含換行符）
   * @returns 轉義並段落化後的 HTML，可直接賦值給 submitForm.description
   */
  function plainTextToHtml(text: string): string {
    // 第一步：HTML 轉義，防止 AI 回傳的內容中包含 HTML 特殊字符造成 XSS
    const escaped = text
      .replace(/&/g, '&amp;')   // & 必須最先替換，否則後續替換結果中的 & 也會被再次轉義
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

    // 第二步：按段落切割並包裹 <p> 標籤
    return escaped
      .split(/\n{2,}/)  // 兩個或以上換行 = 段落分隔
      .map((p) => `<p>${p.replace(/\n/g, '<br>') || '<br>'}</p>`)  // 空段落用 <br> 填充防止 Quill 折疊
      .join('')
  }

  /**
   * 從編輯器 HTML 中提取所有圖片 URL，同步更新 uploadedAttachments。
   *
   * 調用時機：每次 Quill text-change 事件後自動調用，確保：
   * - 用戶貼入圖片後，該圖片的 OSS URL 自動加入 uploadedAttachments
   * - 用戶刪除圖片後，該圖片的 OSS URL 自動從 uploadedAttachments 移除
   * - 提交時 uploadedAttachments 始終與編輯器中實際存在的圖片保持一致
   *
   * 去重處理：使用 Set 防止同一圖片 URL 因複製貼上而重複計入。
   *
   * @param html 當前編輯器的 HTML 內容
   */
  function syncAttachmentsFromDescription(html: string) {
    // 編輯器為空時清空附件列表
    if (!html) {
      uploadedAttachments.value = []
      return
    }

    // 用 DOM 解析 HTML，querySelectorAll 比正則更可靠
    const container = document.createElement('div')
    container.innerHTML = html

    // 提取所有 img 的 src 屬性，過濾掉空值
    const urls = Array.from(container.querySelectorAll('img'))
      .map((img) => img.getAttribute('src')?.trim())
      .filter((url): url is string => Boolean(url))

    // Set 去重後轉為附件對象列表
    uploadedAttachments.value = Array.from(new Set(urls)).map((fileUrl) => ({ fileUrl }))
  }

  // ══════════════════════════════════════════════════════════════════
  // 表單校驗規則
  // ══════════════════════════════════════════════════════════════════

  /**
   * Element Plus el-form 的 :rules 配置。
   * 使用富文本專用的校驗器（richSubmitRules），而非簡單的 max 規則，
   * 原因：直接對 HTML 字串做 max 校驗會把標籤字符計入字數，產生誤判。
   */
  const richSubmitRules = {
    /** 標題規則：必填 + 最大 100 字元 */
    title: [
      { required: true, message: '請填寫工單標題', trigger: 'blur' },
      { max: 100, message: '標題不超過 100 個字元', trigger: 'blur' }
    ],
    /**
     * 描述規則：自定義校驗函數。
     * 先將 HTML 轉為純文字再判斷長度，排除標籤字符的干擾。
     * trigger: 'blur' 在編輯器失焦時觸發（handleEditorBlur 中手動調用 validateField）。
     */
    description: [
      {
        validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
          // 先 normalize 排除 Quill 空內容的 '<p><br></p>'
          const plainText = getPlainText(normalizeEditorHtml(value))
          if (!plainText) { callback(new Error('請填寫問題描述')); return }
          if (plainText.length > 2000) { callback(new Error('描述不超過 2000 個字元')); return }
          callback()  // 校驗通過，必須調用無參 callback
        },
        trigger: 'blur'
      }
    ]
  }

  /**
   * 編輯器純文字字數（計算屬性，實時更新）。
   * 依賴 submitForm.description，每次編輯器 text-change 後自動重新計算。
   * 用於底部「x/2000」字數提示，給用戶即時的字數反饋。
   */
  const descriptionWordCount = computed(() =>
    getPlainText(normalizeEditorHtml(submitForm.description)).length
  )

  // ══════════════════════════════════════════════════════════════════
  // 圖片上傳
  // ══════════════════════════════════════════════════════════════════

  /**
   * 圖片上傳前的前置校驗，在 uploadEditorImage 中調用。
   *
   * 校驗項目：
   * 1. 文件 MIME 類型必須以 'image/' 開頭（jpg、png、gif、webp 等均符合）
   * 2. 文件大小不超過 10MB（10 * 1024 * 1024 bytes）
   *
   * @param rawFile 待上傳的原始 File 對象
   * @returns true = 通過校驗可以上傳；false = 不合格，已顯示錯誤提示
   */
  function beforeUpload(rawFile: File): boolean {
    if (!rawFile.type.startsWith('image/')) {
      ElMessage.error('只能上傳圖片文件（jpg / png / gif 等）')
      return false
    }
    if (rawFile.size > 10 * 1024 * 1024) {
      ElMessage.error(`${rawFile.name} 超過 10MB，請壓縮後重試`)
      return false
    }
    return true
  }

  /**
   * 將圖片上傳至後端（後端再中轉至 OSS），成功後插入 Quill 編輯器。
   *
   * 完整流程：
   * 1. beforeUpload 前置校驗（類型 + 大小），不通過直接 return
   * 2. uploadingCount++ 禁用提交按鈕，防止圖片還未上傳完就提交
   * 3. 構建 FormData，POST multipart/form-data 到後端 /api/repair/upload
   * 4. 後端返回 { fileUrl: 'http://oss-cdn/.../xxx.jpg' }
   * 5. 獲取 Quill 當前游標位置（getSelection），未聚焦時插入到末尾
   * 6. insertEmbed 在游標處插入 <img src="fileUrl">，source='user' 觸發 text-change
   * 7. setSelection 將游標移到圖片後方一位，'silent' 不觸發額外 text-change
   * 8. finally 中 uploadingCount-- 恢復提交按鈕
   *
   * @param file 從剪貼板事件或文件選擇器取得的圖片 File 對象
   */
  async function uploadEditorImage(file: File) {
    if (!beforeUpload(file)) return

    uploadingCount.value++  // 上傳開始，禁用提交按鈕
    try {
      const result = await repairApi.uploadFile(file)
      const imageUrl = result.fileUrl

      // getSelection(true) 強制聚焦並返回當前游標範圍（{index, length}）
      // 若編輯器未聚焦返回 null，使用末尾位置作為後備
      const range = quillInstance?.getSelection(true) ?? {
        index: quillInstance?.getLength?.() ?? 0,
        length: 0
      }

      // 在游標處插入圖片 embed，source='user' 確保觸發 text-change 事件同步附件列表
      quillInstance?.insertEmbed(range.index, 'image', imageUrl, 'user')

      // 插入後游標向後移一位（跳過圖片），'silent' 避免再次觸發 text-change
      quillInstance?.setSelection(range.index + 1, 0, 'silent')
    } catch {
      ElMessage.error('圖片上傳失敗，請重試')
    } finally {
      uploadingCount.value--  // 上傳結束（無論成功或失敗），恢復提交按鈕
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 編輯器事件處理
  // ══════════════════════════════════════════════════════════════════

  /**
   * Quill 編輯器 ready 回調，由 QuillEditor 組件的 @ready 事件觸發。
   * 此時 Quill 已完成初始化，DOM 已渲染，可以安全地操作編輯器。
   *
   * 負責三件事：
   * 1. 保存 Quill 原生實例到模塊變量 quillInstance，供其他函數使用
   * 2. 監聽 text-change 事件，每次內容變更時同步 submitForm.description 和附件列表
   * 3. 添加 paste 事件監聽，攔截剪貼板圖片走自定義上傳流程
   *    （阻止 Quill 默認行為：將圖片轉為 base64 直接嵌入 HTML，導致 HTML 體積極大）
   *
   * @param editor @vueup/vue-quill @ready 事件傳入的 Quill 原生實例
   */
  function handleEditorReady(editor: any) {
    // 保存實例供 uploadEditorImage 等函數使用
    quillInstance = editor

    // 每次編輯器內容變更時同步表單值和附件列表
    // text-change 在用戶輸入、程序調用 insertEmbed/setContents 等所有情況下都會觸發
    quillInstance.on('text-change', () => {
      // 同步 HTML 到表單，同時排除 Quill 空內容的干擾
      submitForm.description = normalizeEditorHtml(quillInstance.root.innerHTML)
      // 掃描 img 標籤更新附件列表
      syncAttachmentsFromDescription(submitForm.description)
    })

    // 移除舊的 paste 監聽（組件因 keep-alive 或 destroy-on-close 重新掛載時保護）
    if (quillPasteHandler) {
      quillInstance.root.removeEventListener('paste', quillPasteHandler)
    }

    // 定義貼圖攔截處理函數（保存引用以便後續移除）
    quillPasteHandler = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items ?? [])

      // 在剪貼板內容中查找圖片類型的條目（image/png、image/jpeg 等）
      const imageItem = items.find((item) => item.type.startsWith('image/'))
      const file = imageItem?.getAsFile()

      // 沒有圖片（純文字粘貼）時不攔截，讓 Quill 正常處理文字
      if (!file) return

      // 阻止 Quill 默認的 base64 嵌入行為
      event.preventDefault()

      // 異步上傳圖片（void 表示故意不等待 Promise，貼圖後 UI 不阻塞）
      void uploadEditorImage(file)
    }

    // 綁定到編輯器的可編輯 div（ql-editor），而非整個頁面，精確攔截
    quillInstance.root.addEventListener('paste', quillPasteHandler)
  }

  /**
   * 編輯器失焦時的處理函數，由 QuillEditor 組件的 @blur 事件觸發。
   *
   * 三個操作：
   * 1. 再次 normalize 空內容：防止用戶輸入後全部刪除，submitForm.description 殘留 '<p><br></p>'
   * 2. 同步附件列表：確保焦點離開時附件狀態是最新的
   * 3. 手動觸發 description 欄位的 Element Plus 校驗：
   *    因為 Quill 不是原生 input，el-form 無法自動感知失焦事件，需要手動調用
   *    catch 忽略校驗失敗異常（校驗失敗時顯示錯誤信息即可，不需要額外處理）
   */
  function handleEditorBlur() {
    submitForm.description = normalizeEditorHtml(submitForm.description)
    syncAttachmentsFromDescription(submitForm.description)
    submitFormRef.value?.validateField('description').catch(() => undefined)
  }

  /**
   * 組件卸載前的清理工作：移除貼圖事件監聽。
   * 雖然組件卸載後 DOM 元素會被銷毀，監聽自然失效，
   * 但顯式移除是良好的編碼習慣，可防止潛在的內存洩漏或事件殘留問題。
   */
  onBeforeUnmount(() => {
    if (quillInstance?.root && quillPasteHandler) {
      quillInstance.root.removeEventListener('paste', quillPasteHandler)
    }
  })

  // ══════════════════════════════════════════════════════════════════
  // 提交工單
  // ══════════════════════════════════════════════════════════════════

  /**
   * 提交報修工單的完整流程。
   *
   * 步驟：
   * 1. 提交前最後一次 normalize + 同步附件（防止用戶未觸發 blur 就直接點提交）
   * 2. Element Plus 表單校驗（title 必填/長度 + description 非空/長度）
   *    校驗失敗時 validate() 拋出異常，catch 後直接 return，Element Plus 自動顯示錯誤
   * 3. 檢查是否有圖片仍在上傳中，有則提示並阻止提交，防止附件列表不完整
   * 4. POST /api/repair/create，帶上 title、description（HTML）、attachments（URL 列表）
   * 5. 提交成功後：
   *    a. 顯示成功提示（帶工單號）
   *    b. 清空表單所有欄位和狀態（含 AI 整理計數）
   *    c. 調用 onSubmitSuccess 回調，由父層切換 Tab 並刷新工單列表
   */
  async function handleSubmit() {
    // 提交前確保狀態同步，不依賴最後一次 blur
    submitForm.description = normalizeEditorHtml(submitForm.description)
    syncAttachmentsFromDescription(submitForm.description)

    try {
      // validate() 校驗所有 prop 對應的規則，任一不通過則拋出異常
      await submitFormRef.value!.validate()
    } catch {
      // Element Plus 已在輸入框下方顯示紅色錯誤文字，這裡只需靜默阻止後續邏輯
      return
    }

    // 圖片仍在上傳中，附件列表可能不完整，拒絕提交
    if (uploading.value) {
      ElMessage.warning('請等待圖片上傳完成後再提交')
      return
    }

    submitting.value = true
    try {
      const result = await repairApi.create({
        title: submitForm.title,
        description: submitForm.description,       // 保留 HTML 格式（含圖片 <img> 標籤）
        attachments: uploadedAttachments.value     // 後端存入附件表
      })

      // 成功提示帶工單號，方便用戶追蹤
      ElMessage.success(`報修提交成功！工單號：${result.requestNo}`)

      // 重置表單所有狀態，準備下一次提交
      submitForm.title = ''
      submitForm.description = ''
      uploadedAttachments.value = []
      polishUsedCount.value = 0           // 新工單的 AI 整理次數從 0 開始
      submitFormRef.value?.resetFields()  // 清除 Element Plus 的校驗狀態（紅框等）

      // 通知父層切換 Tab 並刷新列表
      onSubmitSuccess()
    } finally {
      // 無論成功或失敗，都關閉 loading 狀態，恢復按鈕可點擊
      submitting.value = false
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // AI 潤色
  // ══════════════════════════════════════════════════════════════════

  /**
   * 觸發 AI 潤色請求，使用 Dify 的 SSE 串流模式逐字顯示結果。
   *
   * 前置檢查：
   * - 描述為空時提示用戶先填寫
   * - 已達次數上限時提示修改描述
   *
   * SSE 串流處理邏輯：
   * - 使用原生 fetch（axios 不支持 ReadableStream）
   * - 逐 chunk 讀取，每 chunk 按 '\n' 切行，找 'data: ' 前綴的行
   * - 解析 JSON，取 event 為 'message' 或 'agent_message' 的 answer 字段
   * - 追加到 polishResult 實現逐字顯示效果
   *
   * 只傳純文字給 AI，原因：
   * - AI 無法理解 HTML 標籤，傳 HTML 會干擾潤色效果
   * - 圖片在 applyPolish 時從原始描述提取並重新附加
   */
  async function polishDescription() {
    // 轉純文字再判空，避免 Quill 空內容 '<p><br></p>' 被誤判為有內容
    const plainDescription = getPlainText(normalizeEditorHtml(submitForm.description))
    if (!plainDescription) {
      ElMessage.warning('請先填寫問題描述')
      return
    }

    // 達到次數上限，提示修改描述（修改後 key 變化，計數重置）
    if (polishLimitReached.value) {
      ElMessage.warning(`同一問題描述最多整理 ${POLISH_LIMIT} 次，請修改描述後再試`)
      return
    }

    // 先加計數，防止用戶在請求進行中連續點擊
    polishUsedCount.value++

    // 初始化彈窗狀態：開啟彈窗、進入 loading、清空上次結果
    polishVisible.value = true
    polishLoading.value = true
    polishResult.value = ''
    polishAbort = new AbortController()

    // 構建 prompt：要求 AI 潤色並保持語言一致
    const prompt =
      `請幫我潤色以下 IT 報修問題描述，讓表達更清晰、完整、專業，` +
      `保留所有原始資訊和細節，語言與原文保持一致：\n\n${plainDescription}`

    try {
      const response = await fetch(DIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DIFY_API_KEY}`
        },
        body: JSON.stringify({
          inputs: {},
          query: prompt,
          response_mode: 'streaming',                          // 開啟 SSE 串流模式
          user: authStore.user?.userName ?? 'desktop-user'     // 標識請求來源用戶
        }),
        signal: polishAbort.signal  // 綁定 AbortController，關閉彈窗時可中止
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (!response.body) throw new Error('響應體為空')

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')

      // 持續讀取串流直到結束
      while (true) {
        const { done, value } = await reader.read()
        if (done) break  // 串流正常結束

        // 一個 chunk 可能包含多個 SSE 事件，按換行符切分後逐行處理
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          // SSE 格式：'data: {...json...}'，跳過非 data 行（如空行、注釋行）
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()  // 移除 'data: ' 前綴
          if (!raw) continue

          try {
            const parsed = JSON.parse(raw) as { event: string; answer?: string }
            // Dify 普通 Chat App → event: 'message'
            // Dify Agent Chat App → event: 'agent_message'
            // 兩種類型都需要處理，取 answer 字段追加到結果
            if ((parsed.event === 'message' || parsed.event === 'agent_message') && parsed.answer) {
              polishResult.value += parsed.answer
            }
          } catch {
            // JSON 解析失敗忽略（可能是 SSE 心跳包 [DONE] 等非 JSON 內容）
          }
        }
      }
    } catch (e) {
      // AbortError 是用戶主動關閉彈窗觸發的，屬於正常流程，靜默處理
      if (e instanceof Error && e.name === 'AbortError') return

      // 其他錯誤（網絡異常、HTTP 錯誤等）顯示提示並關閉彈窗
      ElMessage.error('AI 整理失敗，請確認服務是否可用')
      polishVisible.value = false
    } finally {
      // 無論成功、失敗還是中止，都退出 loading 狀態並清空 abort 引用
      polishLoading.value = false
      polishAbort = null
    }
  }

  /**
   * 採用 AI 整理結果，回填到編輯器並保留原始圖片。
   *
   * 問題背景：
   * AI 潤色時只傳了純文字（不含 HTML 和圖片），
   * 因此 polishResult 是純文字，直接回填會丟失原有圖片。
   *
   * 解決方案：
   * 1. 從當前 submitForm.description 的 HTML 中提取所有 <img> 節點
   * 2. 將 polishResult 轉為 HTML 段落（plainTextToHtml）
   * 3. 把圖片節點逐個包裹在 <p> 中，追加到潤色文字後面
   * 4. 賦值給 submitForm.description，Quill 通過 v-model 更新視圖
   */
  function applyPolish() {
    // 從原始 HTML 提取所有圖片節點（保留 src、alt 等屬性）
    const container = document.createElement('div')
    container.innerHTML = submitForm.description
    const images = Array.from(container.querySelectorAll('img'))

    // AI 純文字結果 → 段落化 HTML
    let newHtml = plainTextToHtml(polishResult.value)

    // 有圖片時追加到文字後方（圖片放最後是最安全的做法，
    // 因為 AI 潤色後的文字結構可能與原來完全不同，無法精確還原圖片位置）
    if (images.length > 0) {
      newHtml += images.map((img) => `<p>${img.outerHTML}</p>`).join('')
    }

    // 賦值後 Quill v-model 自動更新編輯器視圖，同時觸發 text-change 同步附件列表
    submitForm.description = newHtml
    polishVisible.value = false
  }

  /**
   * 關閉 AI 潤色彈窗。
   * 若 SSE 串流仍在進行中，調用 abort() 立即中止 fetch 請求，
   * 避免後台繼續接收和處理無意義的串流數據。
   */
  function closePolish() {
    polishAbort?.abort()         // 中止未完成的請求，若已完成則 abort() 無效果
    polishVisible.value = false
    polishResult.value = ''      // 清空結果，防止下次打開時閃現上次內容
  }

  // ══════════════════════════════════════════════════════════════════
  // 對外暴露（供 ITRepairView.vue 解構使用）
  // ══════════════════════════════════════════════════════════════════
  return {
    submitFormRef,        // 傳給 el-form ref 屬性，用於 validate/resetFields
    submitForm,           // 傳給 el-form :model，雙向綁定表單欄位
    quillEditorRef,       // 傳給 QuillEditor ref 屬性（預留擴展）
    richSubmitRules,      // 傳給 el-form :rules
    descriptionWordCount, // 底部字數計數顯示
    uploading,            // 控制提交按鈕 :disabled 狀態
    submitting,           // 控制提交按鈕 :loading 狀態
    handleEditorReady,    // QuillEditor @ready 事件處理
    handleEditorBlur,     // QuillEditor @blur 事件處理
    handleSubmit,         // 提交按鈕 @click 處理
    getPlainText,         // 供父層在 AI 彈窗中顯示純文字原文

    POLISH_LIMIT,         // 整理次數上限常量，供模板顯示「x/5」
    polishVisible,        // AI 彈窗顯示狀態（v-model）
    polishLoading,        // 串流生成中狀態
    polishResult,         // 串流累積的結果文字（可手動微調）
    polishUsedCount,      // 已使用次數
    polishLimitReached,   // 是否已達上限
    polishDescription,    // AI 整理按鈕 @click 處理
    applyPolish,          // 「使用此版本」按鈕 @click 處理
    closePolish,          // 彈窗關閉/取消按鈕處理
  }
}
