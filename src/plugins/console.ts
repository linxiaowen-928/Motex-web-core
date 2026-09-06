/**
 * 控制台日志输出（挂接函数）：cordis 的 LoggerService 默认 exporter 只缓冲不打印——
 * 本函数把日志打到控制台（WARN 及以上走 stderr）。
 *
 * ⚠️ 用「函数挂接」而非「ctx.plugin 对象插件」：cordis v4 在 active fiber 内 ctx.plugin()
 * 会延迟到父 fiber 结束才 apply（loader 条目 fiber 常驻 → 永不执行）。assembleWeb
 * 直接调用本函数（WeakSet 幂等）。
 */
import { Context, Logger } from '@deepseek-ai/cordis'

const attached = new WeakSet<Context>()

/** cordis 日志级别枚举（0=debug, 1=info, 2=warn, 3=error, 4=fatal） */
const LEVELS = ['DEBG', 'INFO', 'WARN', 'ERRO', 'FATA'] as const

export function attachConsole(ctx: Context): void {
  if (attached.has(ctx)) return
  attached.add(ctx)
  const logger = ctx.logger as unknown as {
    exporter?: (exporter: { colors: number; export: (message: never) => void }) => void
  }
  if (!logger.exporter) return
  logger.exporter({
    colors: 0,
    export: (message: never) => {
      const m = message as {
        level?: number
        name?: string
        timestamp?: number
        args: unknown[]
      }
      const time = new Date(m.timestamp ?? Date.now()).toLocaleTimeString()
      const level = LEVELS[m.level ?? 1] ?? 'INFO'
      let line = `[${time}] [${level}]`
      if (m.name) line += ` [${m.name}]`
      const body = Logger.format({ colors: 0 } as never, m as never)
      if (body) line += ` ${body}`
      // WARN 及以上 → stderr
      const stream = (m.level ?? 1) >= 2 ? console.error : console.log
      stream(line)
    },
  })
  ctx.logger.debug('[console] 日志输出已挂载')
}

/** 兼容旧引用（对象插件形式不再使用；保留导出防破坏） */
export const consolePlugin = { name: 'web-console-output', apply: attachConsole }

export default attachConsole