/**
 * useRepairForm — 報修表單核心 Composable
 *
 * 職責邊界（這一層只管「表單資料 + 校驗規則 + 純文字工具」）：
 *  1. submitForm: 表單雙向綁定資料（title / description）
 *  2. submitFormRef: el-form 實例引用，用於 validate / resetFields
 *  3. richSubmitRules: 標題長度規則 + 描述自定義校驗器（HTML→純文字後判長度）
 *  4. descriptionWordCount: 描述純文字字數計算屬性，給底部「x/2000」用
 *  5. 純文字 / HTML 互轉工具（getPlainText / normalizeEditorHtml / plainTextToHtml）
 *
 * 不在這一層處理：
 *  - Quill 實例（useRepairEditor）
 *  - 圖片上傳（useRepairUpload）
 *  - AI 潤色（useRepairPolish）
 *  - 工單提交（useRepairSubmit facade）
 *
 * 工具函數獨立 export，便於：
 *  - useRepairPolish 重用 plainTextToHtml 做 AI 結果回填
 *  - useRepairUpload / Editor 重用 normalizeEditorHtml 同步狀態
 */
import {computed, reactive, ref} from 'vue'
import type {FormInstance} from 'element-plus'
import {i18n} from '@/locales'

/**
 * useRepairForm 在 setup 內呼叫，但 rules 的 message 函數在校驗時才執行，
 * 此時可能 useI18n() 上下文已經失效；穩妥做法是用全局 i18n 實例直接讀。
 */
const t = (key: string) => i18n.global.t(key)

/**
 * 將富文本 HTML 轉換為純文字。
 *
 * 使用場景：
 *  - 表單字數校驗（直接對 HTML 校驗會把標籤計入長度）
 *  - 傳給 AI 的 prompt（圖片無法被 AI 處理，只給文字）
 *  - 潤色彈窗的「原始描述」展示
 *
 * 實現：用 div.innerHTML + textContent，比 innerText 更可靠（後者部分環境不可用）。
 * \u00A0 是 HTML 的 &nbsp;，替換為普通空格避免字數誤算。
 */
export function getPlainText(html: string): string {
    if (!html) return ''
    const container = document.createElement('div')
    container.innerHTML = html
    return (container.textContent ?? '').replace(/\u00A0/g, ' ').trim()
}

/**
 * 將 Quill 的「空編輯器」標準化為空字串。
 *
 * 問題：Quill 清空後 root.innerHTML 是 '<p><br></p>' 而不是 ''，
 * 導致表單校驗誤判為有內容。所有對 description 的入口都要過一次本函數。
 */
export function normalizeEditorHtml(html: string): string {
    return html === '<p><br></p>' ? '' : html
}

/**
 * 把 AI 回傳的純文字安全地轉成 Quill 可渲染的 HTML。
 *
 * 步驟：
 *  1. HTML 轉義（防 XSS：&、<、>、"、' 全部換成實體）— & 必須最先換
 *  2. 按 \n{2,} 切段落，模擬 Markdown 段落
 *  3. 段內單一 \n 變 <br>（軟換行）
 *  4. 每段包 <p>，空段塞 <br> 防 Quill 折疊
 */
export function plainTextToHtml(text: string): string {
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

    return escaped
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, '<br>') || '<br>'}</p>`)
        .join('')
}

export function useRepairForm() {
    /**
     * el-form 實例引用，用於提交時手動 validate()、提交成功後 resetFields()。
     * 類型 FormInstance | undefined，使用前須判 truthy。
     */
    const submitFormRef = ref<FormInstance>()

    /**
     * 表單雙向綁定資料對象。
     *  - title:       工單標題（最多 100 字）
     *  - description: 富文本 HTML（由 Quill 寫入，提交時原樣傳給後端）
     */
    const submitForm = reactive({title: '', description: ''})

    /**
     * Element Plus 的 :rules 配置。
     * description 不直接用 max:2000，因為 max 會把 HTML 標籤字符計入長度，
     * 改用 validator 把 HTML 轉純文字再判長度。
     */
    /**
     * 校驗 message 全部用函數形式 + t()，這樣語言切換後重新校驗能拿到新語言文本。
     * 原文：請填寫工單標題 / 標題不超過 100 個字元 / 請填寫問題描述 / 描述不超過 2000 個字元
     */
    const richSubmitRules = {
        title: [
            {required: true, message: () => t('repair.ruleTitleRequired'), trigger: 'blur'},
            {max: 100, message: () => t('repair.ruleTitleMax'), trigger: 'blur'}
        ],
        description: [
            {
                validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
                    const plainText = getPlainText(normalizeEditorHtml(value))
                    if (!plainText) {
                        callback(new Error(t('repair.ruleDescRequired')))
                        return
                    }
                    if (plainText.length > 2000) {
                        callback(new Error(t('repair.ruleDescMax')))
                        return
                    }
                    callback()
                },
                trigger: 'blur'
            }
        ]
    }

    /**
     * 描述純文字字數（依賴 submitForm.description，自動隨編輯器內容變化）。
     * 供模板底部「x/2000」字數提示。
     */
    const descriptionWordCount = computed(() =>
        getPlainText(normalizeEditorHtml(submitForm.description)).length
    )

    return {
        submitFormRef,
        submitForm,
        richSubmitRules,
        descriptionWordCount
    }
}
