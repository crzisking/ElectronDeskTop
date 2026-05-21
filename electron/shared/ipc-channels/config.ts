/**
 * Config 相關 IPC channels。
 */
export const ConfigChannels = {
  /** 讀取當前 config。invoke。返回:AppConfig */
  CONFIG_READ: 'config:read',

  /** 寫入(部分) config,主進程深合並後落地到 app-config.json。invoke */
  CONFIG_WRITE: 'config:write',

  /** 主進程偵測到 app-config.json 被外部編輯,熱通知渲染端重 load。send(main→renderer) */
  PUSH_CONFIG_CHANGED: 'push:config-changed',
} as const
