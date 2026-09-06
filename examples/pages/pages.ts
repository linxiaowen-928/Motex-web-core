/**
 * 示例站页面插件——演示"一个项目 = 一个 cordis 插件文件"的使用方式：
 *
 * 1. 语言包：ctx.i18n.register（语言学在项目侧）
 * 2. 区块：ctx.page.block（公共区块跨页面复用）
 * 3. 页面：ctx.page.register（布局 + 区块组合 + 数据）
 * 4. API：ctx.router.api（REST；返回值自动 JSON）
 * 5. 会话：ctx.session（cookie 会话计数）
 * 6. 浏览器控件：区块输出 data-motex-* 指令，base.js 点亮
 *
 * ⚠️ cordis v4：apply 内访问 ctx.<服务> 必须声明 inject（见文件底部）。
 */
import { Context } from '@deepseek-ai/cordis'

/** 示例站插件（默认导出 = cordis 插件） */
export default Object.assign(
  function exampleSitePlugin(ctx: Context) {
    // ===== 1. 语言包 =====
    ctx.i18n.register('zh-CN', {
      nav: { home: '首页', about: '关于', counter: '计数器' },
      common: { langSwitch: 'English', siteDesc: '基于 cordis 的 Web 前台框架示例站' },
      home: { heroTitle: 'Motex Web Core', heroSub: 'cordis 声明式装配 · 纯服务端渲染 · 区块扩展', feature1: '页面 = 插件', feature2: '区块 = 服务', feature3: '零前端框架' },
      about: { title: '关于', body: '本示例站由 motex-web-core 渲染：页面插件注册页面，区块服务组装内容，布局输出完整 HTML。' },
      counter: { title: '计数器', desc: '原生 JS 增强层控件（data-motex-count）：点击按钮，目标数字 +1。', clicks: '点击次数' },
    })
    ctx.i18n.register('en-US', {
      nav: { home: 'Home', about: 'About', counter: 'Counter' },
      common: { langSwitch: '中文', siteDesc: 'Example site built on the cordis-based web core' },
      home: { heroTitle: 'Motex Web Core', heroSub: 'cordis declarative assembly · pure SSR · block extensible', feature1: 'Pages as plugins', feature2: 'Blocks as services', feature3: 'No frontend framework' },
      about: { title: 'About', body: 'This example is rendered by motex-web-core: page plugins register pages, block services assemble content, layouts output full HTML.' },
      counter: { title: 'Counter', desc: 'Native JS enhancement control (data-motex-count): click the button to increment.', clicks: 'Click count' },
    })

    // ===== 2. 区块（可跨页面复用的公共区块；ctx.page.block 带类型注册） =====
    // 导航区块：链接 + 语言切换（lang 由 i18n 服务解析，按钮经 base.js 控件写 cookie 刷新）
    ctx.page.block({
      id: 'nav',
      render: ({ ctx: c, req, m: h, esc: e }) => {
        const lang = c.i18n.resolveLang(req)
        const t = (k: string) => c.i18n.t(lang, k)
        const other = lang.startsWith('en') ? 'zh-CN' : 'en-US'
        const link = (path: string, label: string) => h('a', { href: path }, e(label))
        return h('nav', { class: 'motex-nav-block', 'aria-label': 'main' },
          h('ul',
            h('li', link('/', t('nav.home'))),
            h('li', link('/about', t('nav.about'))),
            h('li', link('/counter', t('nav.counter'))),
            h('li', h('button', { class: 'motex-btn motex-btn-ghost', 'data-motex-lang': other, type: 'button' }, e(t('common.langSwitch')))),
          ))
      },
    })

    // 英雄区：展示页面数据 + 区块配置
    ctx.page.block({
      id: 'hero',
      render: ({ ctx: c, req, m: h, esc: e, data }) => {
        const lang = c.i18n.resolveLang(req)
        const t = (k: string) => c.i18n.t(lang, k)
        return h('section', { class: 'motex-hero' },
          h('h1', e(t('home.heroTitle'))),
          h('p', { class: 'motex-hero-sub' }, e(t('home.heroSub'))),
          h('p', { class: 'motex-hero-meta' },
            `页面数据：${e(String((data as { now?: string }).now ?? ''))} · 区块配置：${e(String((data as { tag?: string }).tag ?? ''))}`))
      },
    })

    // 特性列表：data 数组驱动渲染（base.js 由布局统一引入，无需 requires 声明）
    ctx.page.block({
      id: 'features',
      render: ({ ctx: c, req, m: h, esc: e, data }) => {
        const langs = c.i18n.languages()
        const items = (data as { features?: { title: string; desc: string }[] }).features ?? []
        return h('section', { class: 'motex-features' },
          items.length
            ? h('div', { class: 'motex-grid' }, items.map((it) =>
              h('div', { class: 'motex-card' }, h('h3', e(it.title)), h('p', e(it.desc)))))
            : h('p', { class: 'motex-dim' }, 'no features'),
          h('p', { class: 'motex-dim' }, `支持语言：${e(langs.join(' / '))}`))
      },
    })

    // ===== 3. 页面 =====
    ctx.page.register({
      id: 'home', path: '/',
      title: (c, req) => c.i18n.t(c.i18n.resolveLang(req), 'home.heroTitle'),
      blocks: ['nav', { id: 'hero', config: { tag: 'example' } }, 'features'],
      data: async (c, req) => ({
        now: new Date().toLocaleTimeString(c.i18n.resolveLang(req)),
        features: [
          { title: '页面 = 插件', desc: 'ctx.page.register：页面、路径、区块组合一处声明' },
          { title: '区块 = 服务', desc: "ctx.page.block：公共区块可复用、可替换" },
          { title: '零前端框架', desc: '服务端直出 HTML + 原生 base.js 控件（data-motex-*）' },
        ],
      }),
    })

    ctx.page.register({
      id: 'about', path: '/about',
      title: (c, req) => c.i18n.t(c.i18n.resolveLang(req), 'about.title'),
      blocks: ['nav'],
      html: (c, req) => {
        const lang = c.i18n.resolveLang(req)
        const t = (k: string) => c.i18n.t(lang, k)
        return `<article class="motex-card"><h2>${t('about.title')}</h2><p>${t('about.body')}</p></article>`
      },
    })

    ctx.page.register({
      id: 'counter', path: '/counter',
      title: (c, req) => c.i18n.t(c.i18n.resolveLang(req), 'counter.title'),
      blocks: ['nav'],
      data: async () => ({ n: 0 }),
      html: async (c, req, res) => {
        const lang = c.i18n.resolveLang(req)
        const t = (k: string) => c.i18n.t(lang, k)
        const session = await c.session.ensure(req, res!)
        session.data.hits = ((session.data.hits as number) ?? 0) + 1
        return `<div class="motex-card">
  <h2>${t('counter.title')}</h2>
  <p>${t('counter.desc')}</p>
  <p><span id="count-target" data-n="0">0</span> ${t('counter.clicks')}</p>
  <button class="motex-btn" type="button" data-motex-count="#count-target">+1</button>
  <p class="motex-dim">本次会话已访问本页 ${session.data.hits} 次</p>
</div>`
      },
    })

    // ===== 4. API =====
    ctx.router.api('time', '/api/time', () => ({ now: Date.now(), iso: new Date().toISOString() }))
    ctx.router.api('visits', '/api/visits', async (c, req, res) => {
      const session = await c.session.ensure(req, res)
      const n = ((session.data.visits as number) ?? 0) + 1
      session.data.visits = n
      return { ok: true, visits: n }
    })

    // ===== 5. 会话（中间件演示：所有 /api 请求自动带会话） =====
    ctx.router.use(async (c, req, res, next) => {
      if (req.path.startsWith('/api/')) {
        await c.session.ensure(req, res)
      }
      await next()
    })
  },
  {
    // cordis v4 依赖声明：apply 内用到的服务
    inject: ['i18n', 'router', 'page', 'session', 'server'],
  },
)