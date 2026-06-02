/**
 * WorkTemplateCacheService:讀寫本地模板 cache(work_template_cache 表)。
 *
 * 配合 docs/23 Phase A — 模板移到 client。my-config 拉回來的 templateDetail
 * 透過 IPC 進這層落本地。後續 analyze tick 從這層讀,本地組 prompt。
 */

import {eq} from 'drizzle-orm'
import {logger} from '../../../utils/logger'
import type {DatabaseManager} from '../../database-manager'
import {workTemplateCache, type WorkTemplateCache} from './schema'

/** 落地形態 — server templateDetail 反序列化後的結構(items + examples) */
export interface CachedTemplateDetail {
    templateId: number
    version: number
    name: string
    description?: string | null
    promptSnippet?: string | null
    items: CachedTemplateItem[]
}

export interface CachedTemplateItem {
    itemId: number
    code: string
    label: string
    description?: string | null
    color?: string | null
    sortOrder: number
    isActive: boolean
    examples: CachedTemplateExample[]
}

export interface CachedTemplateExample {
    exampleId: number
    content: string
    sortOrder: number
}

export class WorkTemplateCacheService {
    constructor(private readonly dbManager: DatabaseManager) {
    }

    /** 覆寫本地 cache(永遠單行 id=1)。失敗只 log */
    upsert(detail: CachedTemplateDetail): void {
        if (!this.dbManager.isReady()) return
        try {
            this.dbManager.getDb()
                .insert(workTemplateCache)
                .values({
                    id: 1,
                    templateId: detail.templateId,
                    version: detail.version,
                    detailJson: JSON.stringify(detail),
                    updatedAt: Date.now(),
                })
                .onConflictDoUpdate({
                    target: workTemplateCache.id,
                    set: {
                        templateId: detail.templateId,
                        version: detail.version,
                        detailJson: JSON.stringify(detail),
                        updatedAt: Date.now(),
                    },
                })
                .run()
        } catch (err) {
            logger.warn('寫入模板 cache 失敗', 'TemplateCache', err)
        }
    }

    /** 清空本地 cache(管理員把使用者解綁時用)。失敗只 log */
    clear(): void {
        if (!this.dbManager.isReady()) return
        try {
            this.dbManager.getDb().delete(workTemplateCache).where(eq(workTemplateCache.id, 1)).run()
        } catch (err) {
            logger.warn('清空模板 cache 失敗', 'TemplateCache', err)
        }
    }

    /** 讀本地 cache。沒有回 null;JSON 損壞回 null + log */
    read(): CachedTemplateDetail | null {
        if (!this.dbManager.isReady()) return null
        try {
            const row: WorkTemplateCache | undefined = this.dbManager.getDb()
                .select()
                .from(workTemplateCache)
                .where(eq(workTemplateCache.id, 1))
                .get()
            if (!row) return null
            return JSON.parse(row.detailJson) as CachedTemplateDetail
        } catch (err) {
            logger.warn('讀模板 cache 失敗', 'TemplateCache', err)
            return null
        }
    }
}
