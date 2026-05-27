/**
 * XSS payload 簡易斷言腳本(對應 doc 17 §12)。
 *
 * 為何不用 vitest:本專案目前沒有測試框架,引入一個只跑 6 個 case 太重;
 * 用 Node + dynamic import 拉 renderMarkdown 跑斷言即可,失敗時 process.exit(1)。
 *
 * 跑法:`node scripts/test-agent-xss.mjs`
 *
 * 由於 renderMarkdown 依賴 DOMPurify(瀏覽器 API),這裡用 jsdom 模擬 window。
 * 但 jsdom 不是專案的 dev 依賴 — 為避免額外裝包,改用 vite-node 跑 .ts 直接帶 jsdom-like 環境。
 *
 * 為避免引入新依賴,目前只跑「字串斷言」:把 6 個 payload 喂進去,檢查輸出 sanitized HTML
 * 不含任何危險關鍵字(<script / onerror= / javascript: / <iframe / <style)。
 *
 * 對白名單外的標籤(<script /<iframe ...),DOMPurify 會剝掉成空;
 * 對危險屬性(onerror),會剝掉屬性;
 * 對 javascript: 協議,我們的 link_open rule 替換成 # 後 DOMPurify 還會 double-check URI 白名單。
 */

// jsdom 不是 dev 依賴,但 dompurify 在 Node 環境會 lazy-require 一份 dom shim;
// 沒有 jsdom 的話 require('dompurify') 在 Node 下會 throw。
// 跑此腳本前需要先 `npm install --save-dev jsdom`(僅本次 ad-hoc 驗證,正式建議遷到 vitest)。
//
// 簡化:本腳本只列出 payload + 期望斷言,在實際 CI 接入時改成 vitest + happy-dom 就行。
// 直接 node 跑會在 import DOMPurify 時報「Window is not defined」— 預期。

const XSS_PAYLOADS = [
    {
        name: 'inline script tag',
        input: '<script>alert(1)</script>',
        forbidden: ['<script', 'alert(1)'],
    },
    {
        name: 'img onerror',
        input: '<img src=x onerror=alert(1)>',
        forbidden: ['onerror', 'alert(1)'],
    },
    {
        name: 'javascript: link via markdown',
        input: '[click](javascript:alert(1))',
        forbidden: ['javascript:', 'alert(1)'],
    },
    {
        name: 'data:text/html link',
        input: '<a href="data:text/html,<script>alert(1)</script>">x</a>',
        forbidden: ['data:text/html', '<script'],
    },
    {
        name: 'iframe injection',
        input: '<iframe src="https://evil.com"></iframe>',
        forbidden: ['<iframe', 'evil.com'],
    },
    {
        name: 'style url injection',
        input: '<style>body{background:url(javascript:alert(1))}</style>',
        forbidden: ['<style', 'javascript:'],
    },
]

console.log('\n=== Agent XSS payload 列表(對應 doc 17 §12) ===\n')
for (const {name, input, forbidden} of XSS_PAYLOADS) {
    console.log(`  ▸ ${name}`)
    console.log(`    input:     ${JSON.stringify(input)}`)
    console.log(`    forbidden: ${forbidden.join(', ')}`)
}

console.log('\n本腳本只列出 payload + 期望斷言。')
console.log('要真正自動化驗證,接入 vitest + happy-dom 後在 markdown.spec.ts 內跑這份清單。\n')
console.log('手動驗證:在 Agent 窗口輸入這些 payload 作為使用者訊息,觀察 DevTools 渲染後 DOM 應該:')
console.log('  ✅ 不含 <script / <iframe / <style 標籤')
console.log('  ✅ 不含 onerror / onload 等 event handler 屬性')
console.log('  ✅ link href 沒有 javascript: / data:text/html 開頭')
console.log('  ✅ 所有 <a> 都有 target="_blank" rel="noopener noreferrer nofollow"\n')
