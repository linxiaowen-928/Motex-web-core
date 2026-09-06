/**
 * 主题服务：布局分派 + 站点信息 + 主题 id。
 *
 * 布局 = cordis 服务：ctx.provide('layout.<id>', renderer)（可被项目替换/新增）；
 * 未注册时用内置默认布局（main）：HTML5 骨架 + 品牌头 + 主体 + 版权脚。
 *
 * LayoutContext 直接给出 m/esc 工具（免 import），区块/布局作者签名即所见。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { ThemeConfig } from '../config.ts'
import { document, esc, joinMarkup, m, scriptJson, scriptTag, styleTag, type Markup } from '../markup.ts'
import type { HttpRequest, Page } from '../types.ts'

/** 布局渲染上下文 */
export interface LayoutContext {
  ctx: Context
  req: HttpRequest
  page: Page
  /** 页面主体的最终 HTML（布局 -> layout -> main(bodyHtml)） */
  bodyHtml: string
  /** 页面数据（布局可读取展示） */
  data: unknown
  /** 页面/区块声明的 <head> 资源（css/js 标签串） */
  head: string
  /** 解析后的语言 */
  lang: string
  /** 主题 id（body[data-theme]） */
  themeId: string
  /** 站点名 */
  siteName: string
  /** 布局所属页面标题（页面处理后） */
  title: string
  /** markup 工具（免 import） */
  m: typeof m
  esc: typeof esc
}

/** 布局渲染器签名 */
export type LayoutRenderer = (lctx: LayoutContext) => Markup | Promise<Markup>

export class ThemeService extends Service {
  config: ThemeConfig

  constructor(ctx: Context, config: ThemeConfig) {
    super(ctx, 'theme')
    this.config = config
  }

  /** 站点名 */
  siteName(): string {
    return this.config.siteName
  }

  /** 当前主题 id */
  themeId(): string {
    return this.config.theme
  }

  /** 页面应使用的布局 id（页面覆盖 >> 全局默认） */
  resolveLayout(page: Page): string {
    return page.layout ?? this.config.layout
  }

  /** 组装页面标题：页面标题 + 后缀模板（{siteName} 替换） */
  resolveTitle(pageTitle: string): string {
    const suffix = this.config.titleSuffix.replace('{siteName}', this.config.siteName)
    return pageTitle + suffix
  }

  /** 渲染布局：注册的 layout.<id> 优先，缺省内置 main 布局 */
  async renderLayout(lctx: LayoutContext): Promise<string> {
    const layout = lctx.page.layout ?? this.config.layout
    const renderer = this.ctx.get(`layout.${layout}`, false) as LayoutRenderer | undefined
    if (!renderer) {
      // 未注册 → 回退默认布局（同时注册到 DI，后续项目插件可整体替换）
      if (!this.ctx.get('layout.main', false)) {
        this.ctx.provide('layout.main', (c: LayoutContext) => this.defaultMainLayout(c))
      }
    }
    const fn = renderer ?? (this.ctx.get('layout.main', false) as LayoutRenderer | undefined)
    if (!fn) {
      // 双保险：没有任何布局时直接输出页面主体
      return document({ lang: lctx.lang, title: lctx.title, head: lctx.head, body: lctx.bodyHtml })
    }
    return joinMarkup(await fn(lctx))
  }

  /** 内置默认布局：品牌头 + 主体 + 版权脚（内容全部来自页面区块）；
   *  body 末尾下发页面数据（#motex-page-data JSON）。
   *  ⚠️ base.js（控件运行时）必须在 <head> 且【先于】所有区块 requires 脚本执行——
   *  defer 按文档顺序执行，若区块脚本（如 nav.js）先跑会因 window.MOTEX 未定义而整体失效。 */
  private defaultMainLayout(lctx: LayoutContext): string {
    const { m: h, esc: e } = lctx
    // 资源 URL 经运行上下文（单站点 = root；共享核 = 站点作用域——asset 共享宿主实例）
    const asset = lctx.ctx.asset
    const body = joinMarkup(
      h('div', { class: 'motex-app', 'data-theme': e(lctx.themeId) },
        h('header', { class: 'motex-header' },
          h('div', { class: 'motex-container' },
            h('a', { class: 'motex-brand', href: '/' }, e(lctx.siteName)))),
        h('main', { class: 'motex-main motex-container' }, lctx.bodyHtml),
        h('footer', { class: 'motex-footer' },
          h('div', { class: 'motex-container' },
            `© ${new Date().getFullYear()} ${e(lctx.siteName)}`)),
      ),
      scriptJson('motex-page-data', lctx.data),
    )
    // head：base.css → base.js（控件运行时，必须先于区块脚本）→ 区块声明的资源
    const head = joinMarkup(
      styleTag(asset.url('base.css')),
      scriptTag(asset.url('base.js')),
      lctx.head,
    )
    return document({ lang: lctx.lang, title: lctx.title, head, body })
  }
}

export default ThemeService