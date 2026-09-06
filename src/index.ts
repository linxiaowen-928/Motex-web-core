/**
 * motex-web-core 入口：createWebApp/assembleWeb/runWeb/main（CLI）+ 全部服务类导出。
 *
 * 用法（库）：
 *   createWebApp(cfg, opts)          —— 独立 Context 上装配全部 Web 服务（可替换服务/插件/钩子）
 *   runWeb(cfg, opts)                —— 装配 + 启动，返回 { app, port, stop }
 *   webPlugin                        —— cordis 插件形式（src/web.ts），配合 loader 的 cordis.yml
 *
 * CLI（src/cli.ts）：
 *   node --experimental-strip-types src/cli.ts --cordis app.web.cordis.yml [--watch] [--port N]
 *   node --experimental-strip-types src/cli.ts --self-test
 */
import { Context } from '@deepseek-ai/cordis'
import { loadConfig, type WebConfig } from './config.ts'
import { assembleWeb } from './web.ts'
import { runSelfTest } from './selftest.ts'

export { deepMerge, defaultConfig, loadConfig } from './config.ts'
export type { WebConfig, ServerConfig, SessionConfig, I18nConfig, ThemeConfig, ManageConfig } from './config.ts'
export { esc, escAttr, attrs, m, joinMarkup, document, scriptTag, styleTag, scriptJson } from './markup.ts'
export type { Markup } from './markup.ts'
export { HttpError } from './services/server.ts'
export { matchPath } from './services/router.ts'
export * from './types.ts'

export { ServerService } from './services/server.ts'
export { RouterService } from './services/router.ts'
export { PageService } from './services/page.ts'
export { RenderService } from './services/render.ts'
export { AssetService } from './services/asset.ts'
export { SessionService } from './services/session.ts'
export { I18nService } from './services/i18n.ts'
export { ThemeService } from './services/theme.ts'
export { ManageService } from './services/manage.ts'
export { mountSite, loadSitePlugin } from './services/host.ts'
export type { HostSiteConfig, SiteMount } from './services/host.ts'
export { attachRegistry, REGISTRY_TTL_SEC } from './services/registry.ts'
export { webPlugin, assembleWeb } from './web.ts'

/** 扩展选项：把 cordis 的 DI/事件/插件能力暴露给使用方（fetcher-core 同款模型） */
export interface WebCoreOptions {
  /** 替换核心服务（自定义实现/继承默认类魔改；构造参数与默认类相同） */
  services?: Partial<{
    server: new (ctx: Context, config: WebConfig['server'], routerConfig: WebConfig['router']) => import('./services/server.ts').ServerService
    router: new (ctx: Context) => import('./services/router.ts').RouterService
    page: new (ctx: Context) => import('./services/page.ts').PageService
    render: new (ctx: Context) => import('./services/render.ts').RenderService
    asset: new (ctx: Context, config: WebConfig['server']) => import('./services/asset.ts').AssetService
    session: new (ctx: Context, config: WebConfig['session']) => import('./services/session.ts').SessionService
    i18n: new (ctx: Context, config: WebConfig['i18n']) => import('./services/i18n.ts').I18nService
    theme: new (ctx: Context, config: WebConfig['theme']) => import('./services/theme.ts').ThemeService
  }>
  /** 额外 cordis 插件（监听事件、注入服务） */
  plugins?: any[]
  /** 装配前/后钩子（任意魔改，如覆盖路由/中间件） */
  beforeServices?: (ctx: Context, cfg: WebConfig) => void
  afterServices?: (ctx: Context, cfg: WebConfig) => void
}

/** 在【给定】cordis 上下文上装配全部 Web 服务（可替换服务/插件/钩子），返回同一 ctx。
 *  用途：web 插件把服务装到 loader 的 ctx 树上，与页面插件共享 DI/事件。 */
export function createWebApp(cfg: WebConfig, opts: WebCoreOptions = {}): Context {
  const app = new Context()
  opts.beforeServices?.(app, cfg)
  // 可替换服务：先构造自定义实现（assembleWeb 检测已存在则跳过）
  const S = opts.services
  if (S?.server) new S.server(app, cfg.server, cfg.router)
  if (S?.router) new S.router(app)
  if (S?.page) new S.page(app)
  if (S?.render) new S.render(app)
  if (S?.asset) new S.asset(app, cfg.server)
  if (S?.session) new S.session(app, cfg.session)
  if (S?.i18n) new S.i18n(app, cfg.i18n)
  if (S?.theme) new S.theme(app, cfg.theme)
  assembleWeb(app, cfg)
  for (const p of opts.plugins ?? []) app.plugin(p, cfg)
  opts.afterServices?.(app, cfg)
  return app
}

/** 装配 + 启动（程序化使用主入口） */
export async function runWeb(
  cfg: WebConfig,
  opts: WebCoreOptions = {},
): Promise<{ app: Context; port: number; stop: () => Promise<void> }> {
  const app = createWebApp(cfg, opts)
  const port = await app.server.start()
  return { app, port, stop: () => app.server.stop() }
}

/** CLI 直跑模式（--config / --port）：加载配置 → 装配 → 启动（常驻） */
export async function main(argv?: string[], opts: WebCoreOptions = {}): Promise<void> {
  const args = argv ?? process.argv.slice(2)
  if (args.includes('--self-test')) {
    await runSelfTest()
    return
  }
  const cfg = loadConfig(parseConfigPath(args))
  const port = Number(getArg(args, '--port') ?? '0') || 0
  if (port > 0) cfg.server.port = port
  const { app, port: actual } = await runWeb(cfg, opts)
  // 直跑模式：进程由 HTTP 服务器维持；Ctrl+C 优雅退出
  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    await app.server.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  console.log(`[motex-web] 站点已启动 http://127.0.0.1:${actual}（Ctrl+C 退出）`)
}

function parseConfigPath(args: string[]): string | undefined {
  const i = args.indexOf('--config')
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
}

function getArg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
}