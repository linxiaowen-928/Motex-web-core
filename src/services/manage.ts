/**
 * 管理服务（可选开启，缺省关闭——与 fetcher-core 的 manage 语义一致）：
 * - 管理页（纯 SSR 渲染，极简自带样式）：状态一览 / 路由表 / 页面与区块清单
 * - 管理 API：状态 / 路由 / 页面清单 / 清空会话 / 主题切换（轻量运维）
 *
 * 装配：web 插件按 config.manage.enabled 决定是否挂载；管理路径可配置。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { ManageConfig } from '../config.ts'
import { document, esc, joinMarkup, m, styleTag, type Markup } from '../markup.ts'
import type { RouterService } from './router.ts'

export class ManageService extends Service {
  readonly config: ManageConfig

  constructor(ctx: Context, config: ManageConfig) {
    super(ctx, 'manage')
    this.config = config
  }

  /** 挂载管理页 + API 路由（进程级生命周期；核心服务不随插件热更新卸载）。
   *  服务访问走 ctx.get()（本函数可能在 loader 条目 apply 内执行，属性访问会触发 inject 检查） */
  mount(): () => void {
    const base = this.config.path.replace(/\/+$/, '')
    const disposes: (() => void)[] = []
    const router = this.ctx.get('router', false) as unknown as RouterService
    if (this.config.web) {
      disposes.push(router.route({
        id: 'manage-page',
        path: base,
        method: 'GET',
        priority: 100, // 高优先级：/base 精确命中，不挡项目路由
        handler: async (ctx, _req, res) => {
          res.html(await this.render(ctx))
        },
      }))
    }
    if (this.config.api) {
      disposes.push(router.api('manage-api-status', `${base}/api/status`, (ctx) => this.status(ctx), { priority: 100 }))
      disposes.push(router.api('manage-api-routes', `${base}/api/routes`, (ctx) => this.routes(ctx), { priority: 100 }))
      disposes.push(router.api('manage-api-clear-sessions', `${base}/api/clear-sessions`, (ctx) => {
        const n = ctx.session.clearAll()
        this.ctx.logger.warn('[manage] 清空会话 %d 个', n)
        return { ok: true, cleared: n }
      }, { method: 'POST', priority: 100 }))
    }
    this.ctx.logger.info('[manage] 管理后台：%s（api=%s web=%s）', base, this.config.api, this.config.web)
    return () => {
      for (const d of disposes) d()
    }
  }

  private status(ctx: Context) {
    return {
      ok: true,
      siteName: ctx.theme.siteName(),
      theme: ctx.theme.themeId(),
      port: ctx.server.port(),
      startedAt: ctx.server.startedAt,
      languages: ctx.i18n.languages(),
      defaultLang: ctx.i18n.config.defaultLang,
      pages: ctx.page.list().map((p) => ({ id: p.id, path: p.path ?? `/${p.id}` })),
      blockCount: 0, // 区块经 DI 注册，无集中清单（预留）
      sessionCount: ctx.session.count(),
      routes: ctx.router.all().length,
      manage: { path: this.config.path, enabled: true },
    }
  }

  private routes(ctx: Context) {
    return {
      ok: true,
      routes: ctx.router.all().map((r) => ({
        id: r.id, method: r.method, path: r.path, priority: r.priority ?? 0,
      })),
    }
  }

  /** 管理页渲染（独立布局，不套项目主题布局） */
  private async render(ctx: Context): Promise<string> {
    const st = this.status(ctx)
    const routeList = ctx.router.all()
    const h = m
    const cards: Markup[] = [
      h('div', { class: 'mg-card' },
        h('h3', '站点'),
        h('p', `名称：${esc(st.siteName)} ｜ 主题：${esc(st.theme)} ｜ 语言：${esc(st.languages.join(', '))}`),
        h('p', `端口：${esc(String(st.port))} ｜ 启动：${esc(new Date(st.startedAt).toLocaleString())}`)),
      h('div', { class: 'mg-card' },
        h('h3', '运行态'),
        h('p', `会话（memory）：${esc(String(st.sessionCount))} ｜ 页面：${esc(String(st.pages.length))} ｜ 路由：${esc(String(st.routes))}`)),
      h('div', { class: 'mg-card' },
        h('h3', '页面清单'),
        st.pages.length
          ? h('table', { class: 'mg-table' },
            h('thead', h('tr', h('th', 'id'), h('th', '路径'))),
            h('tbody', st.pages.map((p) => h('tr', h('td', esc(p.id)), h('td', h('code', esc(p.path)))))))
          : h('p', { class: 'mg-dim' }, '（暂无页面插件）')),
      h('div', { class: 'mg-card' },
        h('h3', '路由表'),
        h('table', { class: 'mg-table' },
          h('thead', h('tr', h('th', 'id'), h('th', '方法'), h('th', '路径'), h('th', '优先级'))),
          h('tbody', routeList.map((r) => h('tr',
            h('td', esc(r.id)), h('td', esc(r.method)), h('td', h('code', esc(r.path))), h('td', esc(String(r.priority ?? 0)))))))),
    ]
    const body = h('div', { class: 'motex-app mg-app', 'data-theme': esc(st.theme) },
      h('header', { class: 'motex-header' },
        h('div', { class: 'motex-container' },
          h('span', { class: 'motex-brand' }, esc(st.siteName)),
          h('span', { class: 'mg-badge' }, '管理后台'))),
      h('main', { class: 'motex-container' }, cards),
      h('footer', { class: 'motex-footer' },
        h('div', { class: 'motex-container' }, `motex-web-core · manage`)),
    )
    return document({
      lang: ctx.i18n.config.defaultLang,
      title: `管理后台 · ${st.siteName}`,
      head: joinMarkup(styleTag(ctx.asset.url('base.css')), styleTag(ctx.asset.url('manage.css'))),
      body,
    })
  }
}

export default ManageService