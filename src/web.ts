/**
 * web 插件（'cordis:web' 内建）：把整套 Web 核心装进任意 cordis 应用。
 *
 * 与 fetcher 插件对称（fetcher-core 的 fetcher.ts）：
 * - 服务装配在【当前 ctx】上：同一上下文树里的页面插件（provide page.<id>）经 DI 被路由分派
 * - 装配顺序保证：页面插件条目必须排在 web 之前（先提供 page.<id>，启动后即可访问）
 *
 * cordis.yml 用法：
 * ```yaml
 * - id: pages
 *   name: './pages/pages.ts'
 * - id: web
 *   name: 'cordis:web'
 *   config:
 *     config: './web.config.json'   # 可选：server/session/i18n/theme/manage 配置
 *     port: 18080                   # 可选：覆盖监听端口（缺省 18080；被占用自动 +1 顺延）
 *     start: true                   # 可选：apply 即启动（缺省 true）
 * ```
 */
import { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, type WebConfig } from './config.ts'
import { m as markupM, esc as markupEsc } from './markup.ts'
import { ServerService } from './services/server.ts'
import { RouterService } from './services/router.ts'
import { PageService } from './services/page.ts'
import { RenderService } from './services/render.ts'
import { AssetService } from './services/asset.ts'
import { SessionService } from './services/session.ts'
import { I18nService } from './services/i18n.ts'
import { ThemeService } from './services/theme.ts'
import { ManageService } from './services/manage.ts'
import { attachRegistry } from './services/registry.ts'
import { attachPipeline } from './plugins/pipeline.ts'
import { attachConsole } from './plugins/console.ts'

export interface WebPluginConfig {
  /** 配置文件路径（相对 cordis.yml 所在目录或运行目录；结构见 src/config.ts） */
  config?: string
  /** 覆盖监听端口（>0 生效） */
  port?: number
  /** apply 即启动服务器（缺省 true；false = 只装配，由外部 ctx.server.start()） */
  start?: boolean
  /** 自检模式：随机端口 + 跑完整断言（配合 examples/selftest.cordis.yml） */
  selfTest?: boolean
}

/** 装配全部核心服务（同一 ctx 幂等：已存在则跳过）。
 *  注意：服务判定必须用 ctx.get()——本函数可能在 loader 条目 fiber（严格模式）内执行，
 *  直接属性访问（ctx.asset 等）会触发 "cannot get property without inject"。 */
export function assembleWeb(ctx: Context, cfg: WebConfig): Context {
  if (!ctx.get('asset', false)) new AssetService(ctx, cfg.server)
  if (!ctx.get('router', false)) new RouterService(ctx)
  if (!ctx.get('session', false)) new SessionService(ctx, cfg.session)
  if (!ctx.get('i18n', false)) new I18nService(ctx, cfg.i18n)
  if (!ctx.get('theme', false)) new ThemeService(ctx, cfg.theme)
  if (!ctx.get('render', false)) new RenderService(ctx)
  if (!ctx.get('page', false)) new PageService(ctx)
  if (!ctx.get('server', false)) new ServerService(ctx, cfg.server, cfg.router)
  // markup 工具挂到 ctx（页面/区块/布局里 ctx.m / ctx.esc 免 import）
  if (!ctx.get('m', false)) ctx.provide('m', markupM)
  if (!ctx.get('esc', false)) ctx.provide('esc', markupEsc)
  // 事件接线（调度 → 路由 → 渲染 → 输出）+ 控制台日志
  // ⚠️ 函数挂接（非 ctx.plugin）：嵌套 plugin 在 loader 条目 fiber 内永不 apply（见 plugins/pipeline.ts）
  attachPipeline(ctx)
  attachConsole(ctx)
  // 管理后台（可选开启；进程级装配，不随插件热更新卸载）
  if (!ctx.get('manage', false)) {
    new ManageService(ctx, cfg.manage)
    if (cfg.manage.enabled) ctx.get('manage', false)!.mount()
  }
  return ctx
}

export const webPlugin = {
  name: 'motex-web-core/web',
  // 注意：不能 inject 本插件自己装配的服务（自产自销会死锁等待）——
  // 服务访问一律走 ctx.get()（免 inject）；页面/业务插件应声明 inject（cordis 正统）
  apply: async (ctx: Context, config: WebPluginConfig = {}) => {
    // 配置解析（DSH 语义：先按 cordis.yml 目录、再按 CWD）
    const cfg = loadConfig(resolveConfigPath(ctx, config.config))
    if (config.port && config.port > 0) cfg.server.port = config.port

    assembleWeb(ctx, cfg)

    const server = ctx.get('server', false)!
    const start = config.start ?? true
    if (config.selfTest) {
      // 自检模式：随机端口启动；断言由装载器在 loader.await()（全部条目 settle）之后执行
      cfg.server.port = 0
      await server.start()
      // 标记挂 root ctx（fiber 代理禁止未声明属性赋值）
      ;(ctx.root as unknown as { $$selftest?: unknown }).$$selftest = {
        port: server.port(),
        manage: cfg.manage.enabled,
      }
      ctx.logger.warn('[web] selfTest 模式：装配完成，断言待装载器在全部条目就绪后执行')
      return
    }
    if (start) {
      await server.start()
      // 自动注册（registry.url 配置了才生效）：向导航站/注册中心上报并心跳续命
      if (cfg.registry?.url) {
        const detach = attachRegistry(ctx, cfg.registry, server.port())
        ctx.effect(() => {
          return () => detach()
        })
      }
    }
  },
}

export default webPlugin

/** 配置路径解析（DSH 语义）：先按 cordis.yml 所在目录，再按运行目录（CWD）兜底 */
function resolveConfigPath(ctx: Context, p?: string): string | undefined {
  if (!p) return undefined
  if (ctx.baseUrl) {
    try {
      const fromYml = fileURLToPath(new URL(p, ctx.baseUrl))
      if (existsSync(fromYml)) return fromYml
    } catch { /* 非法 URL 忽略，走 CWD */ }
  }
  return resolve(process.cwd(), p)
}