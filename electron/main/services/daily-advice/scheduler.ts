/**
 * 每日學習建議排程器 — 每天 08:00(本地時間)自動生成,完全在桌面端跑。
 *
 * 生成前置條件(任一不滿足就靜默跳過,首頁會顯示引導):
 *   1. workCollect 綁定了分類模板 → 知道使用者的工種
 *   2. LlmClient 有可用 provider(apiKey 已配置)
 *
 * 觸發時機:
 *   - 每天 08:00:setTimeout 對齊下一個 08:00,之後 24h interval
 *   - 啟動補生成:App 在 08:00 之後才開(常態),啟動 30 秒後檢查今天有沒有,沒有就補
 *   - 手動:首頁「立即生成」按鈕(generateNow,覆蓋今日)
 *
 * 輸入數據:近 7 天 work-collect 紀錄聚合(類別 → 分鐘 + 應用)+ 模板的工種定義。
 * 輸出:{summary, suggestions: [{title, detail, reason}]} 存 daily_advice 表 + 推送首頁。
 */

import {logger} from '../../utils/logger'
import {IpcChannels} from '../../../shared/ipc-channels'
import type {ConfigManager} from '../../config-manager'
import type {WorkRecordService} from '../../db/features/work-collect/service'
import type {WorkTemplateCacheService} from '../../db/features/work-collect/template-cache.service'
import type {DailyAdviceService} from '../../db/features/daily-advice/service'
import type {DailyAdviceRow} from '../../db/features'
import type {LlmClient} from '../llm'
import type {WindowManager} from '../../windows/window-manager'

const TAG = 'DailyAdvice'

const DAY_MS = 86_400_000
/** 每天幾點生成(本地時間) */
const FIRE_HOUR = 8
/** 啟動補生成的延遲 — 讓 DB / 視窗先就緒,也避開啟動高峰 */
const STARTUP_CATCHUP_DELAY_MS = 30_000

/** 首頁初始載入的狀態包 */
export interface DailyAdviceStatus {
    templateBound: boolean
    templateName: string | null
    llmConfigured: boolean
    today: DailyAdviceRow | null
    recent: DailyAdviceRow[]
}

export class DailyAdviceScheduler {
    private dailyTimer: NodeJS.Timeout | null = null
    private catchupTimer: NodeJS.Timeout | null = null
    private generating = false

    constructor(
        private readonly cfg: ConfigManager,
        private readonly workRecords: WorkRecordService,
        private readonly templateCache: WorkTemplateCacheService,
        private readonly store: DailyAdviceService,
        private readonly llm: LlmClient,
        private readonly winMgr: WindowManager,
    ) {
    }

    // ── 生命週期 ────────────────────────────────────────────

    start(): void {
        this.scheduleNextFire()
        // 啟動補生成:今天還沒有建議且已過 08:00 → 補一份
        this.catchupTimer = setTimeout(() => {
            this.catchupTimer = null
            const now = new Date()
            if (now.getHours() >= FIRE_HOUR && !this.store.getByDate(todayKey())) {
                void this.generate('startup-catchup')
            }
        }, STARTUP_CATCHUP_DELAY_MS)
        logger.info('每日學習建議排程已啟動', TAG)
    }

    dispose(): void {
        if (this.dailyTimer) clearTimeout(this.dailyTimer)
        if (this.catchupTimer) clearTimeout(this.catchupTimer)
        this.dailyTimer = null
        this.catchupTimer = null
    }

    /** 首頁初始載入的完整狀態 */
    getStatus(): DailyAdviceStatus {
        const wc = this.cfg.getConfig().workCollect
        return {
            templateBound: wc?.categoryTemplateId != null,
            templateName: wc?.templateName ?? null,
            llmConfigured: this.isLlmConfigured(),
            today: this.store.getByDate(todayKey()),
            recent: this.store.listRecent(7),
        }
    }

    // ── 對外 API(IPC handler 用) ───────────────────────────

    /** 手動立即生成(覆蓋今日);前置不滿足會拋帶說明的錯誤 */
    async generateNow(): Promise<DailyAdviceRow> {
        return this.generate('manual', /* force */ true)
    }

    /** 對齊下一個本地 08:00,觸發後遞迴重排(比 24h interval 更耐時區/休眠漂移) */
    private scheduleNextFire(): void {
        const now = new Date()
        const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), FIRE_HOUR, 0, 0, 0)
        if (next.getTime() <= now.getTime()) next.setTime(next.getTime() + DAY_MS)

        this.dailyTimer = setTimeout(() => {
            void this.generate('scheduled')
            this.scheduleNextFire()
        }, next.getTime() - now.getTime())
    }

    // ── 生成核心 ────────────────────────────────────────────

    private isLlmConfigured(): boolean {
        try {
            this.llm.resolveProvider()
            return true
        } catch {
            return false
        }
    }

    /**
     * 生成一份今日建議。
     * force=false(排程/補生成):前置不滿足靜默跳過、今天已有就不重生。
     * force=true(手動):前置不滿足拋錯給 UI 顯示、覆蓋今日。
     */
    private async generate(trigger: string, force = false): Promise<DailyAdviceRow> {
        if (this.generating) throw new Error('正在生成中,請稍候')

        const wc = this.cfg.getConfig().workCollect
        if (wc?.categoryTemplateId == null) {
            if (!force) {
                logger.info(`[${trigger}] 未綁定工作模板,跳過生成`, TAG)
                throw new Error('skip')
            }
            throw new Error('尚未綁定工作採集模板(到工作自動採集頁綁定後才知道你的工種)')
        }
        if (!this.isLlmConfigured()) {
            if (!force) {
                logger.info(`[${trigger}] LLM provider 未配置,跳過生成`, TAG)
                throw new Error('skip')
            }
            throw new Error('尚未配置 AI 模型(到 設定 → AI Provider 填入 ApiKey)')
        }
        if (!force && this.store.getByDate(todayKey())) {
            logger.info(`[${trigger}] 今日建議已存在,跳過`, TAG)
            throw new Error('skip')
        }

        this.generating = true
        try {
            const row = await this.doGenerate()
            logger.info(`[${trigger}] 今日學習建議已生成(${row.recordCount} 筆紀錄參考)`, TAG)
            this.pushToRenderer(row)
            return row
        } finally {
            this.generating = false
        }
    }

    private async doGenerate(): Promise<DailyAdviceRow> {
        const wc = this.cfg.getConfig().workCollect
        const template = this.templateCache.read()

        // 工種描述:模板名 + 分類定義(label/description),LLM 由此知道「這個人是做什麼的」
        const templateName = template?.name ?? wc?.templateName ?? '未知工種'
        const jobDesc = (template?.items ?? [])
            .map((it) => `- ${it.label}${it.description ? `:${it.description}` : ''}`)
            .join('\n') || '(模板無分類明細)'

        // 近 7 天工作分布 — 只給「類別 + 分鐘」判斷重心。
        // 刻意不傳 activeApp / 視窗標題:那會把具體文件名洩給 LLM,
        // 產出「package.json 怎麼改」這種任務級建議,而我們要的是工種級成長建議。
        const since = Date.now() - 7 * DAY_MS
        const records = this.workRecords.listByRange(since, Date.now(), false)
        const byCategory = new Map<string, number>()
        for (const r of records) {
            const cat = r.category ?? 'unknown'
            byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1)
        }
        const workSummary = Array.from(byCategory.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => `- ${cat}: 約 ${count * 5} 分鐘`)
            .join('\n') || '(近 7 天沒有工作紀錄)'

        const result = await this.llm.complete({
            responseFormat: 'json_object',
            temperature: 0.7,
            messages: [
                {
                    role: 'system',
                    content:
                        '你是職業發展顧問,為使用者的「工種」提供值得投入的成長型學習建議:' +
                        '該領域的最新技術動態與趨勢、進階專業知識、業界方法論與最佳實踐。' +
                        '例:軟件開發 → 新框架/工程實踐/值得關注的技術發布;採購 → 供應鏈知識、談判方法、成本分析進階。\n' +
                        '硬性規則:\n' +
                        '1. 只給工種層面的學習方向,嚴禁提及任何具體文件、具體代碼、具體待辦任務的操作建議\n' +
                        '2. 工作分布只用來判斷使用者最近的工作重心,從而挑更相關的主題\n' +
                        '3. 不要泛泛的「多學習多溝通」,每條都要有具體的主題/關鍵字方便使用者去搜\n' +
                        '回 JSON,用繁體中文。',
                },
                {
                    role: 'user',
                    content:
                        `我的工種:${templateName}\n工種的工作分類:\n${jobDesc}\n\n` +
                        `近 7 天工作重心(僅供判斷方向):\n${workSummary}\n\n` +
                        `請給今天的學習建議,回 JSON:\n` +
                        `{"summary":"一兩句點出我這個工種當下值得關注什麼","suggestions":[` +
                        `{"title":"學習主題","detail":"學什麼/關鍵字/從哪裡入手","reason":"為什麼這個主題對我的工種有價值"}]}\n` +
                        `suggestions 給 2~4 條。`,
                },
            ],
        })

        // 剝 markdown 圍欄 + 驗證 JSON,存庫的一定是合法 JSON
        const cleaned = result.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
        JSON.parse(cleaned)

        const entry = {
            dateKey: todayKey(),
            contentJson: cleaned,
            templateName,
            modelUsed: result.model,
            recordCount: records.length,
            createdAt: Date.now(),
        }
        if (!this.store.upsert(entry)) throw new Error('建議寫入本地資料庫失敗')
        return this.store.getByDate(entry.dateKey)!
    }

    /** 推給主窗(首頁即時刷新);窗沒開就算了,下次打開首頁會主動拉 */
    private pushToRenderer(row: DailyAdviceRow): void {
        const win = this.winMgr.getMainWindow()
        if (win && !win.isDestroyed()) {
            win.webContents.send(IpcChannels.PUSH_DAILY_ADVICE, row)
        }
    }
}

/** 本地日期 'YYYY-MM-DD' */
function todayKey(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
