/**
 * LLM provider 共用型別 — 跨進程契約。
 *
 * 命名為 `llm.*` 而非 `agent.*`:
 *   Agent UI v1 已移除(改用 pi/piagent 重寫,見 docs/19);這份「provider 列表 +
 *   active 切換」的配置語意更通用,工作分析、未來各種「會打 LLM API」的功能都會用。
 *   Agent v2 上線時若需擴充 thinking/reasoning 等欄位再延伸 LlmConfig 即可。
 *
 * 為何敢跨進程共用:
 *   - 純 TypeScript 型別,沒有 runtime 物件 / 類別實例,序列化乾淨
 *   - preload 透過 ipcRenderer.invoke 傳的本來就是 plain object,雙方按同一份型別解讀即可
 */

/**
 * 單一 LLM 廠商配置(DeepSeek / 通義千問 / OpenAI / 自訂 OpenAI 兼容端點)。
 *
 * 設計動機:
 *   - 同一台機器可能要切換多家供應商(企業內網 + 個人測試)
 *   - 來源可以是 TMBOM 後端統一發 key,也可以使用者手動加
 *   - 每個 provider 內部記住「上次選用的 model」,切 provider 不丟 model 選擇
 */
export interface LlmProviderConfig {
    /** 穩定 ID(後端發來時固定,手動加的用 `custom-${timestamp}`) */
    id: string
    /** 顯示用名稱(「DeepSeek」/「通義千問」/「OpenAI」/ 使用者自訂) */
    label: string
    /** OpenAI 兼容 API 根路徑(例:https://api.deepseek.com、https://dashscope.aliyuncs.com/compatible-mode/v1) */
    baseUrl: string
    /** API Key(明文存在本機 SQLite,對齊製造業內網信任邊界決策) */
    apiKey: string
    /** 該 provider 當前選用的 model;為空 → UI 強制使用者挑一個 */
    model?: string
}

/**
 * LLM 配置整體(寫入 agent_configs 表)。
 *
 * v2 範圍精簡 — 只留多 provider 切換的核心欄位。
 * Agent v1 時代的 systemPrompt / temperature / maxTurns / thinkingEnabled 等
 * 都跟著 UI 一起拿掉了;未來真的需要由各 feature 自己控制(例如工作分析在
 * call site 直接傳 temperature 給 LlmClient),不再放共用 KV。
 */
export interface LlmConfig {
    /**
     * LLM 廠商列表。
     * 為空陣列時,UI 引導使用者添加或從 TMBOM 後端拉取。
     */
    providers?: LlmProviderConfig[]
    /** 當前選中的 provider ID(對應 providers[].id) */
    activeProviderId?: string
}
