/**
 * cordis.yml 装载器：与 fetcher-core（及 DSH）同款的声明式装配 + 组合 + 热更新（HMR）。
 *
 * 格式（顶层 YAML 数组，逐项顺序应用）：
 * ```yaml
 * - id: pages                    # 页面插件：相对路径 .ts 直接加载（strip-types）
 *   name: './pages/pages.ts'
 *   config: { ... }
 * - id: web
 *   name: 'cordis:web'           # 内建：装配 Web 核心 + 启动
 *   config:
 *     config: './web.config.json'
 *     port: 18080                 # 覆盖监听端口（缺省 18080；被占用自动 +1 顺延）
 *     watch: true                 # 与 --watch 配合：改页面即热更新
 * ```
 *
 * 组合（多文件编排）：'cordis:include' 条目挂另一个 yml 文件（可嵌套）。
 * HMR（--watch）：include 文件/相对路径插件文件变化 → 防抖 300ms → 事务性刷新/重启条目，
 * 新增页面插件 = 热应用（旧 fiber 卸载自动撤销路由/provide，新 fiber apply 重新注册）。
 *
 * 用法：node --experimental-strip-types src/cli.ts --cordis app.web.cordis.yml [--watch] [--patch <file>]
 */
import { readFileSync, watch, type FSWatcher } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load as yamlLoad } from 'js-yaml'
import { webPlugin } from './web.ts'

/**
 * Include 的相对路径导入保留 .ts（strip-types 直接加载；DSH 原版把 .ts 重写为 .js），
 * 并带缓存击穿（?v=时间戳）——热更新后重新 import 能拿到新代码。
 */
if (!(Include.prototype as unknown as { __tsImportPatched?: boolean }).__tsImportPatched) {
  const orig = (Include.prototype as unknown as { import: (name: string, stack?: () => string[]) => unknown }).import
  ;(Include.prototype as unknown as {
    import: (name: string, stack?: () => string[]) => unknown
    __tsImportPatched: boolean
  }).import = function (this: Include, name: string, stack?: () => string[]) {
    if (name.startsWith('cordis:')) return this.ctx.loader.builtins[name.slice(7)]
    if (name.startsWith('.')) return import(new URL(name + `?v=${Date.now()}`, this.ctx.baseUrl).href)
    return orig.call(this, name, stack)
  }
  ;(Include.prototype as unknown as { __tsImportPatched: boolean }).__tsImportPatched = true
}

export interface CordisEntry {
  id?: string
  /** 插件：相对路径 / 包名 / 'cordis:group' / 'cordis:web' / 'cordis:include' */
  name: string
  /** 插件配置；group/include 条目 = 子条目数组 / 文件配置 */
  config?: unknown
  /** 布尔或 !!js 表达式（禁用条目不加载） */
  disabled?: unknown
  /** 分组标记（配合 name: 'cordis:group'） */
  group?: boolean
  /** 服务隔离（可选；缺省 = root realm，全树共享） */
  isolate?: Record<string, unknown>
}

export interface CordisMountOptions {
  /** 热更新：监听 include 文件变化，事务性刷新条目树 */
  watch?: boolean
  /** 覆盖层文件（DSH --patch 语义）：每个文件是 PatchOptions 数组（按 id 覆盖/insert 条目） */
  patches?: string[]
}

export interface CordisRunResult {
  app: Context
  /** watch 模式的文件监听关闭函数（停止热更新） */
  close?: () => void
}

/** 装载 cordis.yml：挂 Loader 服务 → 注册内建（group/web/include）→ root include 条目装载全部条目。 */
export async function mountCordis(cordisPath: string, opts: CordisMountOptions = {}): Promise<CordisRunResult> {
  const abs = resolve(process.cwd(), cordisPath)
  const app = new Context()
  app.baseUrl = pathToFileURL(dirname(abs)).href + '/'
  await app.plugin(Loader, {})
  app.loader.enableLogs = true
  // 相对路径插件 import 击穿（热更新后重新 import 拿新代码）：
  // loader 的 tree.import 走原生 import()（ESM 缓存，同 URL 永远旧模块）——
  // 实例方法覆盖为带 ?v= 时间戳；.ts 由 strip-types 直接加载（不做 .ts→.js 重写）
  const loaderApi = app.loader as unknown as {
    import: (name: string, stack?: () => string[]) => unknown
    ctx: Context
    __importPatched?: boolean
  }
  if (!loaderApi.__importPatched) {
    const origImport = loaderApi.import
    loaderApi.import = function (this: typeof loaderApi, name: string, stack?: () => string[]) {
      if (name.startsWith('.')) {
        const url = new URL(name, this.ctx.baseUrl)
        url.search = `v=${Date.now()}`
        return import(url.href)
      }
      return origImport.call(this, name, stack)
    }
    loaderApi.__importPatched = true
  }
  // 内建插件：'cordis:group'（分组）/ 'cordis:web'（Web 核心）/ 'cordis:include'（组合+热更新）
  app.loader.builtins.group = Group
  app.loader.builtins.web = webPlugin
  app.loader.builtins.include = Include

  const patches = loadPatches(opts.patches)
  try {
    await app.loader.create({
      name: 'cordis:include',
      config: {
        path: pathToFileURL(abs).href,
        ...(patches.length ? { patches } : {}),
      },
    })
  } catch (e) {
    await app.loader.root.stop().catch(() => {})
    throw e
  }
  await app.loader.await()

  // 自检模式（web 插件 config.selfTest）：全部条目 settle 后执行完整断言
  const selftest = (app.root as unknown as { $$selftest?: { port: number; manage: boolean } }).$$selftest
  if (selftest) {
    const { assertServer, reportChecks } = await import('./selftest.ts')
    const checks = await assertServer(selftest.port, { manage: selftest.manage })
    const ok = reportChecks(checks)
    process.exitCode = ok ? 0 : 1
    await app.server?.stop().catch(() => {})
  }

  const result: CordisRunResult = { app }
  if (opts.watch) result.close = startWatcher(app)
  return result
}

/** 读取 patch 覆盖层文件（DSH PatchOptions 格式：yaml 数组，按 id 覆盖或 insert 条目） */
function loadPatches(files?: string[]): unknown[] {
  const out: unknown[] = []
  for (const f of files ?? []) {
    const p = resolve(process.cwd(), f)
    const data = yamlLoad(readFileSync(p, 'utf-8'), { schema: entryListSchema }) as unknown
    if (!Array.isArray(data)) throw new Error(`[loader] patch 文件 ${f} 顶层必须是数组（DSH PatchOptions 格式）`)
    out.push(...data)
  }
  return out
}

/** 文件监听热更新：
 *  - include 文件（root + 嵌套）变化 → 事务性刷新该子树（新增/删除/修改条目）
 *  - 相对路径插件文件（页面 .ts）变化 → 重启该条目（变 name 触发 loader 的重 import+apply，
 *    配合 import 击穿拿到新代码；旧 fiber 卸载自动撤销路由/provide）
 *  全部防抖 300ms；刷新/重启完成后重新收集（可能引入新 include / 新条目）。 */
function startWatcher(app: Context): () => void {
  const watchers = new Map<string, FSWatcher>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let files = new Map<string, () => Promise<unknown>>()

  const collect = () => {
    const map = new Map<string, () => Promise<unknown>>()
    for (const entry of app.loader.entries()) {
      if (entry.subtree instanceof Include) {
        const inc = entry.subtree
        map.set(inc.filename, () => inc.refresh())
      } else if (typeof entry.options.name === 'string' && entry.options.name.startsWith('.')) {
        let file: string
        try {
          const url = new URL(entry.options.name, entry.ctx.baseUrl)
          url.search = '' // name 可能带 ?hmr= 刷新尾巴——路径 key 必须稳定
          file = fileURLToPath(url)
        } catch {
          continue
        }
        const entryRef = entry as unknown as {
          options: { name: string }
          update: (options: unknown, create?: boolean, force?: boolean) => Promise<unknown>
        }
        map.set(file, () => {
          // loader 的 update({}, false, true) 会被内部 diff 短路（name/inject/group 未变不重启）——
          // 变一下 name（带时间戳）→ 走重 import+apply 分支；import 击穿补丁保证拿到新代码
          return entryRef.update({ name: `${entryRef.options.name}?hmr=${Date.now()}` }, false, true)
        })
      }
    }
    files = map
  }

  const refreshFile = (file: string) => {
    const act = files.get(file)
    if (!act) return
    if (timers.has(file)) clearTimeout(timers.get(file)!)
    timers.set(file, setTimeout(() => {
      timers.delete(file)
      Promise.resolve(act())
        .then(() => collect())
        .catch((e) => app.logger.warn('[loader] 热更新失败（保留旧配置）: %s', String(e).slice(0, 200)))
    }, 300))
  }

  const ensureWatchers = () => {
    collect()
    for (const file of files.keys()) {
      const dir = dirname(file)
      if (!dir || watchers.has(dir)) continue
      try {
        const w = watch(dir, (_ev, fname) => {
          if (typeof fname !== 'string') return
          const full = resolve(dir, fname)
          if (files.has(full)) refreshFile(full)
        })
        w.on('error', (e) => app.logger.warn('[loader] 文件监听错误: %s', String(e).slice(0, 120)))
        watchers.set(dir, w)
      } catch (e) {
        app.logger.warn('[loader] 无法监听 %s: %s', dir, String(e).slice(0, 120))
      }
    }
  }

  ensureWatchers()
  return () => {
    for (const t of timers.values()) clearTimeout(t)
    for (const w of watchers.values()) w.close()
    watchers.clear()
  }
}

export default mountCordis