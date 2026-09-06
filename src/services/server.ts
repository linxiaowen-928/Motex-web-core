/**
 * 服务器服务：HTTP 服务器（node:http 内置）+ WebSocket（ws）+ 完整请求处理链。
 *
 * 处理链（pipeline 接线之外的核心）：
 *   解析请求 → emit web/request → 静态资源(publicPrefix) → 路由匹配
 *   → [全局中间件 + 路由中间件 链式执行] → 路由 handler → 404 兜底
 *   → emit web/response → 序列化
 *
 * 稳定契约：
 *   - 中间件不调 next() 即短路；handler 返回非 undefined 且未写 body → 自动 JSON
 *   - 任何未捕获异常 → emit web/error → 500（不崩进程）
 *   - WebSocket：ctx.server.ws(path, handler) 注册（路径前缀匹配），同 fiber 生命周期
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { RouterConfig, ServerConfig } from '../config.ts'
import { esc } from '../markup.ts'
import { HttpResponse, type HttpRequest, type Middleware } from '../types.ts'

/** HTTP 错误（中间件/处理器可抛出：throw new HttpError(403, 'no')） */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface WsHandler {
  (socket: WebSocket, req: HttpRequest): void
}

export class ServerService extends Service {
  config: ServerConfig
  routerConfig: RouterConfig
  private server: ReturnType<typeof createServer> | null = null
  private wss: WebSocketServer | null = null
  private wsRoutes = new Map<string, WsHandler>()
  startedAt = 0

  constructor(ctx: Context, config: ServerConfig, routerConfig: RouterConfig) {
    super(ctx, 'server')
    this.config = config
    this.routerConfig = routerConfig
  }

  // ===== WebSocket =====

  /** 注册 WS 端点（path 前缀匹配；fiber 卸载自动撤销） */
  ws(path: string, handler: WsHandler): () => void {
    const self = this
    return this.ctx.effect(() => {
      self.wsRoutes.set(path, handler)
      return () => self.wsRoutes.delete(path)
    })
  }

  private handleUpgrade(rawReq: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = (rawReq.url ?? '/').split('?')[0]
    let handler: WsHandler | null = null
    for (const [path, h] of this.wsRoutes) {
      if (url === path || url.startsWith(path.replace(/\/+$/, '') + '/')) {
        handler = h
        break
      }
    }
    if (!handler) {
      socket.destroy()
      return
    }
    this.wss?.handleUpgrade(rawReq, socket, head, (ws) => {
      this.wss?.emit('connection', ws, rawReq)
      handler(ws, this.parseRequest(rawReq, url))
    })
  }

  // ===== 生命周期 =====

  /** 启动（返回实际监听端口）；重复启动为幂等。
   *  端口避让：首选端口被占用（EADDRINUSE）且配置允许时自动 +1 顺延
   *  （portAutoShift + portShiftLimit）——多项目以本框架为 core 并存互不冲突。 */
  async start(): Promise<number> {
    if (this.server) return this.port()
    const self = this
    const maxShift = this.config.portAutoShift ? this.config.portShiftLimit : 0
    let port = this.config.port
    for (;;) {
      const server = createServer((req, res) => {
        void self.handle(req, res)
      })
      server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head))
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(port, this.config.host, () => resolve())
        })
        this.server = server
        this.wss = new WebSocketServer({ noServer: true })
        this.startedAt = Date.now()
        break
      } catch (e) {
        try { server.close() } catch { /* 未监听，无需关闭 */ }
        const err = e as NodeJS.ErrnoException
        if (err.code === 'EADDRINUSE' && maxShift > 0 && port < this.config.port + maxShift) {
          const next = port + 1
          this.ctx.logger.warn('[server] 端口 %d 被占用，顺延启动 http://%s:%d', port, this.config.host, next)
          port = next
          continue
        }
        throw e
      }
    }
    const actual = this.port()
    this.ctx.emit('web/ready', actual)
    this.ctx.logger.info('[server] 监听 http://%s:%d', this.config.host, actual)
    return actual
  }

  /** 当前监听端口 */
  port(): number {
    if (!this.server) return this.config.port
    const addr = this.server.address() as AddressInfo | null
    return addr?.port ?? this.config.port
  }

  /** 停止（幂等） */
  async stop(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.wss?.close()
    this.wss = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.ctx.logger.info('[server] 已停止')
  }

  // ===== 请求解析 =====

  private parseRequest(rawReq: IncomingMessage, pathOnly?: string): HttpRequest {
    const url = pathOnly ?? rawReq.url ?? '/'
    const queryIdx = url.indexOf('?')
    const path = (queryIdx >= 0 ? url.slice(0, queryIdx) : url) || '/'
    const query: Record<string, string | string[]> = {}
    if (queryIdx >= 0) {
      const sp = new URLSearchParams(url.slice(queryIdx + 1))
      for (const [k, v] of sp) {
        const prev = query[k]
        if (prev === undefined) query[k] = v
        else if (Array.isArray(prev)) prev.push(v)
        else query[k] = [prev, v]
      }
    }
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawReq.headers)) {
      if (typeof v === 'string') headers[k] = v
      else if (Array.isArray(v)) headers[k] = v.join(', ')
    }
    const ip = rawReq.socket.remoteAddress ?? ''
    return {
      method: rawReq.method ?? 'GET',
      url,
      path,
      query,
      params: {},
      headers,
      body: null,
      ip,
    }
  }

  private async readBody(rawReq: IncomingMessage): Promise<string | Uint8Array | null> {
    const declared = Number(rawReq.headers['content-length'] ?? '0') || 0
    if (declared > this.config.maxBodyBytes) throw new HttpError(413, 'payload too large')
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of rawReq) {
      total += (chunk as Buffer).length
      if (total > this.config.maxBodyBytes) throw new HttpError(413, 'payload too large')
      chunks.push(chunk as Buffer)
    }
    if (!chunks.length) return null
    const buf = Buffer.concat(chunks)
    const ct = rawReq.headers['content-type'] ?? ''
    return /text|json|form|xml/i.test(ct) ? buf.toString('utf-8') : new Uint8Array(buf)
  }

  /** 请求体 → JSON 对象（非法 JSON 抛 400） */
  parseJson(req: HttpRequest): unknown {
    if (!req.body) return undefined
    try {
      return JSON.parse(String(req.body))
    } catch {
      throw new HttpError(400, 'invalid json body')
    }
  }

  /** 请求体 → 表单对象 */
  parseForm(req: HttpRequest): Record<string, string> {
    const out: Record<string, string> = {}
    if (!req.body) return out
    for (const [k, v] of new URLSearchParams(String(req.body))) {
      out[k] = v
    }
    return out
  }

  // ===== 请求处理链 =====

  /**
   * 请求处理统一使用 root ctx（全局服务视图）：
   * 插件在任意 fiber 提供的服务（如导航站的 nav）都能属性访问——
   * 若用本服务的 ctx（web 插件 fiber，严格模式），兄弟 fiber 提供的服务会
   * "cannot get property without inject"。事件总线本就全局，emit 不受影响。
   */
  private reqCtx(): Context {
    return this.ctx.root
  }

  async handle(rawReq: IncomingMessage, nodeRes: ServerResponse): Promise<void> {
    const req = this.parseRequest(rawReq)
    const res = new HttpResponse()
    const ctx = this.reqCtx()
    try {
      req.body = await this.readBody(rawReq)
      ctx.emit('web/request', req)
      await this.dispatch(req, res, ctx)
    } catch (e) {
      if (e instanceof HttpError) {
        res.status = e.status
        res.text(e.message)
      } else {
        ctx.emit('web/error', e, req)
        ctx.logger.error('[server] 处理 %s %s 失败: %s', req.method, req.url, String(e).slice(0, 200))
        if (!res.isHandled()) {
          res.status = 500
          res.text('Internal Server Error')
        }
      }
    }
    ctx.emit('web/response', req, res)
    this.write(nodeRes, res)
  }

  /** 路由/静态/中间件分发（供 manage 或调试复用；ctx 为运行期上下文，默认 root） */
  async dispatch(req: HttpRequest, res: HttpResponse, ctx?: Context): Promise<void> {
    const run = ctx ?? this.reqCtx()
    // 1. 静态资源（前缀命中即服务，路由不参与）
    const prefix = this.config.publicPrefix
    if (prefix && (req.path === prefix || req.path.startsWith(prefix + '/'))) {
      const rel = req.path.slice(prefix.length).replace(/^\/+/, '')
      if (run.asset.serve(rel, res, this.config.staticMaxAgeSec)) return
      // 静态资源缺失 → 404（不进路由）
      res.notFound('asset not found')
      return
    }

    // 2. 路由匹配
    const match = run.router.match(req.method, req.path)
    const chain: Middleware[] = [...run.router.globals(), ...(match?.middleware ?? [])]

    // 3. 中间件链（不调 next 即短路）
    let idx = 0
    const next = async (): Promise<void> => {
      if (idx < chain.length) {
        const mw = chain[idx++]
        await mw(run, req, res, next)
      }
    }
    let mwErr: unknown = null
    try {
      await next()
    } catch (e) {
      mwErr = e
    }

    // 4. 路由 handler（中间件未短路、未抛错、响应未处理时执行）
    if (mwErr === null && !res.isHandled() && match) {
      const result = await match.entry.handler(run, req, res, match.params)
      if (!res.isHandled()) {
        if (result !== undefined) {
          this.maybeJson(res, result)
        } else {
          res.notFound('no content')
        }
      }
    }

    // 5. 404 兜底
    if (mwErr === null && !res.isHandled()) {
      if (this.routerConfig.pretty404 && !req.path.startsWith(this.routerConfig.apiPrefix)) {
        res.status = 404
        res.html(this.render404(req, run))
      } else {
        res.notFound('not found')
      }
    }
    // 中间件抛错 → 交给上层统一 500 处理
    if (mwErr !== null) throw mwErr
  }

  /** API 处理器返回值序列化（对象/数组 → JSON；字符串 → text） */
  private maybeJson(res: HttpResponse, result: unknown): void {
    if (typeof result === 'string') {
      res.text(result)
    } else if (result !== null && result !== undefined) {
      res.json(result)
    } else {
      res.status = 204
      res.body = null
    }
  }

  /** 内置 404 页面（纯 SSR 风格，与主题一致） */
  private render404(req: HttpRequest, run: Context): string {
    const site = run.theme.siteName()
    const body = `<div class="motex-app" data-theme="${esc(run.theme.themeId())}">
<div class="motex-container motex-404">
  <h1>404</h1>
  <p>页面不存在：${esc(req.path)}</p>
  <p><a href="/">← 返回首页</a></p>
</div>
</div>`
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 · ${esc(site)}</title>
<link rel="stylesheet" href="${run.asset.url('base.css')}">
</head>
<body>
${body}
</body>
</html>`
  }

  private write(nodeRes: ServerResponse, res: HttpResponse): void {
    nodeRes.statusCode = res.status
    for (const [k, v] of res.headers) {
      if (Array.isArray(v)) nodeRes.setHeader(k, v)
      else nodeRes.setHeader(k, v)
    }
    if (!res.headers.has('content-type') && res.body && typeof res.body === 'string') {
      nodeRes.setHeader('content-type', 'text/plain; charset=utf-8')
    }
    if (res.body === null) nodeRes.end()
    else if (typeof res.body === 'string') nodeRes.end(res.body)
    else nodeRes.end(Buffer.from(res.body))
  }
}

export default ServerService