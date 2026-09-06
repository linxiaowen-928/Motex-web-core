/**
 * 渲染服务：整页渲染流水线（数据 → 区块 → 标题 → 布局 → 完整 HTML）。
 *
 * 与 PageService 的分工：PageService 负责注册与编排（renderBody），
 * RenderService 负责把编排结果变成完整页面输出（布局/标题/文档骨架）。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { joinMarkup } from '../markup.ts'
import type { HttpRequest, HttpResponse, Page } from '../types.ts'

export class RenderService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'render')
  }

  /** 整页渲染入口（页面路由 handler 调用） */
  async renderPage(page: Page, req: HttpRequest, res: HttpResponse): Promise<void> {
    // 自定义整页渲染（不走 layout+blocks 流水线；res 传入可写 cookie）
    if (page.html) {
      try {
        res.html(await page.html(this.ctx, req, res))
      } catch (e) {
        this.ctx.emit('web/error', e, req)
        this.ctx.logger.error('[render] 页面 %s 自定义渲染失败: %s', page.id, String(e).slice(0, 160))
        this.fail(res, 500, `页面渲染失败: ${String(e).slice(0, 120)}`)
      }
      return
    }

    const { html, data, lang, head } = await this.ctx.page.renderBody(page, req, res)
    const titleRaw = typeof page.title === 'function'
      ? await page.title(this.ctx, req)
      : (page.title ?? this.ctx.theme.siteName())
    const title = this.ctx.theme.resolveTitle(titleRaw)

    try {
      const full = await this.ctx.theme.renderLayout({
        ctx: this.ctx,
        req,
        page,
        bodyHtml: html,
        data,
        head,
        lang,
        themeId: this.ctx.theme.themeId(),
        siteName: this.ctx.theme.siteName(),
        title,
        m: this.ctx.m,
        esc: this.ctx.esc,
      })
      this.ctx.emit('page/rendered', page.id, req, full)
      res.html(joinMarkup(full))
    } catch (e) {
      this.ctx.emit('web/error', e, req)
      this.ctx.logger.error('[render] 页面 %s 布局渲染失败: %s', page.id, String(e).slice(0, 160))
      this.fail(res, 500, `布局渲染失败: ${String(e).slice(0, 120)}`)
    }
  }

  private fail(res: HttpResponse, status: number, message: string): void {
    res.status = status
    res.text(message)
  }
}

export default RenderService