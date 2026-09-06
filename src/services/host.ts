/**
 * host：共享核站点装配（webcore 多站点模式核心）。
 *
 * mountSite(hostCtx, cfg) —— 在一个唯一 cordis 进程（宿主）里挂载一个站点：
 * 1. 业务服务名全隔离的作用域链（page/router/render/session/i18n/theme/manage/server）
 * 2. 站点全套服务装配在作用域上（asset/logger 沿链共享宿主的）
 * 3. 动态加载站点插件文件（import ?v= 击穿）并手动应用——避开 active fiber 内
 *    ctx.plugin() 的延迟坑；插件内 ctx.page.register/ctx.on 等生命周期注册到
 *    调用方 fiber（宿主条目），条目重启/卸载自动清理
 * 4. 站点独立端口 HTTP 服务器：请求处理上下文 = 站点作用域（本站点服务互不可见）
 * 5. 返回 { scope, server, dispose } —— dispose 也挂调用方 fiber 托管
 *
 * 使用（宿主项目内）：
 *   - 每个站点 = 一个条目插件，apply 内调用 await mountSite(ctx, cfg)
 *   - 注册表热更新（--watch）⇒ 站点热挂载/卸载，无需 spawn 进程
 */
import { Context } from '@deepseek-ai/cordis'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultConfig, deepMerge, type WebConfig } from '../config.ts'
import { m as markupM, esc as markupEsc } from '../markup.ts'
import { RouterService } from './router.ts'
import { PageService } from './page.ts'
import { RenderService } from './render.ts'
import { SessionService } from './session.ts'
import { I18nService } from './i18n.ts'
import { ThemeService } from './theme.ts'
import { ManageService } from './manage.ts'
import { ServerService } from './server.ts'

/** 站点业务服务名（全部隔离——各站点互不可见；m/esc/asset 也隔离：站点作用域内 re-provide 不冲突） */
const SITE_SCOPED = ['page', 'router', 'render', 'session', 'i18n', 'theme', 'manage', 'server', 'm', 'esc', 'asset'] as const

/** 站点挂载配置（sites 注册表条目 config） */
export interface HostSiteConfig {
  /** 站点唯一 id */
  id: string
  /** 站点业务配置覆盖（session/i18n/theme/manage/server.port...；与默认深合并） */
  config?: Partial<WebConfig>
  /** 站点插件入口文件（绝对路径或相对宿主进程 cwd；缺省 = 空站点，仅框架页） */
  plugin?: string
  /** 透传给站点插件 apply 的配置 */
  pluginConfig?: unknown
}

export interface SiteMount {
  /** 站点作用域 ctx（站点插件的运行视图） */
  scope: Context
  /** 站点独立端口服务器 */
  server: ServerService
  /** 卸载（幂等）：停服务器 + 站点作用域服务回收 */
  dispose(): Promise<void>
}

/** 动态 import 并解包插件模块（default 优先，兼容具名导出；?v= 击穿 ESM 缓存） */
export async function loadSitePlugin(file: string): Promise<unknown> {
  // 绝对路径（含 Windows 盘符）原样；相对路径按宿主进程 cwd 解析
  const abs = isAbsolute(file) ? file : resolve(process.cwd(), file)
  const url = pathToFileURL(abs).href + `?v=${Date.now()}`
  const mod = await import(url)
  return (mod as { default?: unknown }).default ?? mod
}

/** 挂载一个站点到共享核（宿主条目 apply 内调用） */
export async function mountSite(hostCtx: Context, cfg: HostSiteConfig): Promise<SiteMount> {
  // 站点业务配置：默认 + 站点覆盖深合并（未给 server.port 时 = 18080，由 start 避让顺延）
  const full = deepMerge(defaultConfig(), cfg.config) as WebConfig

  // ===== 1. 隔离作用域链 =====
  let scope: Context = hostCtx
  for (const name of SITE_SCOPED) {
    scope = scope.isolate(name)
  }

  // ===== 2. 站点服务装配（全部落在作用域内；asset 以宿主共享实例注入） =====
  new RouterService(scope)
  new SessionService(scope, full.session)
  new I18nService(scope, full.i18n)
  new ThemeService(scope, full.theme)
  new RenderService(scope, { runtime: scope })
  new PageService(scope, { runtime: scope, ns: cfg.id })
  const server = new ServerService(scope, full.server, full.router, { runtime: scope })
  // markup 工具（作用域内提供；站点插件/区块里 ctx.m / ctx.esc）
  scope.provide('m', markupM)
  scope.provide('esc', markupEsc)
  // asset：共享宿主的静态资源实例（只读无状态；未装配则自建）
  const hostAsset = hostCtx.get('asset', false) as Context['asset'] | undefined
  if (hostAsset) {
    scope.provide('asset', hostAsset)
  } else {
    const { AssetService } = await import('./asset.ts')
    new AssetService(scope, full.server)
  }
  // 站点管理后台（可选；站点作用域内独立）
  if (full.manage.enabled) {
    const mg = new ManageService(scope, full.manage)
    mg.mount()
  }

  // ===== 3. 站点插件（动态加载 + 手动应用：见文件头说明） =====
  if (cfg.plugin) {
    const plugin = await loadSitePlugin(cfg.plugin)
    const apply = typeof plugin === 'function'
      ? plugin as (ctx: Context, config?: unknown) => unknown
      : (plugin as { apply?: (ctx: Context, config?: unknown) => unknown }).apply
    if (typeof apply !== 'function') {
      throw new Error(`[host] 站点 ${cfg.id} 插件 ${cfg.plugin} 未导出可应用的插件（需要 default 函数或 { apply }）`)
    }
    const result = apply(scope, cfg.pluginConfig)
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      await (result as Promise<unknown>)
    }
  }

  // ===== 4. 独立端口 =====
  await server.start()

  // ===== 5. 清理托管（挂调用方 fiber——宿主条目重启/卸载自动执行） =====
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    try { await server.stop() } catch { /* 幂等 */ }
    hostCtx.logger.info('[host] 站点 %s（端口 %d）已卸载', cfg.id, server.port())
  }
  hostCtx.effect(() => {
    return () => { void dispose() }
  })

  hostCtx.logger.info('[host] 站点 %s 已挂载：http://127.0.0.1:%d（插件=%s）', cfg.id, server.port(), cfg.plugin ?? '(无)')
  return { scope, server, dispose }
}

export default mountSite