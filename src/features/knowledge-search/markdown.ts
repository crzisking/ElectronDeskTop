/**
 * 知識檢索回答的 markdown 渲染(markdown-it + highlight.js)。
 *
 * 安全:html:false —— 不渲染模型輸出裡的 raw HTML(防注入),只解析 markdown 語法;
 * 程式碼區塊用 highlight.js 上色。與 agent 窗口的渲染器同一套策略,但本 feature 自持一份、
 * 不跨 window 耦合(渲染器是純函數,重複成本極低;日後要合可提到 src/shared)。
 */

import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github.css'

const md: MarkdownIt = new MarkdownIt({
    html: false, // 關鍵:不解析輸入裡的 raw HTML,杜絕 XSS(模型輸出不可信)
    linkify: true, // 純文字 URL 自動變連結
    breaks: true, // 單換行也當 <br>,對聊天回答更自然
    highlight(code: string, lang: string): string {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return `<pre class="hljs"><code>${hljs.highlight(code, {language: lang}).value}</code></pre>`
            } catch {
                /* 上色失敗就走下面的純轉義兜底 */
            }
        }
        return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`
    },
})

/** 把 markdown 文字渲染成 HTML 字串(供 v-html;html:false 已保證無 raw HTML 注入)。 */
export function renderMarkdown(text: string): string {
    return md.render(text ?? '')
}
