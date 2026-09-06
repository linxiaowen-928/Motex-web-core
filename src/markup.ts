/**
 * markup：HTML 渲染工具（服务端直出）。
 *
 * 一切渲染必须经过本模块（自动转义，杜绝 XSS 注入）：
 *   ctx.m('div', { class: 'hero' }, 'hello <world>')
 *   → <div class="hero">hello &lt;world&gt;</div>
 *
 * 区块/页面/布局都返回 Markup 字符串；文档碎片用数组自然拼接。
 */

/** 可渲染值：字符串 / 数组（递归拼接）/ 空值（忽略） */
export type Markup = string | Markup[] | null | undefined | false | number

/** HTML 文本转义 */
export function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 属性值转义（引号内安全） */
export function escAttr(v: unknown): string {
  return esc(v).replace(/'/g, '&#39;')
}

/** 拼接 Markup（数组拍平一层；自动转义纯文本？不——拼接层不转义，转义责任在 m() 与 esc()） */
export function joinMarkup(...parts: Markup[]): string {
  let out = ''
  for (const p of parts) {
    if (p === null || p === undefined || p === false) continue
    if (Array.isArray(p)) {
      out += joinMarkup(...p)
    } else {
      out += String(p)
    }
  }
  return out
}

/** 渲染属性对象 → 属性字符串（含前导空格）；key 为真值时输出；class 支持数组/对象 */
export function attrs(a?: Record<string, unknown> | null): string {
  if (!a) return ''
  let out = ''
  for (const [k, v] of Object.entries(a)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class' && Array.isArray(v)) {
      const cls = v.filter(Boolean).join(' ')
      if (cls) out += ` class="${escAttr(cls)}"`
      continue
    }
    if (v === true) {
      out += ` ${k}`
    } else {
      out += ` ${k}="${escAttr(v)}"`
    }
  }
  return out
}

/**
 * 元素构造：
 *   m('div') / m('div', 'text') / m('div', { class: 'x' }) / m('div', { id: 'a' }, 'text')
 *   children 可多参数或数组；false/null 自动忽略。
 */
export function m(tag: string, ...rest: unknown[]): string {
  let attrsObj: Record<string, unknown> | null = null
  let children: Markup[] = []
  if (rest.length && typeof rest[0] === 'object' && rest[0] !== null && !Array.isArray(rest[0])) {
    attrsObj = rest[0] as Record<string, unknown>
    children = rest.slice(1) as Markup[]
  } else {
    children = rest as Markup[]
  }
  const attrStr = attrs(attrsObj)
  const body = joinMarkup(...children)
  if (body === '' && VOID.has(tag)) return `<${tag}${attrStr}>`
  return `<${tag}${attrStr}>${body}</${tag}>`
}

/** 无需闭合的标签 */
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])

/** 完整 HTML 文档骨架（供布局使用） */
export function document(
  opts: {
    lang?: string
    title?: string
    head?: Markup
    body?: Markup
  },
): string {
  const { lang = 'zh-CN', title = '', head = '', body = '' } = opts
  return `<!DOCTYPE html>
<html lang="${escAttr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${joinMarkup(head)}
</head>
<body>
${joinMarkup(body)}
</body>
</html>
`
}

/** 生成 <script> 标签（src 或内联） */
export function scriptTag(src?: string, inline?: string): string {
  if (src) return `<script src="${escAttr(src)}" defer></script>`
  return `<script>${inline ?? ''}</script>`
}

/** 生成 <link rel="stylesheet"> 标签 */
export function styleTag(href: string): string {
  return `<link rel="stylesheet" href="${escAttr(href)}">`
}

/** 简易 JSON 脚本标签（把数据原样内联给浏览器；注意 !</script 转义） */
export function scriptJson(id: string, data: unknown): string {
  const json = JSON.stringify(data ?? null).replace(/</g, '\\u003c')
  return `<script id="${escAttr(id)}" type="application/json">${json}</script>`
}