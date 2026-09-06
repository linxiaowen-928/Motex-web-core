/**
 * motex-web-core 核心类型与事件契约。
 *
 * 设计（对齐 motex-fetcher-core）：
 * - 页面 = cordis 服务（ctx.provide('page.<id>', page)），router 经 ctx.get('page.<id>') 分派
 * - 区块 = cordis 服务（ctx.provide('page-block.<id>', block)），页面 = 布局 + 区块列表
 * - 一切渲染走 markup.ts（自动转义，防 XSS）
 * - 服务间只经事件总线协作（pipeline.ts 接线）
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ServerService } from './services/server.ts'
import type { RouterService } from './services/router.ts'
import type { PageService } from './services/page.ts'
import type { RenderService } from './services/render.ts'
import type { AssetService } from './services/asset.ts'
import type { SessionService } from './services/session.ts'
import type { I18nService } from './services/i18n.ts'
import type { ThemeService } from './services/theme.ts'

/** ===== 请求 / 响应 ===== */

export interface HttpRequest {
  /** 请求方法（大写） */
  method: string
  /** 完整路径（含 query，如 /post/1?page=2） */
  url: string
  /** 路径（不含 query） */
  path: string
  /** 解析后的 query 参数 */
  query: Record<string, string | string[]>
  /** 路由参数（/post/:id → { id: '1' }） */
  params: Record<string, string>
  /** 请求头（小写 key） */
  headers: Record<string, string>
  /** 已读入的请求体（文本或原始字节；JSON/表单解析由上层服务按 Content-Type 处理） */
  body: string | Uint8Array | null
  /** 客户端地址 */
  ip: string
}

/** 响应主体类型 */
export type ResponseBody = string | Uint8Array

/** 可变响应对象：中间件 / 页面处理器可改写；pipeline 最终序列化 */
export class HttpResponse {
  status = 200
  headers = new Map<string, string | string[]>()
  body: ResponseBody | null = null

  set(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value)
    return this
  }

  /** 追加同名头（如多条 Set-Cookie）；已有值则转数组追加 */
  add(name: string, value: string): this {
    const key = name.toLowerCase()
    const prev = this.headers.get(key)
    if (prev === undefined) this.headers.set(key, value)
    else if (Array.isArray(prev)) prev.push(value)
    else this.headers.set(key, [prev, value])
    return this
  }

  get(name: string): string | string[] | undefined {
    return this.headers.get(name.toLowerCase())
  }

  json(obj: unknown): this {
    this.set('content-type', 'application/json; charset=utf-8')
    this.body = JSON.stringify(obj)
    return this
  }

  html(s: string): this {
    this.set('content-type', 'text/html; charset=utf-8')
    this.body = s
    return this
  }

  text(s: string): this {
    this.set('content-type', 'text/plain; charset=utf-8')
    this.body = s
    return this
  }

  raw(bytes: Uint8Array, contentType?: string): this {
    if (contentType) this.set('content-type', contentType)
    this.body = bytes
    return this
  }

  redirect(location: string, status = 302): this {
    this.status = status
    this.set('location', location)
    this.body = null
    return this
  }

  notFound(message = 'Not Found'): this {
    this.status = 404
    this.text(message)
    return this
  }

  /** 是否为"已处理"状态（设置了 body、跳转或明确状态码） */
  isHandled(): boolean {
    return this.body !== null || this.headers.has('location') || this.status !== 200
  }
}

/** 中间件：(req, res, next) 链式；不调 next() 即短路（终止后续中间件与路由） */
export type Middleware = (
  ctx: Context,
  req: HttpRequest,
  res: HttpResponse,
  next: () => Promise<void>,
) => Promise<void> | void

/** ===== 路由 ===== */

export interface RouteEntry {
  /** 路由 id（页面路由 = 页面 id；API 路由 = 调用方自定义） */
  id: string
  /** 路径模板：'/posts/:id'；支持 :param 与 * 通配（* 只匹配末尾一段） */
  path: string
  /** HTTP 方法（页面路由为 GET；API 路由可任意；ALL = 全部） */
  method: string
  /** 中间件（仅本路由生效，在页面/处理器之前执行） */
  middleware?: Middleware[]
  /** 排序权重（大者优先匹配；缺省 0） */
  priority?: number
}

/** 路由匹配结果 */
export interface RouteMatch {
  entry: HandlerRoute
  params: Record<string, string>
}

/** 路由处理器：返回 unknown（API → JSON；页面 → HTML 字符串，内部经 res 输出） */
export type RouteHandler = (
  ctx: Context,
  req: HttpRequest,
  res: HttpResponse,
  params: Record<string, string>,
) => unknown | Promise<unknown>

/** 带处理器的路由条目（页面路由与 API 路由共用） */
export interface HandlerRoute extends RouteEntry {
  handler: RouteHandler
}

/** ===== 页面 ===== */

/** 页面数据加载器：返回的数据经 ctx.emit('page/data', ...) 广播后交给区块。
 *  第三参 res 可写 cookie（如会话）；data loader 内可经 ctx.session 读写会话 */
export type PageDataLoader = (ctx: Context, req: HttpRequest, res?: HttpResponse) => unknown | Promise<unknown>

/** 页面标题（静态字符串或动态函数） */
export type PageTitle = string | ((ctx: Context, req: HttpRequest) => string | Promise<string>)

/** 页面 = cordis 服务（页面插件的注册单元） */
export interface Page {
  /** 页面 id（必须全局唯一；路由 id 同用） */
  id: string
  /** 路径模板（缺省 '/' + id） */
  path?: string
  /** 页面标题（缺省取配置/页面 id） */
  title?: PageTitle
  /** 布局 id（缺省 = theme 默认布局 'main'） */
  layout?: string
  /** 页面区块列表：区块 id 或 { id, config }（区块渲染时收到 config 并入 data） */
  blocks?: (string | PageBlockRef)[]
  /** 页面数据（可异步；会先 emit 'page/data' 供插件加工/拦截） */
  data?: PageDataLoader
  /** 自定义整页渲染（指定时跳过 layout+blocks 流水线，直接输出 HTML；res 可写 cookie） */
  html?: (ctx: Context, req: HttpRequest, res?: HttpResponse) => string | Promise<string>
  /** 页面级中间件（在本页路由匹配后、渲染前执行） */
  middleware?: Middleware[]
  /** 此页是否参与 sitemap/导航（预留；缺省 true） */
  listed?: boolean
}

/** 页面中引用区块的写法：字符串 = 区块 id；对象 = 带配置 */
export interface PageBlockRef {
  id: string
  config?: unknown
}

/** 区块渲染上下文（页面数据 + 区块配置 + 请求 + 响应 + markup 工具） */
export interface BlockRenderContext {
  ctx: Context
  req: HttpRequest
  /** 当前响应（可写 cookie；区块一般只读，页面级 cookie 建议在 data loader 里处理） */
  res?: HttpResponse
  page: Page
  config: unknown
  data: unknown
  /** markup 元素构造（自动转义；免 import） */
  m: typeof import('./markup.ts').m
  /** HTML 转义（免 import） */
  esc: typeof import('./markup.ts').esc
}

/** 区块 = cordis 服务（可跨页面复用、可被项目插件替换） */
export interface PageBlock {
  /** 区块 id */
  id: string
  /** 区块渲染：输出 HTML 片段（已转义的责任在区块内——用 ctx.m / esc 工具） */
  render: (bctx: BlockRenderContext) => string | Promise<string>
  /** 区块所需静态资源钩子（可选）：本区块用到的 /assets/... 资源 */
  requires?: string[]
}

/** ===== 会话 ===== */

export interface Session {
  id: string
  /** 任意会话数据（session.set/get 操作同一对象） */
  data: Record<string, unknown>
  createdAt: number
  lastSeenAt: number
  /** 会话语言（i18n 服务读写；可不经 session.data） */
  lang?: string
}

/** ===== 事件契约（与 fetcher-core 相同的“事件即接口”模式） ===== */

declare module '@deepseek-ai/cordis' {
  interface Context {
    server: ServerService
    router: RouterService
    page: PageService
    render: RenderService
    asset: AssetService
    session: SessionService
    i18n: I18nService
    theme: ThemeService
    /** markup 工具（装配时 ctx.provide('m'/'esc') 挂载） */
    m: typeof import('./markup.ts').m
    esc: typeof import('./markup.ts').esc
  }

  interface Events {
    /** 收到完整请求（中间件链之前；可监听做访问统计/日志） */
    'web/request'(req: HttpRequest): void
    /** 页面数据已加载（可监听加工/拦截 data） */
    'page/data'(pageId: string, req: HttpRequest, data: unknown): unknown | void
    /** 页面渲染完成后（html 已生成，可监听改写入站日志/性能） */
    'page/rendered'(pageId: string, req: HttpRequest, html: string): void
    /** 响应已序列化（写日志/统计用） */
    'web/response'(req: HttpRequest, res: HttpResponse): void
    /** HTTP 服务器启动完成 */
    'web/ready'(port: number): void
    /** 处理过程出错（未捕获异常统一走这里；默认 500） */
    'web/error'(error: unknown, req: HttpRequest | null): void
    /** API 路由命中（api 处理器返回结果后广播，供插件加工/旁路落盘） */
    'api/done'(routeId: string, req: HttpRequest, result: unknown): void
    /** 会话创建 */
    'session/created'(session: Session): void
    /** 会话销毁 */
    'session/destroyed'(sid: string): void
    /** 会话经 cookie 恢复（每次请求若命中旧会话） */
    'session/restored'(session: Session): void
  }
}