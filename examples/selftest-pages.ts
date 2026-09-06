/**
 * 自检页面插件（cordis 插件文件形态——验证相对路径 .ts 插件经 cordis.yml 加载链路）。
 *
 * 覆盖断言面：语言包注册 / 区块服务（page-block.<id>）/ 页面服务（page.<id>）/
 * API 路由 / 全局中间件短路 / 会话（cookie 计数）/ WebSocket 端点。
 *
 * ⚠️ cordis v4 规则：插件 apply 内访问 ctx.<服务> 必须先声明 inject——
 * loader 并行应用条目时，inject 的等服务就绪（web 插件提供）再执行本插件，
 * 这正是"依赖注入协调启动顺序"的本意。
 */
import { Context } from '@deepseek-ai/cordis'

export default Object.assign(
  function selftestPagesPlugin(ctx: Context) {
    // ===== 语言包（项目插件侧） =====
    ctx.i18n.register('zh-CN', { home: { title: '首页', hero: '自检英雄区块' }, common: { site: '自检站' } })
    ctx.i18n.register('en-US', { home: { title: 'Home', hero: 'self-test hero block' }, common: { site: 'Self-test Site' } })

    // ===== 区块 =====
    ctx.page.block({
      id: 'selftest-hero',
      render: ({ ctx: c, req, m: h, esc: e, data, config }) => {
        const lang = c.i18n.resolveLang(req)
        const t = (k: string, p?: Record<string, unknown>) => c.i18n.t(lang, k, p)
        return h('section', { class: 'selftest-hero' },
          h('h1', e(t('home.hero'))),
          h('p', `data=${e(String((data as { v?: unknown }).v ?? ''))} config=${e(String(config ?? ''))}`))
      },
    })

    // ===== 页面（ctx.page.register：注册入口；ctx.page 本身是服务对象） =====
    ctx.page.register({
      id: 'home', path: '/',
      title: (c, req) => c.i18n.t(c.i18n.resolveLang(req), 'home.title'),
      blocks: [{ id: 'selftest-hero', config: 'from-page' }],
      data: async () => ({ v: 'payload' }),
    })

    ctx.page.register({
      id: 'about', path: '/about',
      title: (c, req) => c.i18n.t(c.i18n.resolveLang(req), 'common.site'),
      html: (c, req) => `<h1>${c.i18n.t(c.i18n.resolveLang(req), 'common.site')}</h1>`,
    })

    // 会话计数页（中间件 ensure 会话 → data 读取）
    ctx.page.register({
      id: 'visits', path: '/visits', title: 'Visits',
      middleware: [async (c, req, res, next) => {
        const session = await c.session.ensure(req, res)
        session.data.n = ((session.data.n as number) ?? 0) + 1
        await next()
      }],
      data: async (c, req) => ({ visits: ((await c.session.restore(req))?.data.n as number) ?? 0 }),
      html: async (c, req) => `visits=${((await c.session.restore(req))?.data.n as number) ?? 0}`,
    })

    // ===== API =====
    ctx.router.api('hello', '/api/hello', (_c, req) => {
      return { hello: String(req.query.name ?? 'world') }
    })
    ctx.router.api('echo', '/api/echo', (c, req) => {
      return c.server.parseJson(req)
    }, { method: 'POST' })

    // ===== 全局中间件（短路验证） =====
    ctx.router.route({
      id: 'blocked', path: '/blocked', method: 'GET',
      middleware: [(_c, _req, res) => {
        res.status = 403
        res.text('blocked by middleware')
      }],
      handler: () => 'never', // 不应到达
    })

    // ===== WebSocket =====
    ctx.server.ws('/ws/ping', (socket) => {
      socket.on('message', (d) => socket.send(`pong:${d.toString()}`))
    })
  },
  {
    // 依赖声明：apply 内访问的这些服务须已提供（由 'cordis:web' 条目装配）
    inject: ['i18n', 'router', 'page', 'server', 'session'],
  },
)