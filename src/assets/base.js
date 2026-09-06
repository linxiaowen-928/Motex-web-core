/**
 * motex-web-core 浏览器增强层（纯原生 JS，无框架、无构建）：
 *
 * 控件注册表模式：页面区块输出 data-motex-<name> 指令元素，
 * base.js 按注册表把这些元素“点亮”为交互控件——控件可扩展：
 *   MOTEX.register('mycontrol', (el, motex) => { ... })
 * 任何页面均可注册自己的控件（区块的 requires 里声明 base.js 即可）。
 *
 * 内置控件：
 *   data-motex-clock            时钟（文本元素）
 *   data-motex-count            计数器按钮（data-motex-count="<目标选择器>"，目标元素 data-n）
 *   data-motex-lang="en-US"     语言切换按钮（写 cookie + 刷新）
 *   data-motex-form             表单防刷新提交（form 元素本身的增强；method/action 走 fetch）
 *   data-motex-confirm="文案"     确认跳转链接（确认后跳 data-href）
 *
 * 页面数据：布局把页面 data 序列化进 <script id="motex-page-data" type="application/json">，
 * 经 MOTEX.data 读取（区块可把初始状态放 data 里，控件据此初始化）。
 */
(function () {
  'use strict'

  const MOTEX = {
    data: null,
    controls: new Map(),

    /** 注册控件（可扩展的核心入口） */
    register(name, fn) {
      this.controls.set(name, fn)
    },

    /** 便捷 API */
    get(url) {
      return fetch(url).then((r) => r.json())
    },
    post(url, body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }).then((r) => r.json())
    },
    setLangCookie(lang) {
      document.cookie = `motex_lang=${encodeURIComponent(lang)}; path=/; max-age=2592000; samesite=lax`
    },

    /** 点亮一个元素（匹配已注册控件） */
    light(el) {
      for (const [name, fn] of this.controls) {
        if (el.hasAttribute && el.hasAttribute(`data-motex-${name}`)) {
          try {
            fn(el, this)
          } catch (e) {
            console.error('[motex] 控件', name, '初始化失败:', e)
          }
        }
      }
    },

    init() {
      const script = document.getElementById('motex-page-data')
      if (script) {
        try {
          this.data = JSON.parse(script.textContent)
        } catch (e) {
          console.warn('[motex] 页面数据解析失败:', e)
        }
      }
      const run = () => {
        document.querySelectorAll('[data-motex-control]').forEach((el) => this.light(el))
        document.querySelectorAll('[data-motex-clock], [data-motex-count], [data-motex-lang], [data-motex-confirm]')
          .forEach((el) => this.light(el))
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run)
      } else {
        run()
      }
    },
  }

  // ===== 内置控件 =====

  // 时钟
  MOTEX.register('clock', (el) => {
    const fmt = () => { el.textContent = new Date().toLocaleTimeString() }
    fmt()
    setInterval(fmt, 1000)
  })

  // 计数器（演示“数据 + 交互”闭环；目标元素必需 data-n 初始值）
  MOTEX.register('count', (el) => {
    const target = document.querySelector(el.getAttribute('data-motex-count'))
    if (!target) return
    let n = Number(target.getAttribute('data-n') ?? 0)
    el.addEventListener('click', () => {
      n++
      target.textContent = String(n)
      target.setAttribute('data-n', String(n))
    })
  })

  // 语言切换（写 cookie 后整页刷新——纯 SSR 的语言切换语义）
  MOTEX.register('lang', (el) => {
    el.addEventListener('click', () => {
      MOTEX.setLangCookie(el.getAttribute('data-motex-lang') || 'zh-CN')
      location.reload()
    })
  })

  // 表单防刷新提交：method/action → fetch JSON；成功可跳转 data-redirect / 提示 data-message
  MOTEX.register('form', (el) => {
    if (el.tagName !== 'FORM') return
    el.addEventListener('submit', (ev) => {
      ev.preventDefault()
      const fd = new FormData(el)
      const body = Object.fromEntries(fd.entries())
      const method = (el.getAttribute('method') || 'POST').toUpperCase()
      const url = el.getAttribute('action') || location.pathname
      fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (r) => {
        const data = await r.json().catch(() => null)
        const redirect = el.getAttribute('data-redirect')
        if (redirect && r.ok) {
          location.href = redirect
          return
        }
        const msgEl = el.parentElement && el.parentElement.querySelector('[data-form-msg]')
        if (msgEl) msgEl.textContent = String(data?.message ?? (r.ok ? 'OK' : 'Error'))
      }).catch((e) => console.error('[motex] 表单提交失败:', e))
    })
  })

  // 确认后跳转（data-href）
  MOTEX.register('confirm', (el) => {
    el.addEventListener('click', (ev) => {
      const msg = el.getAttribute('data-motex-confirm') || '确认执行？'
      const href = el.getAttribute('data-href')
      if (!href) return
      if (window.confirm(msg)) location.href = href
    })
  })

  window.MOTEX = MOTEX
  MOTEX.init()
})()