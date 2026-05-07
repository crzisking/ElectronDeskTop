/**
 * useRepairUpload — 圖片上傳 + 附件同步 Composable
 *
 * 職責邊界：
 *  1. 圖片上傳前置校驗（類型 / 大小）
 *  2. 上傳到後端（後端轉 OSS）並把返回 URL 插入 Quill
 *  3. 從編輯器 HTML 中掃描 <img> 同步 uploadedAttachments 列表
 *  4. uploadingCount / uploading 狀態暴露給提交按鈕禁用
 *
 * 為什麼需要 getEditor 注入：
 *  上傳成功後要把 URL 插到 Quill 游標位置，必須拿到 Quill 原生實例。
 *  我們不直接持有實例（避免循環依賴），而是 useRepairEditor 把實例存好後，
 *  通過閉包返回給 useRepairUpload 使用。
 *
 * 注意事項：
 *  - uploadingCount 用整數而非 bool，因為用戶可能同時粘貼多張圖
 *  - syncAttachmentsFromDescription 用 Set 去重，防止複製貼上重複計入
 */
import {computed, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {i18n} from '@/locales'

const t = (key: string, named?: Record<string, unknown>) =>
  named ? i18n.global.t(key, named) : i18n.global.t(key)
import {repairApi} from '@/api/modules/repair.api'
import type {RepairAttachment} from '@/types/api.types'

/** Quill 實例存取器：由 useRepairEditor 提供，避免硬編碼依賴順序 */
type QuillGetter = () => any | null

export function useRepairUpload(getEditor: QuillGetter) {
    /**
     * 已成功上傳並出現在編輯器 HTML 中的圖片列表。
     * 由 syncAttachmentsFromDescription 在每次 text-change 後自動維護：
     *   插入圖 → URL 加入；刪除圖 → URL 移除。
     * 提交時連同描述 HTML 一起傳給後端。
     */
    const uploadedAttachments = ref<RepairAttachment[]>([])

    /**
     * 當前正在上傳的圖片數量。> 0 時禁用提交按鈕。
     * 用整數而非 bool，因為支持並發貼多張圖。
     */
    const uploadingCount = ref(0)

    /** 語義化計算屬性：方便模板用 :disabled="uploading" */
    const uploading = computed(() => uploadingCount.value > 0)

    /**
     * 上傳前置校驗：圖片類型 + 不超過 10MB。
     * @returns true 通過 / false 失敗（已彈 ElMessage）
     */
    function beforeUpload(rawFile: File): boolean {
        if (!rawFile.type.startsWith('image/')) {
            // 原文：只能上傳圖片文件（jpg / png / gif 等）
            ElMessage.error(t('repair.uploadOnlyImage'))
            return false
        }
        if (rawFile.size > 10 * 1024 * 1024) {
            // 原文：{name} 超過 10MB，請壓縮後重試
            ElMessage.error(t('repair.uploadTooLarge', {name: rawFile.name}))
            return false
        }
        return true
    }

    /**
     * 上傳一張圖片並插入 Quill 游標位置。
     *
     * 流程：
     *  1. beforeUpload 校驗（不通過直接 return）
     *  2. uploadingCount++ 鎖提交
     *  3. POST 到 /api/repair/upload，後端中轉 OSS 並返回 fileUrl
     *  4. 取 Quill 當前游標（無焦點則塞末尾）
     *  5. insertEmbed 插入 <img>，source='user' 觸發 text-change 同步附件
     *  6. setSelection 把游標移到圖後方一位
     *  7. finally 中 uploadingCount-- 解鎖
     */
    async function uploadEditorImage(file: File): Promise<void> {
        if (!beforeUpload(file)) return

        uploadingCount.value++
        try {
            const result = await repairApi.uploadFile(file)
            const imageUrl = result.fileUrl
            const editor = getEditor()
            if (!editor) return

            // 取游標：強制聚焦並返回 {index, length}；無焦點返回 null，塞末尾
            const range = editor.getSelection(true) ?? {
                index: editor.getLength?.() ?? 0,
                length: 0
            }

            // 插入圖片，source='user' 確保 text-change 觸發同步附件
            editor.insertEmbed(range.index, 'image', imageUrl, 'user')

            // 游標往後移一位（跳過剛插的圖），'silent' 避免再次觸發 text-change
            editor.setSelection(range.index + 1, 0, 'silent')
        } catch {
            // 原文：圖片上傳失敗，請重試
            ElMessage.error(t('repair.imageUploadFailed'))
        } finally {
            uploadingCount.value--
        }
    }

    /**
     * 從編輯器 HTML 提取所有 <img> URL，覆寫 uploadedAttachments。
     *
     * 調用時機：每次 text-change 後（Quill 內容變化時）。
     * 確保提交時的附件列表 = 編輯器中實際存在的圖片，
     * 用戶刪除圖後 URL 自動移除，不會多帶。
     */
    function syncAttachmentsFromDescription(html: string): void {
        if (!html) {
            uploadedAttachments.value = []
            return
        }
        const container = document.createElement('div')
        container.innerHTML = html
        const urls = Array.from(container.querySelectorAll('img'))
            .map((img) => img.getAttribute('src')?.trim())
            .filter((url): url is string => Boolean(url))

        // Set 去重後映射為附件對象
        uploadedAttachments.value = Array.from(new Set(urls)).map((fileUrl) => ({fileUrl}))
    }

    return {
        uploadedAttachments,
        uploadingCount,
        uploading,
        beforeUpload,
        uploadEditorImage,
        syncAttachmentsFromDescription
    }
}
