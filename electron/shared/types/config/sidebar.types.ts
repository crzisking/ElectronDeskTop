/**
 * 左側邊欄菜單配置 — app-config.json 的 "sidebar" 區塊。
 */
export interface SidebarConfig {
    /**
     * 應用啟動時側邊欄是否默認折疊。
     * true:啟動時折疊(圖標模式)。
     * 用於 App.vue 初始化時 uiStore.setSidebarCollapsed()。
     */
    defaultCollapsed: boolean

    /**
     * 菜單項列表(渲染順序 = 陣列順序)。
     * 用於 SidebarNav.vue v-for 遍歷渲染。
     */
    items: SidebarItem[]
}

/**
 * sidebar.items 陣列的單一菜單項。
 *
 * 對應 JSON:
 *   { "id": "unified-platform", "label": "統一平台", "icon": "Grid",
 *     "routeName": "unified-platform", "enabled": true, "badge": "New" }
 */
export interface SidebarItem {
    /** 唯一標識符(v-for key);建議與 routeName 一致 */
    id: string

    /** 顯示文字(展開時顯示在圖標右側,折疊時為 tooltip) */
    label: string

    /**
     * 圖標標識(Element Plus 圖標駝峰名)。
     * 例:"Grid" → <el-icon><Grid /></el-icon>
     */
    icon: string

    /**
     * Vue Router 命名路由的 name 字段。
     * 點擊執行 router.push({ name: item.routeName })。
     */
    routeName: string

    /**
     * 是否啟用(false 時 v-if 不渲染);軟隱藏,路由本身仍可由 URL 直接訪問。
     * 用途:不重打包改 JSON 快速顯示 / 隱藏功能入口。
     */
    enabled: boolean

    /** 徽標文字(可選),例:"New" / "Beta" / "99+" */
    badge?: string
}
