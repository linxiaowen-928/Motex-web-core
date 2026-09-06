/**
 * 会话服务：cookie 会话（HMAC 签名防伪造）+ 可替换存储（memory / file）。
 *
 * 用法（页面/API 处理器内）：
 *   const session = await ctx.session.ensure(req, res)   // 恢复或新建
 *   session.data.visited = (session.data.visited ?? 0) + 1
 *   // memory 模式直接生效；file 模式请求结束时 pipeline 调 flush()
 *
 * cookie 值 = `<sid>.<sig>`；sig = HMAC-SHA256(secret, sid) 前 16 hex。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionConfig } from '../config.ts'
import type { HttpRequest, HttpResponse, Session } from '../types.ts'

export class SessionService extends Service {
  config: SessionConfig
  /** memory 存储：sid → 会话 */
  private store = new Map<string, Session>()
  private memGc: ReturnType<typeof setInterval> | null = null

  /** 请求 → 会话 的活跃追踪（请求结束时 pipeline 调 flushFor 落盘 file 存储） */
  private active = new WeakMap<HttpRequest, Session>()

  constructor(ctx: Context, config: SessionConfig) {
    super(ctx, 'session')
    this.config = config
    // 过期会话定期清理（memory 模式；10 分钟一轮）
    if (config.storage === 'memory') {
      this.memGc = setInterval(() => {
        const now = Date.now()
        for (const [sid, s] of this.store) {
          if (now - s.lastSeenAt > config.maxAgeSec * 1000) this.store.delete(sid)
        }
      }, 600_000).unref()
    } else {
      try { mkdirSync(join(process.cwd(), config.fileDir), { recursive: true }) } catch { /* 忽略 */ }
    }
  }

  // ===== cookie 编解码 =====

  /** 生成签名 cookie 值 */
  sign(sid: string): string {
    const sig = createHmac('sha256', this.config.secret).update(sid).digest('hex').slice(0, 16)
    return `${sid}.${sig}`
  }

  /** 校验 cookie 值 → sid（非法返回 null） */
  parseCookie(value: string | undefined): string | null {
    if (!value) return null
    const dot = value.lastIndexOf('.')
    if (dot <= 0) return null
    const sid = value.slice(0, dot)
    const sig = value.slice(dot + 1)
    const expect = createHmac('sha256', this.config.secret).update(sid).digest('hex').slice(0, 16)
    // 恒定时间比较
    const a = Buffer.from(sig)
    const b = Buffer.from(expect)
    if (a.length !== b.length) return null
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    return diff === 0 ? sid : null
  }

  private attachCookie(res: HttpResponse, sid: string) {
    const c = this.config
    // add（不是 set）：同一响应里可与其他 cookie（如语言）共存
    res.add('set-cookie',
      `${c.cookieName}=${this.sign(sid)}; Path=/; Max-Age=${c.maxAgeSec}; HttpOnly; SameSite=${c.sameSite}${c.secure ? '; Secure' : ''}`)
  }

  private clearCookie(res: HttpResponse) {
    const c = this.config
    res.add('set-cookie', `${c.cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=${c.sameSite}`)
  }

  // ===== 存储 =====

  private async load(sid: string): Promise<Session | null> {
    if (this.config.storage === 'memory') {
      return this.store.get(sid) ?? null
    }
    const file = join(process.cwd(), this.config.fileDir, `${sid}.json`)
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as Session
    } catch {
      return null
    }
  }

  private async persist(session: Session): Promise<void> {
    if (this.config.storage === 'memory') {
      this.store.set(session.id, session)
      return
    }
    try {
      writeFileSync(join(process.cwd(), this.config.fileDir, `${session.id}.json`), JSON.stringify(session), 'utf-8')
    } catch (e) {
      this.ctx.logger.warn('[session] 落盘失败 %s: %s', session.id, String(e).slice(0, 120))
    }
  }

  private async remove(sid: string): Promise<void> {
    this.store.delete(sid)
    if (this.config.storage === 'file') {
      try {
        const { rmSync } = await import('node:fs')
        rmSync(join(process.cwd(), this.config.fileDir, `${sid}.json`), { force: true })
      } catch { /* 忽略 */ }
    }
  }

  // ===== 对外 API =====

  /** 是否已过有效期 */
  private expired(s: Session): boolean {
    return Date.now() - s.lastSeenAt > this.config.maxAgeSec * 1000
  }

  /** 从请求恢复会话；无有效 cookie 返回 null（不自动创建）。
   *  先查本请求的活跃会话（同请求内 ensure/restore 结果一致），再走 cookie。 */
  async restore(req: HttpRequest, res?: HttpResponse): Promise<Session | null> {
    const active = this.active.get(req)
    if (active) {
      active.lastSeenAt = Date.now()
      if (res) this.attachCookie(res, active.id) // 续期
      return active
    }
    const sid = this.parseCookie(req.headers['cookie']?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(this.config.cookieName + '='))?.slice(this.config.cookieName.length + 1))
    if (!sid) return null
    const s = await this.load(sid)
    if (!s || this.expired(s)) return null
    s.lastSeenAt = Date.now()
    this.active.set(req, s)
    this.ctx.emit('session/restored', s)
    if (res) {
      // 续期 cookie
      this.attachCookie(res, sid)
    }
    return s
  }

  /** 确保有会话：恢复成功用之，否则创建新会话（写 cookie） */
  async ensure(req: HttpRequest, res: HttpResponse): Promise<Session> {
    const existing = await this.restore(req, res)
    if (existing) return existing
    return this.create(res, req)
  }

  /** 创建新会话（写 cookie；不读请求） */
  async create(res: HttpResponse, req?: HttpRequest): Promise<Session> {
    const s: Session = {
      id: randomBytes(16).toString('hex'),
      data: {},
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    }
    this.attachCookie(res, s.id)
    if (req) this.active.set(req, s)
    await this.persist(s)
    this.ctx.emit('session/created', s)
    return s
  }

  /** 销毁会话（删存储 + 清 cookie） */
  async destroy(req: HttpRequest, res: HttpResponse): Promise<void> {
    const sid = this.parseCookie(req.headers['cookie']?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(this.config.cookieName + '='))?.slice(this.config.cookieName.length + 1))
    if (sid) {
      await this.remove(sid)
      this.ctx.emit('session/destroyed', sid)
    }
    this.clearCookie(res)
  }

  /** 请求结束时闪存（file 模式落盘；memory 模式对象即引用，无需） */
  async flush(session: Session | null): Promise<void> {
    if (!session || this.config.storage !== 'file') return
    await this.persist(session)
  }

  /** 请求级闪存（pipeline 在 web/response 时调用：改过的会话自动落盘） */
  async flushFor(req: HttpRequest): Promise<void> {
    const s = this.active.get(req)
    if (s) await this.flush(s)
  }

  /** 当前会话数（manage 页用） */
  count(): number {
    return this.config.storage === 'memory' ? this.store.size : 0
  }

  /** 清空全部会话（manage API 用；file 模式仅清内存视图） */
  clearAll(): number {
    const n = this.store.size
    this.store.clear()
    return n
  }
}

export default SessionService