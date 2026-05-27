/**
 * code-block-mount — 把 markdown-it 渲染後的 `<pre><code>` 升級成可複製的 CodeBlock 元件
 * (對應 doc 17 §6.2)。
 *
 * 設計動機:
 *   - markdown-it 是純 string → string 的 transform,跟 Vue 解耦,單純好測
 *   - mount 階段 query DOM 升級,語意清晰:純 HTML 是 fallback,有 Vue 環境時加強體驗
 *   - 不需要的場景(例:複製整段 markdown 給 LLM)直接拿原始 HTML 就行
 *
 * 重要:streaming 中**不**呼叫本函式 — `MarkdownRenderer.vue` 用 `props.streaming` 守衛,
 *      流末才升級,避免每幀 mount/unmount 一堆 Vue app 的開銷與閃爍。
 */

import {createApp, h} from 'vue'
import CodeBlock from '../components/CodeBlock.vue'

/**
 * 掃描 container 內所有 `<pre><code>`,逐一替換成 CodeBlock 元件 mount。
 *
 * 返回清理函式陣列;呼叫方應在 unmount / 重新渲染時呼叫,避免 Vue app 洩漏。
 */
export function upgradeCodeBlocks(container: HTMLElement): Array<() => void> {
    const cleanups: Array<() => void> = []
    const codeEls = container.querySelectorAll<HTMLElement>('pre > code')

    codeEls.forEach((codeEl) => {
        const preEl = codeEl.parentElement
        if (!preEl || !(preEl instanceof HTMLPreElement)) return

        // 從 class="hljs language-xxx" 提取語言;沒有就 null(CodeBlock 顯示 'text')
        const langMatch = codeEl.className.match(/language-([^\s]+)/)
        const language = langMatch?.[1] ?? null

        // textContent 是純文字(複製用);innerHTML 已被 hljs highlight 過(展示用)
        const rawCode = codeEl.textContent ?? ''
        const highlightedHtml = codeEl.innerHTML

        // 在原 <pre> 位置建空容器並 mount Vue app
        const mountPoint = document.createElement('div')
        preEl.replaceWith(mountPoint)

        const app = createApp({
            render: () => h(CodeBlock, {highlightedHtml, rawCode, language}),
        })
        app.mount(mountPoint)
        cleanups.push(() => app.unmount())
    })

    return cleanups
}
