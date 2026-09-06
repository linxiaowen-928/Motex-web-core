/**
 * 页面服务：页面注册（页面 = cordis 服务 page.<id>）+ 路由登记 + 数据加载编排。
 *
 * cordis 哲学落地（对齐 fetcher-core 的 site.<id>）：
 * - 页面 = ctx.provide('page.<id>', page)——插件可替换实现、realm 隔离互不可见
 * - 区块 = ctx.provide('page-block.<id>', block)——公共区块跨页面复用
 * - 注册生命周期全部托管：fiber 卸载（热更新）自动撤销 provide 与路由
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { joinMarkup } from '../markup.ts'
import type { HttpRequest, HttpResponse, Page, PageBlock } from '../types.ts'

export class PageService extends Service {
  /** 已注册页面（id → page；生命周期托管，manage 页/调试用） */
  private pageMap = new Map<string, Page>()

  constructor(ctx: Context) {
    super(ctx, 'page')
  }

  /** 注册一个页面（页面插件唯一的入口；返回注销函数）。
   *  注意命名：不能叫 page()——ctx.page 已被 PageService 服务本身占用（cordis 服务属性） */
  register(page: Page): () => void {
    const self = this
    // 1. 页面本体注册为服务（可替换/隔离）
    this.ctx.provide(`page.${page.id}`, page)
    // 2. 路由登记（与页面同生命周期，热更新卸载时一并撤销）
    const dispose = this.ctx.router.route({
      id: page.id,
      path: page.path ?? `/${page.id}`,
      method: 'GET',
      priority: 0,
      middleware: page.middleware,
      handler: (ctx, req, res) => self.renderPage(page, req, res),
    })
    this.ctx.effect(() => {
      self.pageMap.set(page.id, page)
      return () => self.pageMap.delete(page.id)
    })
    this.ctx.logger.info('[page] 注册页面 %s → %s', page.id, page.path ?? `/${page.id}`)
    return dispose
  }

  /** 注册一个区块（带类型，免 provide 的 any 退化；生命周期托管）。
   *  快捷等价 ctx.provide('page-block.<id>', block) */
  block(block: PageBlock): () => void {
    const self = this
    return this.ctx.effect(() => {
      self.ctx.provide(`page-block.${block.id}`, block)
      return () => { /* provide 随 fiber 卸载自动撤销 */ }
    })
  }

  /** 已注册页面清单 */
  list(): Page[] {
    return [...this.pageMap.values()]
  }

  /** 取页面服务（经 DI；未注册返回 undefined） */
  get(id: string): Page | undefined {
    return this.ctx.get(`page.${id}`, false) as Page | undefined
  }

  /** 页面完整流水线：数据 → 区块 → 布局 → HTML（详情见 render.ts） */
  async renderPage(page: Page, req: HttpRequest, res: HttpResponse): Promise<void> {
    await this.ctx.render.renderPage(page, req, res)
  }

  /** 页面主体渲染（布局之外的部分）：数据 + 区块拼接（错误隔离——单个区块失败不拖垮整页） */
  async renderBody(page: Page, req: HttpRequest, res?: HttpResponse): Promise<{
    html: string
    data: unknown
    lang: string
    head: string
    errors: string[]
  }> {
    const lang = this.ctx.i18n.resolveLang(req)
    let data: unknown = null
    if (page.data) {
      try {
        data = await page.data(this.ctx, req, res)
      } catch (e) {
        this.ctx.emit('web/error', e, req)
        this.ctx.logger.warn('[page] %s 数据加载失败: %s', page.id, String(e).slice(0, 160))
      }
    }
    this.ctx.emit('page/data', page.id, req, data)

    const parts: string[] = []
    const requires = new Set<string>()
    const errors: string[] = []
    for (const ref of page.blocks ?? []) {
      const spec = typeof ref === 'string' ? { id: ref } : ref
      const block = this.ctx.get(`page-block.${spec.id}`, false) as import('../types.ts').PageBlock | undefined
      try {
        if (!block) {
          const msg = `页面 ${page.id} 引用的区块 ${spec.id} 未注册（页面区块缺省应经 ctx.provide('page-block.<id>')）`
          errors.push(msg)
          this.ctx.logger.warn('[render] %s', msg)
          continue
        }
        const html = await block.render({
          ctx: this.ctx,
          req,
          res,
          page,
          config: spec.config,
          data,
          m: this.ctx.m,
          esc: this.ctx.esc,
        })
        parts.push(html)
        for (const r of block.requires ?? []) requires.add(r)
      } catch (e) {
        const msg = `区块 ${spec.id} 渲染失败: ${String(e).slice(0, 120)}`
        errors.push(msg)
        this.ctx.emit('web/error', e, req)
        this.ctx.logger.error('[render] %s', msg)
        parts.push(`<div class="motex-block-error" data-block="${spec.id}">区块渲染失败（详见日志）</div>`)
      }
    }
    return { html: joinMarkup(parts), data, lang, head: this.headResources(requires), errors }
  }

  /** 区块声明的资源 → head 标签串（.css → link，其余 → script） */
  private headResources(requires: Set<string>): string {
    return joinMarkup([...requires].map((r) => {
      const url = this.ctx.asset.url(r)
      return r.endsWith('.css')
        ? `<link rel="stylesheet" href="${url}">`
        : `<script src="${url}" defer></script>`
    }))
  }
}

export default PageService