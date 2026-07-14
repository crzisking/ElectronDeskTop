/**
 * 靈感速記(docs/21)IPC channels。
 *
 * ⚠️ 想法庫的讀取 / 快速修改(list / detail / patch / delete)已改成**渲染端直連後端**
 *    (src/features/idea-capture/api.ts,走 axios),不再過主進程,所以這裡沒有那些 channel。
 *    這裡只留:速記小窗要用的(create / context / hide / config)+ 長任務 AI 完善(refine,
 *    走主進程背景佇列)+ 完善完成推送。
 */
export const IdeaCaptureChannels = {
    /** 建立想法(multipart:meta + 附件);速記小窗用(獨立窗、CSP 鎖死、無 authStore) */
    IDEA_CREATE: 'idea:create',
    /** 觸發後台 AI 完善(長任務:主進程佇列跑後端 Qwen,完成後 push) */
    IDEA_REFINE: 'idea:refine',
    /** 速記小窗取當下上下文(快捷鍵按下瞬間 main 抓的前景視窗標題) */
    IDEA_GET_CONTEXT: 'idea:get-context',
    /** 速記小窗保存後隱藏自己 */
    IDEA_HIDE_CAPTURE: 'idea:hide-capture',
    /** 讀 idea-capture 配置(熱鍵) */
    IDEA_CONFIG_READ: 'idea:config-read',
    /** 寫 idea-capture 配置(熱鍵) */
    IDEA_CONFIG_WRITE: 'idea:config-write',

    /** PUSH:某筆後台完善完成 → 通知主窗想法庫就地刷新該卡 */
    IDEA_PUSH_REFINED: 'idea:push:refined',
    /** PUSH:速記小窗新增了一筆 → 通知主窗想法庫重載列表(跨窗,否則要跳頁才出現) */
    IDEA_PUSH_CREATED: 'idea:push:created',
} as const
