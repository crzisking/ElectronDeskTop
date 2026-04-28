<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft,
  ChromeFilled,
  UploadFilled
} from '@element-plus/icons-vue'

import { ElMessage } from 'element-plus'
import IframeContainer from '@/components/common/IframeContainer.vue'
import { useConfigStore } from '@/stores/config.store'
import { aiSopApi } from '@/api/modules/aisop.api'

const router = useRouter()
const configStore = useConfigStore()

const difyUrl = computed<string | undefined>(
    () =>
        configStore.functionsConfig?.tools.find(
            (tool) => tool.id === 'AiSop'
        )?.url
)

function goBack() {
  router.push({
    name: 'internal-functions'
  })
}

function openInBrowser() {
  if (!difyUrl.value) return
  window.open(difyUrl.value, '_blank')
}

const fileList = ref<any[]>([])
const fanWeiTitle = ref('')


/**
 * 上传
 */
const handleUpload = async () => {

  if (!fanWeiTitle.value.trim()) {
    ElMessage.warning('请填写上传标题')
    return
  }

  if (!fileList.value.length) {
    ElMessage.warning('请选择文件')
    return
  }

  const file = fileList.value[0].raw

  const formData = new FormData()
  formData.append('file', file)
  formData.append('title', fanWeiTitle.value)

  try {

    const res:any = await aiSopApi.upload(formData)
    if (res.code === 200) {
      ElMessage.success(
          `上传成功: ${res.message} 文件id:${res.data}`
      )
    } else {
      ElMessage.error(
          `上传失败: ${res.message}`
      )
    }

  } catch (error:any) {

    ElMessage.error(
        `上传失败:${error?.message || error}`
    )

  } finally {

    fileList.value = []
    fanWeiTitle.value = ''

  }

}


/**
 * 删除文件
 */
const handleRemove = (file:any)=>{
  console.log('删除文件',file)
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
              :on-remove="handleRemove"
          >
            <el-icon class="el-icon--upload">
              <UploadFilled />
            </el-icon>

            <div class="el-upload__text">
              拖拽文件到这里 或
              <em>点击选择</em>
            </div>

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


/* 顶部工具栏 */
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


/* 左右布局 */
.content-layout{
  display:flex;
  flex:1;
  min-height:0;
}


/* 左边小 */
.left-panel{
  width:300px;
  min-width:300px;
  overflow:auto;
}


/* 右边大 */
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
