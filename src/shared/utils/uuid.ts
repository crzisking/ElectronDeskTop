/**
 * UUID 生成。
 *
 * 用於需要唯一 ID 的場景(訊息 id / 對話 id / 上傳記錄等)。
 *
 * 設計取捨:
 *  - 內網應用,**不需要 cryptographically strong**;`crypto.randomUUID()` 可用就用,
 *    現代 Electron 26+ 全部支援
 *  - fallback 給古老環境(理論上不會發生)用 Math.random + Date.now,有衝突風險但
 *    對本應用的併發量(單機 < 100 ops/sec)足夠
 *  - 不引入第三方套件(uuid / nanoid),減少 bundle size
 */
export function uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}
