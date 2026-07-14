/**
 * 靈感速記(docs/21)IPC channels。
 * 速記小窗 + 想法庫共用;全部 invoke,除 IDEA_PUSH_* 是 main → renderer 推送。
 */
export const IdeaCaptureChannels = {
    /** 建立想法(multipart:meta + 附件);回 {clientId} */
    IDEA_CREATE: 'idea:create',
    /** 想法庫「我的」列表 */
    IDEA_LIST_MY: 'idea:list-my',
    /** 想法庫「部門」列表 */
    IDEA_LIST_DEPT: 'idea:list-dept',
    /** 單筆詳情 */
    IDEA_DETAIL: 'idea:detail',
    /** 改狀態 / 三段文字 / 標籤 */
    IDEA_PATCH: 'idea:patch',
    /** 軟刪 */
    IDEA_DELETE: 'idea:delete',
    /** 拉附件(MinIO URL 主進程代拉成 dataURL,避開 renderer CSP) */
    IDEA_GET_ATTACHMENT: 'idea:get-attachment',
    /** 手動補觸發 / 重試後台 AI 完善 */
    IDEA_REFINE: 'idea:refine',
    /** 速記小窗取當下上下文(快捷鍵按下瞬間 main 抓的前景視窗標題) */
    IDEA_GET_CONTEXT: 'idea:get-context',
    /** 速記小窗保存後隱藏自己 */
    IDEA_HIDE_CAPTURE: 'idea:hide-capture',
    /** 讀 idea-capture 配置(熱鍵) */
    IDEA_CONFIG_READ: 'idea:config-read',
    /** 寫 idea-capture 配置(熱鍵) */
    IDEA_CONFIG_WRITE: 'idea:config-write',

    /** PUSH:某筆後台完善完成 → 通知主窗想法庫就地刷新 */
    IDEA_PUSH_REFINED: 'idea:push:refined',
} as const
