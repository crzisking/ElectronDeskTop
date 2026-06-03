/**
 * Agent 訊息 Markdown 渲染管線(對應 doc 17 §5)。
 *
 * 三步驟:
 *   1. markdown-it 解析(html:false / linkify / 自訂 link rule 強制 target+rel)
 *   2. highlight.js 高亮 ```code```(按需註冊 16 種語言,bundle 友好)
 *   3. DOMPurify 二次淨化(雙保險:白名單 tags + attrs;封 javascript: / data:text/html / onerror 等)
 *
 * 為何雙保險:
 *   - markdown-it `html:false` 只擋 markdown 解析階段的 raw HTML
 *   - 但 LLM 可能輸出能被 markdown 解析後仍含可疑屬性的內容(例如 link 帶 javascript:)
 *   - DOMPurify 是最終一道防線,並承擔白名單管理
 *
 * 對外只暴露 `renderMarkdown(source)`,單例 md / hljs 內部維護。
 */

import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// ── 語言註冊(主流 + 我們專案常見) ────────────────────────────────────
// 全量 import 會把 hljs bundle 撐到 ~600KB;按需 ~100KB,覆蓋率 90%+。
// alias 多寫幾個對應(js → javascript、py → python ...),容錯 LLM 輸出的習慣寫法。
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cs', csharp)

// ── markdown-it 單例 ──────────────────────────────────────────────────
// 初始化開銷不小(plugin 注冊 / rule 編譯),全 Agent 窗口共用一個 instance。
let _md: MarkdownIt | null = null

function getMd(): MarkdownIt {
    if (_md) return _md

    _md = new MarkdownIt({
        // 安全核心:禁止 markdown 內嵌的 raw HTML,擋 <script>/<img onerror> 從源頭
        html: false,
        xhtmlOut: false,
        // 對話場景單個換行也轉 <br>,UX 更符合直覺
        breaks: true,
        // 自動把 URL 轉 link(後面 link_open rule 統一處理 target/rel)
        linkify: true,
        // 不做引號替換,免得吃掉模型輸出的精確標點
        typographer: false,
        // 代碼高亮鉤子
        highlight(str, lang) {
            // 嘗試指定語言;hljs 不認則 fallthrough escape
            if (lang && hljs.getLanguage(lang)) {
                try {
                    const result = hljs.highlight(str, {language: lang, ignoreIllegals: true})
                    // 包成 <pre><code class="hljs language-xxx"> 讓 code-block-mount 能識別
                    return `<pre><code class="hljs language-${escapeAttr(lang)}">${result.value}</code></pre>`
                } catch {
                    // 失敗就掉到 escape 兜底
                }
            }
            return `<pre><code class="hljs">${_md!.utils.escapeHtml(str)}</code></pre>`
        },
    })

    // ── 自訂 link_open rule:強制 target="_blank" rel="noopener noreferrer" + 擋危險協議
    const defaultLinkOpen =
        _md.renderer.rules.link_open
        ?? ((tokens, idx, options, _env, self) =>
            self.renderToken(tokens, idx, options))

    _md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        const href = token.attrGet('href') ?? ''
        // 拒絕危險協議(IMG dataURL 在 sanitize 階段另外允許)
        if (/^(javascript:|vbscript:|data:text\/html)/i.test(href)) {
            token.attrSet('href', '#')
        }
        token.attrSet('target', '_blank')
        token.attrSet('rel', 'noopener noreferrer nofollow')
        return defaultLinkOpen(tokens, idx, options, env, self)
    }

    return _md
}

function escapeAttr(s: string): string {
    return s.replace(/[<>"&]/g, (c) => `&#${c.charCodeAt(0)};`)
}

// ── DOMPurify 配置 ────────────────────────────────────────────────────
// 白名單比黑名單安全。新標籤要明確加,避免「DOMPurify 預設允許但我們不想允許」的場景。
//
// 型別注:DOMPurify v3 的 type 不再 export 命名空間,直接用 Parameters 推導 sanitize 第二參的 type。
const PURIFY_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
    ALLOWED_TAGS: [
        'p', 'br', 'hr',
        'strong', 'em', 'u', 's', 'del', 'mark',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote',
        'pre', 'code', 'span',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: [
        'href', 'target', 'rel',           // link
        'src', 'alt', 'title', 'width', 'height',  // img
        'class',                            // hljs / future katex
        'data-language',                    // CodeBlock 標籤
    ],
    // 允許的 URI 協議白名單(對 javascript: / data:text/html 拒絕)
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'script'],
    FORBID_ATTR: [
        'onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onblur',
        'style',     // inline style 可能藏 url() / behavior
        'srcset',    // 避免 srcset 繞過 src 檢查
    ],
}

/**
 * 把 markdown source 渲染成 sanitized HTML 字串。
 *
 * 空字串直接返回空字串(避免 streaming 初期的閃爍 / 額外開銷)。
 */
export function renderMarkdown(source: string): string {
    if (!source) return ''
    const raw = getMd().render(source)
    return DOMPurify.sanitize(raw, PURIFY_CONFIG) as unknown as string
}

/**
 * 內部測試 / 開發排查用:取 md instance(不暴露給業務代碼)。
 * 業務代碼一律走 renderMarkdown()。
 */
export function _getMdForDebug(): MarkdownIt {
    return getMd()
}
