/**
 * useRepairEditor — Quill 編輯器生命週期 Composable
 *
 * 職責邊界：
 *  1. 管理 Quill 原生實例（quillInstance），暴露 getEditor 給其他 composable 用
 *  2. text-change 同步：寫回 submitForm.description + 觸發附件掃描
 *  3. paste 攔截：把剪貼板圖片走 useRepairUpload，阻止 Quill 默認 base64 嵌入
 *  4. blur：normalize HTML、同步附件、手動觸發 description 校驗
 *  5. onBeforeUnmount：移除 paste 監聽防內存洩漏
 *
 * 為什麼把 paste 監聽器引用存起來：
 *  Quill 組件可能因 keep-alive / destroy-on-close 重新掛載；
 *  保留 handler 引用才能在重新 mount 時先 removeEventListener 再 add，
 *  避免重複綁定造成貼一張圖觸發多次上傳。
 */
import {onBeforeUnmount, ref} from 'vue'
import type {QuillEditor} from '@vueup/vue-quill'
import type {FormInstance} from 'element-plus'

interface UseRepairEditorOptions {
    /** 表單對象，用於把 Quill HTML 寫回 submitForm.description */
    submitForm: { description: string }
    /** el-form 實例 ref，用於 blur 時手動觸發描述校驗 */
    submitFormRef: { value: FormInstance | undefined }
    /** Quill 空內容標準化函數（從 useRepairForm 傳進來，工具復用） */
    normalizeEditorHtml: (html: string) => string
    /** 從編輯器 HTML 同步附件列表（從 useRepairUpload 傳進來） */
    syncAttachmentsFromDescription: (html: string) => void
    /** 處理粘貼進來的圖片（從 useRepairUpload 傳進來） */
    uploadEditorImage: (file: File) => Promise<void>
}

export function useRepairEditor(opts: UseRepairEditorOptions) {
    /**
     * QuillEditor 組件實例引用（預留擴展，目前未直接調用）。
     * 若要從外部清空編輯器內容，可通過此 ref 訪問組件方法；不過目前用 quillInstance.setContents 處理。
     */
    const quillEditorRef = ref<InstanceType<typeof QuillEditor>>()

    /**
     * Quill 原生實例。
     * 在 handleEditorReady 由 @vueup/vue-quill 傳入並保存。
     * 用 any 是因為 Quill 的 TS 類型定義不完整。
     */
    let quillInstance: any = null

    /**
     * paste 監聽函數引用：保存的目的是在組件重新 mount 時先 remove 再 add，
     * 防止重複綁定。
     */
    let quillPasteHandler: ((event: ClipboardEvent) => void) | null = null

    /**
     * Quill ready 回調：由 QuillEditor 的 @ready 事件觸發。
     * 此時 DOM 已掛載，可安全操作編輯器。
     *
     * 三件事：
     *  1. 保存 Quill 實例
     *  2. text-change 同步表單值與附件列表
     *  3. paste 攔截剪貼板圖片，走自定義上傳流程
     */
    function handleEditorReady(editor: any): void {
        quillInstance = editor

        // 每次內容變化時同步表單值並掃描附件
        quillInstance.on('text-change', () => {
            opts.submitForm.description = opts.normalizeEditorHtml(quillInstance.root.innerHTML)
            opts.syncAttachmentsFromDescription(opts.submitForm.description)
        })

        // 重新 mount 場景下先移除舊 paste 監聽
        if (quillPasteHandler) {
            quillInstance.root.removeEventListener('paste', quillPasteHandler)
        }

        // 自定義 paste 攔截：劫持圖片走後端上傳
        quillPasteHandler = (event: ClipboardEvent) => {
            const items = Array.from(event.clipboardData?.items ?? [])
            const imageItem = items.find((item) => item.type.startsWith('image/'))
            const file = imageItem?.getAsFile()

            // 沒有圖（純文字粘貼）→ 不攔截，讓 Quill 正常處理
            if (!file) return

            // 阻止 Quill 默認的 base64 嵌入（會讓 HTML 體積極大）
            event.preventDefault()

            // void 故意不 await：UI 不阻塞
            void opts.uploadEditorImage(file)
        }

        // 綁到可編輯區（ql-editor），不綁全頁，精確攔截
        quillInstance.root.addEventListener('paste', quillPasteHandler)
    }

    /**
     * 編輯器失焦：normalize HTML、同步附件、觸發 description 校驗。
     *
     * 為何要手動 validateField：Quill 不是原生 input，
     * el-form 無法自動感知 blur，必須我們手動轉發。
     */
    function handleEditorBlur(): void {
        opts.submitForm.description = opts.normalizeEditorHtml(opts.submitForm.description)
        opts.syncAttachmentsFromDescription(opts.submitForm.description)
        opts.submitFormRef.value?.validateField('description').catch(() => undefined)
    }

    /**
     * 取 Quill 實例。提供給 useRepairUpload / useRepairPolish 使用，
     * 避免他們直接訪問 quillInstance 變量造成閉包混亂。
     */
    function getEditor(): any | null {
        return quillInstance
    }

    /**
     * 卸載時移除 paste 監聽。
     * 雖然 DOM 銷毀後監聽器自動失效，但顯式 remove 是良好習慣，
     * 防止 HMR / keep-alive 場景下的潛在洩漏。
     */
    onBeforeUnmount(() => {
        if (quillInstance?.root && quillPasteHandler) {
            quillInstance.root.removeEventListener('paste', quillPasteHandler)
        }
    })

    return {
        quillEditorRef,
        handleEditorReady,
        handleEditorBlur,
        getEditor
    }
}
