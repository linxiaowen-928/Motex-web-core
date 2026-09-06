/**
 * 自检：真实监听随机端口 + 本地 HTTP 断言全链路：
 *   页面(区块/布局/标题) → i18n（语言切换） → API(JSON/表单) → 会话(cookie 计数)
 *   → 中间件短路 → 404 → 静态资源 → 管理后台(页+API) → WebSocket 回声
 *
 * 两条路径共用同一断言集：
 *   npm run self-test          —— main 路径（createWebApp + 插件形式）
 *   npm run self-test-cordis   —— cordis 装配链路（loader → 相对路径页面插件 → web 插件）
 *
 * 零外部网络：全部请求打本机回环。
 * 期望输出：[self-test] ALL PASS ✅
 */
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { loadConfig } from './config.ts'
import { createWebApp } from './index.ts'
import { mountCordis } from './loader.ts'
import selftestPagesPlugin from '../examples/selftest-pages.ts'

interface Check {
  name: string
  ok: boolean
  detail?: string
}

export interface SelfTestOptions {
  /** 是否断言管理后台（装配时 manage.enabled 需为 true） */
  manage?: boolean
}

/** 对运行中的服务器跑断言集（发送真实 HTTP/WS 请求到 base） */
export async function assertServer(port: number, opts: SelfTestOptions = {}): Promise<Check[]> {
  const checks: Check[] = []
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail: ok ? undefined : detail })

  const base = `http://127.0.0.1:${port}`
  const get = async (path: string, headers?: Record<string, string>) => {
    const res = await fetch(base + path, { headers })
    return { status: res.status, text: await res.text(), headers: res.headers }
  }
  const postJson = async (path: string, body: unknown) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, text: await res.text(), headers: res.headers }
  }

  // 1. 首页：200 + 区块渲染 + 布局外壳 + 资源
  const home = await get('/')
  check('home', home.status === 200
    && home.text.includes('selftest-hero')
    && home.text.includes('data=payload config=from-page')
    && home.text.includes('class="motex-app"')
    && home.text.includes('base.css')
    && (home.headers.get('content-type') ?? '').includes('text/html'),
  `status=${home.status} len=${home.text.length}`)

  // 2. 标题：页面标题 + 站点后缀
  const titleOk = /<title>首页 · 自检站<\/title>/.test(home.text)
  check('title', titleOk, home.text.match(/<title>(.*?)<\/title>/)?.[1] ?? '(no title)')

  // 3. i18n：?lang=en-US 切换
  const en = await get('/?lang=en-US')
  check('i18n-en', en.status === 200 && en.text.includes('self-test hero block'), en.text.slice(0, 200))
  const zh = await get('/about')
  check('i18n-zh', zh.status === 200 && zh.text.includes('自检站'))

  // 4. API JSON + query
  const hello = await get('/api/hello?name=motex')
  check('api-json', hello.status === 200 && hello.text.includes('"hello":"motex"'), hello.text.slice(0, 120))

  // 5. API POST JSON body
  const echo = await postJson('/api/echo', { a: 1, b: 'x' })
  check('api-post', echo.status === 200 && echo.text.includes('"a":1') && echo.text.includes('"b":"x"'), echo.text.slice(0, 120))

  // 6. 会话：两次请求计数递增
  const v1 = await get('/visits')
  const cookie = v1.headers.get('set-cookie')?.split(';')[0] ?? ''
  const v2 = await get('/visits', { cookie })
  const n1 = /visits=(\d+)/.exec(v1.text)?.[1]
  const n2 = /visits=(\d+)/.exec(v2.text)?.[1]
  check('session', v1.status === 200 && cookie.startsWith('motex_sid=')
    && n1 === '1' && n2 === '2'
    && Boolean(v2.headers.get('set-cookie')),
  `cookie=${cookie.slice(0, 24)}… n1=${n1} n2=${n2}`)

  // 7. 中间件短路
  const blocked = await get('/blocked')
  check('middleware-short-circuit', blocked.status === 403 && blocked.text.includes('blocked'), `${blocked.status}`)

  // 8. 404 兜底（pretty）
  const nf = await get('/no-such-page')
  check('404', nf.status === 404 && nf.text.includes('404'), `${nf.status}`)

  // 9. 静态资源
  const css = await get('/assets/base.css')
  check('static-css', css.status === 200 && (css.headers.get('content-type') ?? '').includes('text/css'), `${css.status}`)

  // 10. 管理后台
  if (opts.manage) {
    const mg = await get('/manage')
    check('manage-page', mg.status === 200 && mg.text.includes('管理后台'), `${mg.status}`)
    const mgApi = await get('/manage/api/status')
    check('manage-api', mgApi.status === 200 && mgApi.text.includes('"ok":true') && mgApi.text.includes('"pages"'), mgApi.text.slice(0, 120))
    const routes = await get('/manage/api/routes')
    check('manage-api-routes', routes.status === 200 && routes.text.includes('/api/hello'), routes.text.slice(0, 120))
  }

  // 11. WebSocket 回声
  const wsOk = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/ping`)
    const timer = setTimeout(() => { ws.close(); resolve(false) }, 3000)
    ws.on('open', () => ws.send('ping'))
    ws.on('message', (d) => {
      clearTimeout(timer)
      resolve(d.toString() === 'pong:ping')
      ws.close()
    })
    ws.on('error', () => { clearTimeout(timer); resolve(false) })
  })
  check('ws-echo', wsOk)

  return checks
}

/** 打印断言结果；全部通过输出 ALL PASS；否则置退出码 1 */
export function reportChecks(checks: Check[]): boolean {
  const allOk = checks.every((c) => c.ok)
  console.log('[self-test]', checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.name}`).join('\n            '))
  console.log('[self-test]', allOk ? 'ALL PASS ✅' : JSON.stringify(checks.filter((c) => !c.ok).map((c) => ({ name: c.name, detail: c.detail })), null, 2))
  return allOk
}

/** main 路径自检（npm run self-test）：createWebApp + 插件直接装配 */
export async function runSelfTest(): Promise<boolean> {
  const cfg = loadConfig()
  cfg.server.port = 0 // 随机端口
  cfg.server.host = '127.0.0.1'
  cfg.theme.siteName = '自检站' // 标题断言依赖
  cfg.manage.enabled = true
  cfg.manage.api = true
  cfg.manage.web = true

  const app = createWebApp(cfg, { plugins: [selftestPagesPlugin] })
  await app.server.start()
  const port = app.server.port()
  app.logger.info('[self-test] main 路径自检，随机端口 %d', port)
  const checks = await assertServer(port, { manage: true })
  await app.server.stop()
  return reportChecks(checks)
}

/** cordis 装配链路自检（npm run self-test-cordis）：loader → 相对路径页面插件 → web 插件 */
export async function runSelfTestCordis(): Promise<boolean> {
  const cordisPath = join(process.cwd(), 'examples', 'selftest.cordis.yml')
  const { app, close } = await mountCordis(cordisPath)
  const port = app.server.port()
  app.logger.info('[self-test] cordis 装配链路自检，随机端口 %d（%s）', port, cordisPath)
  const checks = await assertServer(port, { manage: true })
  close?.()
  await app.server.stop().catch(() => {})
  await app.loader.root?.stop().catch(() => {})
  return reportChecks(checks)
}

export default runSelfTest