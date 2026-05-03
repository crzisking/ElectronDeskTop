<script setup lang="ts">
/**
 * AiSop 文件上傳視圖
 *
 * 功能：
 *  - 上傳文件至泛微系統發佈
 *  - 右側嵌入 Dify AI SOP 頁面
 *
 * 上傳限制：
 *  - 文件類型：PDF、Word、Excel、PPT、圖片、文字檔
 *  - 文件大小：最大 20MB
 */

import {computed, ref} from 'vue'
import {useRouter} from 'vue-router'
import {ArrowLeft, ChromeFilled, UploadFilled} from '@element-plus/icons-vue'
import type {UploadFile} from 'element-plus'
import {ElMessage} from 'element-plus'
import IframeContainer from '@/components/common/IframeContainer.vue'
import {useConfigStore} from '@/stores/config.store'
import {aiSopApi} from '@/api/modules/aisop.api'

/**
 * AiSop 上傳響應的業務數據類型
 * 後端返回 { code, message, data }，攔截器剝離後 res = data
 * AiSop 的 data 是文件 ID（字串或數字）
 */
interface AiSopUploadResult {
  data?: string | number
  fileId?: string | number

  [key: string]: unknown
}

/** 允許上傳的文件 MIME 類型 */
const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]

/** 允許上傳的文件副檔名（後備判斷，部分系統 MIME 不準確） */
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.webp']

/** 最大文件大小（20MB） */
const MAX_FILE_SIZE = 20 * 1024 * 1024

const router = useRouter()
const configStore = useConfigStore()

const difyUrl = computed<string | undefined>(
    () =>
        configStore.functionsConfig?.tools.find(
            (tool) => tool.id === 'AiSop'
        )?.url
)

function goBack() {
  router.push({name: 'internal-functions'})
}

function openInBrowser() {
  if (!difyUrl.value) return
  window.open(difyUrl.value, '_blank')
}

const fileList = ref<UploadFile[]>([])
const fanWeiTitle = ref('')

/**
 * 上傳前校驗：檢查文件類型和大小
 * 返回 false 阻止上傳
 */
function beforeUpload(rawFile: File): boolean {
  const ext = '.' + rawFile.name.split('.').pop()?.toLowerCase()
  const typeOk = ALLOWED_TYPES.includes(rawFile.type) || ALLOWED_EXTENSIONS.includes(ext)
  if (!typeOk) {
    ElMessage.error('不支援的文件類型，僅允許 PDF、Word、Excel、PPT、圖片、文字檔')
    return false
  }
  if (rawFile.size > MAX_FILE_SIZE) {
    ElMessage.error(`${rawFile.name} 超過 20MB，請壓縮後重試`)
    return false
  }
  return true
}

/** 上傳文件至泛微 */
async function handleUpload() {
  if (!fanWeiTitle.value.trim()) {
    ElMessage.warning('請填寫上傳標題')
    return
  }

  if (!fileList.value.length) {
    ElMessage.warning('請選擇文件')
    return
  }

  const rawFile = fileList.value[0].raw
  if (!rawFile) return

  const formData = new FormData()
  formData.append('file', rawFile)
  formData.append('title', fanWeiTitle.value)

  try {
    const res = await aiSopApi.upload(formData) as AiSopUploadResult
    const fileId = res?.data ?? res?.fileId ?? ''
    ElMessage.success(`上傳成功！文件id：${fileId}`)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    ElMessage.error(`上傳失敗：${msg}`)
  } finally {
    fileList.value = []
    fanWeiTitle.value = ''
  }
}
</script>

<template>
  <div class="bpm-finder-view">

    <div class="toolbar">
      <el-button
          :icon="ArrowLeft"
          text
          @click="goBack"
      >
        返回
      </el-button>

      <span class="toolbar-title">
        AiSop
      </span>

      <div class="toolbar-spacer" />

      <el-button
          v-if="difyUrl"
          text
          :icon="ChromeFilled"
          @click="openInBrowser"
      >
        在瀏覽器開啟
      </el-button>
    </div>


    <!-- 左右布局 -->
    <div class="content-layout">

      <!-- 左侧 -->
      <div class="left-panel">
        <el-card shadow="hover">
          <template #header>
            <span>
              上傳文件至泛微發佈
            </span>
          </template>

          <el-input
              v-model="fanWeiTitle"
              placeholder="請輸入文檔標題"
          />

          <el-upload
              v-model:file-list="fileList"
              drag
              :auto-upload="false"
              :before-upload="beforeUpload"
              :limit="1"
          >
            <el-icon class="el-icon--upload">
              <UploadFilled />
            </el-icon>

            <div class="el-upload__text">
              拖拽文件到這裡 或
              <em>點擊選擇</em>
            </div>

            <template #tip>
              <div class="el-upload__tip">
                支援 PDF、Word、Excel、PPT、圖片、文字檔，最大 20MB
              </div>
            </template>
          </el-upload>

          <el-button
              type="primary"
              @click="handleUpload"
          >
            上傳
          </el-button>

        </el-card>
      </div>


      <!-- 右侧 -->
      <div class="right-panel">
        <div class="iframe-wrapper">

          <IframeContainer
              v-if="difyUrl"
              :src="difyUrl"
              title="BPM Finder"
          />

          <el-empty
              v-else
              description="尚未設定 Dify 網址"
              :image-size="120"
          />

        </div>
      </div>

    </div>

  </div>
</template>


<style scoped>

.bpm-finder-view{
  display:flex;
  flex-direction:column;
  height:100%;
  background:var(--app-bg-surface);
}

.toolbar{
  display:flex;
  align-items:center;
  gap:12px;
  padding:14px 24px;
  border-bottom:1px solid var(--app-border-subtle);
  flex-shrink:0;
}

.toolbar-title{
  font-size:15px;
  font-weight:600;
}

.toolbar-spacer{
  flex:1;
}

.content-layout{
  display:flex;
  flex:1;
  min-height:0;
}

.left-panel{
  width:300px;
  min-width:300px;
  overflow:auto;
}

.right-panel{
  flex:1;
  min-width:0;
  overflow:hidden;
  padding:16px;
}

.iframe-wrapper{
  height:100%;
  min-height:0;
}

</style>
