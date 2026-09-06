/**
 * 路由服务：路径模板注册 + 匹配（:param / * 通配）+ 中间件链组装。
 *
 * - 注册经 ctx.effect 托管：插件 fiber 卸载（热更新替换页面）时路由自动撤销
 * - 匹配顺序：priority 降序 → 注册顺序（先注册先匹配）
 * - 页面路由由 PageService 登记（handler = 页面渲染）；API 路由经 ctx.router.api()
 *
 * 事件契约（与 fetcher-core 同样式）：
 *   api handler 结果 → ctx.emit('api/done', routeId, req, result)
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { joinMarkup } from '../markup.ts'
import type {
  HandlerRoute, HttpRequest, HttpResponse, Middleware, RouteEntry, RouteHandler, RouteMatch,
} from '../types.ts'

/** 路由匹配结果（含本条路由中间件） */
export interface RouterMatch extends RouteMatch {
  middleware: Middleware[]
}

export class RouterService extends Service {
  /** 全局中间件（顺序执行；不调 next 即短路） */
  private globalMws: Middleware[] = []
  /** 已注册路由（匹配顺序 = 数组顺序；插入时按 priority 降序） */
  private routes: HandlerRoute[] = []

  constructor(ctx: Context) {
    super(ctx, 'router')
  }

  /** 注册全局中间件（fiber 卸载自动撤销） */
  use(mw: Middleware): () => void {
    const self = this
    // ctx.effect：回调执行注册，返回清理函数；插件 fiber dispose 时自动撤销
    return this.ctx.effect(() => {
      self.globalMws.push(mw)
      return () => {
        const i = self.globalMws.indexOf(mw)
        if (i >= 0) self.globalMws.splice(i, 1)
      }
    })
  }

  /** 注册任意路由（页面/API/自定义都用它） */
  route(entry: HandlerRoute): () => void {
    const self = this
    return this.ctx.effect(() => {
      // priority 降序插入；同 priority 追加在尾（先注册先匹配）
      const prio = entry.priority ?? 0
      let i = self.routes.length
      while (i > 0 && (self.routes[i - 1].priority ?? 0) >= prio) i--
      self.routes.splice(i, 0, entry)
      self.ctx.logger.debug('[router] 注册 %s %s → %s', entry.method, entry.path, entry.id)
      return () => {
        const idx = self.routes.indexOf(entry)
        if (idx >= 0) self.routes.splice(idx, 1)
      }
    })
  }

  /** API 路由快捷注册（method 缺省 GET；'ALL' = 任意方法） */
  api(
    id: string,
    path: string,
    handler: RouteHandler,
    opts: { method?: string; priority?: number; middleware?: Middleware[] } = {},
  ): () => void {
    const method = (opts.method ?? 'GET').toUpperCase()
    return this.route({
      id,
      path,
      method,
      handler,
      priority: opts.priority,
      middleware: opts.middleware,
    })
  }

  /** 全局中间件快照（server 组装请求链用） */
  globals(): Middleware[] {
    return [...this.globalMws]
  }

  /** 当前全部已注册路由（manage 页/调试用） */
  all(): HandlerRoute[] {
    return [...this.routes]
  }

  /** 匹配路由：method + path → { entry, params, middleware（全局 + 路由级） } */
  match(method: string, path: string): RouterMatch | null {
    const m = method.toUpperCase()
    for (const entry of this.routes) {
      if (entry.method !== 'ALL' && entry.method !== m) continue
      const params = matchPath(entry.path, path)
      if (!params) continue
      return {
        entry,
        params,
        middleware: entry.middleware ?? [],
      }
    }
    return null
  }
}

/** 路径模板匹配：'/posts/:id' → '/posts/42' => { id: '42' }；':id?' 可选段；'*' 匹配剩余全部 */
export function matchPath(template: string, path: string): Record<string, string> | null {
  const tParts = template.split('/').filter((s) => s !== '')
  const pParts = path.split('/').filter((s) => s !== '')
  const params: Record<string, string> = {}
  let ti = 0
  let pi = 0
  for (; ti < tParts.length; ti++) {
    const t = tParts[ti]
    if (t === '*') {
      // 通配剩余全部
      params['*'] = pParts.slice(pi).join('/')
      return params
    }
    if (pi >= pParts.length) return null
    if (t.startsWith(':')) {
      const optional = t.endsWith('?')
      const name = optional ? t.slice(1, -1) : t.slice(1)
      params[name] = pParts[pi]
      pi++
      continue
    }
    if (t !== pParts[pi]) return null
    pi++
  }
  return pi === pParts.length ? params : null
}

/** 拼接渲染输出（路由处理器返回 HTML 数组/字符串的统一收口） */
export function renderOutput(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return joinMarkup(v as never[])
  return String(v)
}

export default RouterService