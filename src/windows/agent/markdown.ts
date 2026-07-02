/**
 * Agent 對話的 markdown 渲染(markdown-it + highlight.js)。
 *
 * 安全:html:false —— 不渲染 LLM/使用者輸出裡的 raw HTML(防注入),只解析 markdown 語法。
 * 程式碼區塊用 highlight.js 上色;主題走 github.css(打包成 inline style,CSP unsafe-inline 放行)。
 */

import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github.css'

const md: MarkdownIt = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    highlight(code: string, lang: string): string {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return `<pre class="hljs"><code>${hljs.highlight(code, {language: lang}).value}</code></pre>`
            } catch {
                /* fall through */
            }
        }
        return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`
    },
})

export function renderMarkdown(text: string): string {
    return md.render(text ?? '')
}
