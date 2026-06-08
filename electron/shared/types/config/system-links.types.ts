/**
 * 側邊欄『系統』分組外部連結配置 — app-config.json 的 "systemLinks" 區塊。
 *
 * 為什麼跟 sidebar.items 分開:
 *   sidebar.items 是路由跳轉項(routeName 驅動內部頁面);
 *   systemLinks.items 是外部 URL 入口,點擊用預設瀏覽器打開。
 *   語意不同,混在一起會讓徽標計數 / 路由高亮邏輯混亂。
 */
export interface SystemLinksConfig {
    /**
     * 連結列表(渲染順序 = 陣列順序)。
     * 用於 SidebarNav.vue「系統」分組 v-for 渲染。
     */
    items: SystemLinkItem[]
}

export interface SystemLinkItem {
    /** 唯一標識符(v-for key) */
    id: string

    /** 顯示文字(折疊狀態下為 tooltip) */
    label: string

    /** Element Plus 圖標駝峰名;例:'Document' → <el-icon><Document /></el-icon> */
    icon: string

    /**
     * 點擊後打開的完整 URL。
     * 透過 window.open(url, '_blank');Electron setWindowOpenHandler 會攔截並轉為
     * shell.openExternal,由系統預設瀏覽器處理。
     */
    url: string

    /** 是否啟用(false 時不渲染) */
    enabled: boolean
}
