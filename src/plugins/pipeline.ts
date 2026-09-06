/**
 * 管线接线（事件挂接函数）：通过事件把服务串起来，各服务互不认识。
 *
 * 与 fetcher-core 的 pipeline.ts 对称：
 * - 服务器不知道会话存储、不知道日志格式——本挂接只做接线：
 *   web/request    → 访问日志
 *   web/response   → 会话闪存（file 存储自动落盘）
 *   session/*      → 会话日志
 *
 * ⚠️ 用「函数挂接」而非「ctx.plugin 对象插件」：cordis v4 在 active fiber 内
 * ctx.plugin() 会延迟到父 fiber 结束才 apply，而 loader 条目 fiber 常驻——
 * 嵌套插件永不执行。assembleWeb 直接调用本函数（WeakSet 幂等）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HttpRequest } from '../types.ts'

const attached = new WeakSet<Context>()

export function attachPipeline(ctx: Context): void {
  if (attached.has(ctx)) return
  attached.add(ctx)

  // 访问日志（级别可经 logger 配置调节）
  ctx.on('web/request', (req: HttpRequest) => {
    ctx.logger.debug('[web] %s %s（%s）', req.method, req.url, req.ip)
  })

  // 请求结束 → 把本次触碰过的会话落盘（file 存储）
  ctx.on('web/response', async (req, res) => {
    try {
      await ctx.session.flushFor(req)
    } catch (e) {
      ctx.logger.warn('[pipeline] 会话闪存失败: %s', String(e).slice(0, 120))
    }
  })

  ctx.on('session/created', (s) => {
    ctx.logger.info('[session] 创建 %s', s.id.slice(0, 8))
  })

  ctx.on('session/destroyed', (sid) => {
    ctx.logger.info('[session] 销毁 %s', sid.slice(0, 8))
  })

  ctx.on('web/ready', (port) => {
    ctx.logger.info('[pipeline] 站点就绪 http://localhost:%d', port)
  })
}

/** 兼容旧引用（对象插件形式不再使用；保留导出防破坏） */
export const pipelinePlugin = { name: 'web-pipeline', apply: attachPipeline }

export default attachPipeline