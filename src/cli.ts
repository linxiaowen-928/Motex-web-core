/** CLI 入口：
 *   node --experimental-strip-types src/cli.ts --cordis <app.web.cordis.yml> [--watch] [--patch <file>]... [--port N]
 *   node --experimental-strip-types src/cli.ts --self-test
 *   node --experimental-strip-types src/cli.ts --config <web.config.json> [--port N]
 */
import { main } from './index.ts'
import { mountCordis } from './loader.ts'

const args = process.argv.slice(2)
const cordisIdx = args.indexOf('--cordis')
const cordisPath = cordisIdx >= 0 && args[cordisIdx + 1] ? args[cordisIdx + 1] : undefined

;(async () => {
  if (cordisPath) {
    const patches: string[] = []
    for (let i = args.indexOf('--patch'); i >= 0; i = args.indexOf('--patch', i + 1)) {
      if (args[i + 1]) patches.push(args[i + 1])
    }
    const watch = args.includes('--watch')
    const { app, close } = await mountCordis(cordisPath, {
      watch,
      patches: patches.length ? patches : undefined,
    })
    // watch 常驻：进程由文件监听维持（fs.watch persistent）
    if (watch && app) {
      const shutdown = async () => {
        close?.()
        await app.server?.stop().catch(() => {})
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      return
    }
    // 非 watch：服务器维持事件循环；Ctrl+C 即退出
    const shutdown = async () => {
      close?.()
      await app.server?.stop().catch(() => {})
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    return
  }
  await main(args)
})().catch((e) => {
  console.error('[motex-web] 致命错误:', e)
  process.exit(1)
})