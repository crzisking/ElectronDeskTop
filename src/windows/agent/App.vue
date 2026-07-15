<!--
  AI Agent 獨立窗主介面(docs/19,Stage 1)。

  左:對話列表(新建 / 切換 / 刪除)。右:訊息串 + 輸入。
  串流:訂閱 AGENT_PUSH_*,delta 累積到當前 assistant 氣泡(Stage 1 用響應式;
  §3.2 的 vanilla controller 熱路徑優化留 Stage 4)。
  未配置模型:頂部橫幅引導去主視窗「模型設定」。
-->
<template>
  <div class="agent-app">
    <!-- 左:對話列表 -->
    <aside class="side">
      <el-button :icon="Plus" class="new-btn" type="primary" @click="newChat">新對話</el-button>
      <el-scrollbar class="conv-list">
        <div
            v-for="c in conversations"
            :key="c.conversationId"
            :class="{active: c.conversationId === activeConvId}"
            class="conv-item"
            @click="selectConversation(c.conversationId)"
        >
          <span class="conv-title">{{ c.title }}</span>
          <el-icon class="conv-del" @click.stop="removeConversation(c.conversationId)">
            <Delete/>
          </el-icon>
        </div>
        <div v-if="!conversations.length" class="conv-empty">還沒有對話</div>
      </el-scrollbar>
    </aside>

    <!-- 右:對話區 -->
    <main class="chat">
      <div v-if="!ready" class="banner">
        ⚠️ 尚未配置模型 —— 請到主視窗的「模型設定」配置 provider(URL + model),再回來重開此窗。
      </div>

      <!-- 當前對話的工作資料夾:chip 條(可多個,➕ 加、× 移除) -->
      <div v-if="activeConvId" class="ws-bar">
        <span v-for="w in activeWorkspaces" :key="w" :title="w" class="ws-chip">
          <el-icon :size="13"><Folder/></el-icon>
          <span class="ws-name">{{ folderName(w) }}</span>
          <el-icon :size="12" class="ws-x" @click="removeWorkspace(w)"><Close/></el-icon>
        </span>
        <span v-if="!activeWorkspaces.length" class="ws-empty">(預設工作目錄)</span>
        <button class="ws-add" title="加入工作資料夾" type="button" @click="addWorkspace">
          <el-icon :size="14">
            <Plus/>
          </el-icon>
        </button>
      </div>

      <!-- 原生滾動容器(不用 el-scrollbar):往上滾觸發懶加載更舊訊息 -->
      <div ref="scrollEl" class="msg-scroll" @scroll="onScroll">
        <div v-if="loadingMore" class="load-more">載入更早的訊息…</div>
        <div class="msg-wrap">
          <template v-for="item in displayItems" :key="item.id">
            <!-- 使用者 / 助理 氣泡 -->
            <div v-if="item.kind === 'user' || item.kind === 'assistant'" :class="`msg--${item.kind}`" class="msg">
              <div class="bubble">
                <div v-if="item.reasoning" class="reasoning-box">
                  <button class="reasoning-toggle" type="button" @click="item.reasoningOpen = !item.reasoningOpen">
                    <el-icon :size="12">
                      <component :is="item.reasoningOpen ? ArrowDown : ArrowRight"/>
                    </el-icon>
                    思考過程{{ item.reasoningOpen ? '' : '(點擊展開)' }}
                  </button>
                  <div v-show="item.reasoningOpen" class="reasoning">{{ item.reasoning }}</div>
                </div>
                <!-- assistant 完成後渲染 markdown;串流中 / user 用純文字 -->
                <div v-if="item.kind === 'assistant' && !item.streaming" class="content markdown"
                     v-html="render(item.content)"/>
                <div v-else class="content">{{ item.content }}<span v-if="item.streaming" class="caret">▋</span></div>
              </div>
            </div>
            <!-- 工具組:連續的工具呼叫折成一塊,預設折疊只顯示一行摘要;展開才逐一列出 -->
            <div v-else-if="item.kind === 'tool-group'" class="msg msg--tool">
              <div class="tool-group">
                <button class="tg-head" type="button" @click="toggleGroup(item.id)">
                  <el-icon :size="12" class="tool-chevron">
                    <component :is="isGroupOpen(item.id) ? ArrowDown : ArrowRight"/>
                  </el-icon>
                  <el-icon :size="13">
                    <Tools/>
                  </el-icon>
                  <span class="tg-summary">{{ groupSummary(item) }}</span>
                  <el-tag v-if="groupRunning(item)" size="small" type="info">執行中</el-tag>
                  <el-tag v-else-if="groupError(item)" size="small" type="danger">部分失敗</el-tag>
                </button>
                <div v-if="isGroupOpen(item.id)" class="tg-body">
                  <div v-for="t in item.tools" :key="t.id" class="tool-line">
                    <button class="tool-head" type="button" @click="t.open = !t.open">
                      <el-icon :size="11" class="tool-chevron">
                        <component :is="t.open ? ArrowDown : ArrowRight"/>
                      </el-icon>
                      <span class="tool-name">{{ t.name }}</span>
                      <span :class="statusClass(t)" class="tool-dot"/>
                    </button>
                    <template v-if="t.open">
                      <pre class="tool-io">{{ shorten(stringify(t.input)) }}</pre>
                      <pre v-if="t.output !== undefined" class="tool-io out">{{ shorten(stringify(t.output)) }}</pre>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <div v-if="!messages.length" class="chat-empty">
            {{ activeConvId ? '開始跟 AI 對話吧' : '點「新對話」選一個工作資料夾開始' }}
          </div>
        </div>
      </div>

      <!-- 輸入 -->
      <div class="input-bar">
        <el-input
            v-model="input"
            :autosize="{minRows: 1, maxRows: 6}"
            :disabled="!ready"
            placeholder="輸入訊息…(Enter 送出,Shift+Enter 換行)"
            type="textarea"
            @keydown.enter.exact.prevent="send"
        />
        <el-button v-if="!sending" :disabled="!ready || !input.trim()" :icon="Promotion" type="primary" @click="send">
          送出
        </el-button>
        <el-button v-else :icon="CircleClose" type="danger" @click="stop">停止</el-button>
      </div>
    </main>

    <!-- 權限彈框:工具要執行時,依 ask 規則問使用者 -->
    <el-dialog
        :close-on-click-modal="false"
        :model-value="!!pendingPerm"
        :show-close="false"
        title="Agent 要執行操作"
        width="500"
        @update:model-value="(v) => { if (!v) respondPerm('deny-once') }"
    >
      <template v-if="pendingPerm">
        <p class="perm-desc">Agent 想使用工具 <b>{{ pendingPerm.tool }}</b>:</p>
        <pre class="perm-body">{{ pendingPerm.subject || stringify(pendingPerm.input) }}</pre>
      </template>
      <template #footer>
        <div class="perm-btns">
          <el-button type="primary" @click="respondPerm('allow-once')">允許本次</el-button>
          <el-button @click="respondPerm('allow-always')">永遠允許 {{ alwaysLabel }}</el-button>
          <el-button @click="respondPerm('deny-once')">拒絕本次</el-button>
          <el-button plain type="danger" @click="respondPerm('deny-always')">永遠拒絕 {{ alwaysLabel }}</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import {onMounted, ref} from 'vue'
import {
  ArrowDown,
  ArrowRight,
  CircleClose,
  Close,
  Delete,
  Folder,
  Plus,
  Promotion,
  Tools
} from '@element-plus/icons-vue'
import {renderMarkdown as render} from './markdown'
import {agentApi} from './api'
import {folderName, useAgentConversations} from './composables/useAgentConversations'
import {useAgentStream} from './composables/useAgentStream'
import {useAgentPermissions} from './composables/useAgentPermissions'
import {useToolGroups} from './composables/useToolGroups'

// 模型是否配好(未配好時 banner 提示 + 停用輸入)
const ready = ref(false)

// 對話 / 訊息 / 工作資料夾 —— 核心狀態擁有者
const conv = useAgentConversations()
const {
  conversations,
  activeConvId,
  activeWorkspaces,
  messages,
  scrollEl,
  loadingMore,
  loadConversations,
  selectConversation,
  onScroll,
  newChat,
  addWorkspace,
  removeWorkspace,
  removeConversation,
} = conv

// 送出 / 停止 / 串流 —— 往 conv 的共享 messages 追加
const {input, sending, send, stop} = useAgentStream({
  messages: conv.messages,
  activeConvId: conv.activeConvId,
  ready,
  scrollBottom: conv.scrollBottom,
  reloadConversations: conv.loadConversations,
})

// 權限彈框
const {pendingPerm, alwaysLabel, respondPerm} = useAgentPermissions()

// 工具組顯示 + input/output 格式化
const {
  displayItems,
  isGroupOpen,
  toggleGroup,
  groupRunning,
  groupError,
  groupSummary,
  statusClass,
  stringify,
  shorten,
} = useToolGroups(conv.messages)

async function loadConfig() {
  try {
    const cfg = await agentApi.configRead()
    ready.value = !!cfg.isReady
  } catch {
    ready.value = false
  }
}

onMounted(async () => {
  await loadConfig()
  await loadConversations()
  // 有舊對話就選第一個;沒有就留空,由使用者點「新對話」選工作資料夾(不自動彈資料夾框)
  if (conversations.value.length) await selectConversation(conversations.value[0].conversationId)
})
</script>

<!-- 非 scoped:鎖死根容器高度,消除視窗層的第二條滾動條(只留訊息區內部滾動) -->
<style>
html,
body,
#agent-app {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
</style>

<style scoped>
.agent-app {
  display: flex;
  height: 100%;
  background: #fafbfc;
  color: #303133;
  font-size: 14px;
}

/* 左側對話列表 */
.side {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid #e4e7ed;
  background: #fff;
  display: flex;
  flex-direction: column;
  padding: 12px;
}

.new-btn {
  width: 100%;
  margin-bottom: 10px;
}

.conv-list {
  flex: 1;
  min-height: 0;
}

.conv-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
}

.conv-item:hover {
  background: #f2f3f5;
}

.conv-item.active {
  background: #ecf5ff;
  color: #409eff;
}

.conv-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-del {
  opacity: 0;
  color: #c0c4cc;
}

.conv-item:hover .conv-del {
  opacity: 1;
}

.conv-del:hover {
  color: #f56c6c;
}

.conv-empty {
  color: #909399;
  font-size: 12px;
  text-align: center;
  margin-top: 20px;
}

/* 右側對話區 */
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.banner {
  background: #fdf6ec;
  color: #b88230;
  padding: 10px 16px;
  font-size: 13px;
  border-bottom: 1px solid #faecd8;
}

.ws-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 16px;
  font-size: 12px;
  color: #606266;
  background: #f5f7fa;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}

.ws-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 3px 6px 3px 8px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
}

.ws-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-x {
  cursor: pointer;
  color: #c0c4cc;
  border-radius: 3px;
}

.ws-x:hover {
  color: #f56c6c;
}

.ws-empty {
  color: #909399;
}

.ws-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px dashed #c0c4cc;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: #606266;
}

.ws-add:hover {
  border-color: #409eff;
  color: #409eff;
}

.msg-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 原生滾軸(細但可見);不用 el-scrollbar,方便懶加載偵測 scrollTop */
.msg-scroll::-webkit-scrollbar {
  width: 10px;
}

.msg-scroll::-webkit-scrollbar-thumb {
  background: #c8ccd4;
  border-radius: 5px;
  border: 2px solid #fafbfc;
}

.msg-scroll::-webkit-scrollbar-thumb:hover {
  background: #a6abb5;
}

.load-more {
  text-align: center;
  color: #909399;
  font-size: 12px;
  padding: 8px 0;
}

.msg-wrap {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.msg {
  display: flex;
}

.msg--user {
  justify-content: flex-end;
}

.msg--assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 10px;
  line-height: 1.6;
}

.msg--user .bubble {
  background: #409eff;
  color: #fff;
}

.msg--assistant .bubble {
  background: #fff;
  border: 1px solid #e4e7ed;
}

.content {
  white-space: pre-wrap;
  word-break: break-word;
}

.reasoning-box {
  margin-bottom: 8px;
}

.reasoning-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: #909399;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.reasoning-toggle:hover {
  color: #606266;
}

.reasoning {
  color: #909399;
  font-size: 12.5px;
  white-space: pre-wrap;
  border-left: 2px solid #dcdfe6;
  padding-left: 8px;
  margin-top: 6px;
}

/* markdown 渲染內容(assistant 完成後) */
.markdown {
  white-space: normal;
  line-height: 1.7;
}

.markdown :deep(p) {
  margin: 0 0 8px;
}

.markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown :deep(pre.hljs) {
  background: #f6f8fa;
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  font-size: 12.5px;
  margin: 8px 0;
}

.markdown :deep(code) {
  font-family: 'Consolas', 'Courier New', monospace;
}

.markdown :deep(:not(pre) > code) {
  background: #f0f2f5;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12.5px;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 4px 0;
  padding-left: 22px;
}

.markdown :deep(a) {
  color: #409eff;
}

.markdown :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}

.markdown :deep(th),
.markdown :deep(td) {
  border: 1px solid #dcdfe6;
  padding: 4px 8px;
}

.caret {
  color: #409eff;
  animation: blink 1s step-start infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

/* 工具組(連續工具呼叫折成一塊,整組預設折疊) */
.msg--tool {
  justify-content: flex-start;
}

.tool-group {
  width: 100%;
}

.tg-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 0;
  text-align: left;
  color: #909399;
  font-size: 12.5px;
}

.tg-head:hover {
  color: #606266;
}

.tg-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tg-body {
  margin-top: 4px;
  padding-left: 6px;
  border-left: 2px solid #ebeef5;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-line {
  padding: 2px 0;
}

.tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  text-align: left;
  color: #606266;
}

.tool-name {
  font-family: 'Consolas', 'Courier New', monospace;
}

.tool-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-ok {
  background: #67c23a;
}

.dot-error {
  background: #f56c6c;
}

.dot-running {
  background: #e6a23c;
  animation: blink 1s step-start infinite;
}

.tool-chevron {
  color: #c0c4cc;
}

.tool-io {
  margin: 6px 0 0;
  padding: 8px;
  background: #f6f8fa;
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow: auto;
}

.tool-io.out {
  background: #f0f9eb;
}

.chat-empty {
  color: #909399;
  text-align: center;
  margin-top: 40px;
}

/* 輸入列 */
.input-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #e4e7ed;
  background: #fff;
  align-items: flex-end;
}

.input-bar .el-textarea {
  flex: 1;
}

/* 權限彈框 */
.perm-desc {
  margin: 0 0 8px;
}

.perm-body {
  margin: 0;
  background: #f6f8fa;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}

.perm-btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.perm-btns .el-button {
  margin: 0;
  width: 100%;
}
</style>
