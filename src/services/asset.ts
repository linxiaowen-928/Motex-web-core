/**
 * 静态资源服务：内置资源（本包 src/assets/）+ 项目资源根（config.server.publicDir，可覆盖同名内置）。
 *
 * 资源 URL 统一经 ctx.asset.url('base.css') 生成（尊重 publicPrefix 配置）。
 * 处理顺序：项目 publicDir 优先 → 内置 assets 兜底；查不到返回 null（由路由层 404）。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerConfig } from '../config.ts'
import type { HttpResponse } from '../types.ts'

/** 内置资源目录（src/assets） */
export const BUILTIN_ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json',
}

export class AssetService extends Service {
  config: ServerConfig
  /** 项目资源根（绝对路径；未配置为 null） */
  private projectRoot: string | null = null
  /** 已解析文件缓存（路径 → 内容，静态资源小文件） */
  private cache = new Map<string, { bytes: Uint8Array; mime: string }>()

  constructor(ctx: Context, config: ServerConfig) {
    super(ctx, 'asset')
    this.config = config
    if (config.publicDir) {
      this.projectRoot = resolve(process.cwd(), config.publicDir)
    }
  }

  /** 资源 URL（尊重 publicPrefix） */
  url(path: string): string {
    const prefix = this.config.publicPrefix.replace(/\/+$/, '')
    return `${prefix}/${path.replace(/^\/+/, '')}`
  }

  /** 解析资源文件（项目优先 → 内置兜底）；不存在返回 null */
  resolveFile(rel: string): { bytes: Uint8Array; mime: string } | null {
    // 路径归一防穿越（../ 一律拒绝）
    const norm = normalize(rel).replace(/\\/g, '/').replace(/^\/+/, '')
    if (norm.startsWith('..') || norm.includes('../')) return null

    const cands: string[] = []
    if (this.projectRoot) cands.push(join(this.projectRoot, norm))
    cands.push(join(BUILTIN_ASSETS_DIR, norm))

    for (const file of cands) {
      if (!existsSync(file)) continue
      try {
        if (!statSync(file).isFile()) continue
      } catch {
        continue
      }
      const cached = this.cache.get(file)
      if (cached) return cached
      const bytes = new Uint8Array(readFileSync(file))
      const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
      const out = { bytes, mime: MIME[ext] ?? 'application/octet-stream' }
      if (bytes.length < 2 * 1024 * 1024) this.cache.set(file, out)
      return out
    }
    return null
  }

  /** 把资源写进响应；found=false 表示不存在（调用方 404） */
  serve(rel: string, res: HttpResponse, maxAgeSec: number): boolean {
    const file = this.resolveFile(rel)
    if (!file) return false
    res.raw(file.bytes, file.mime)
    res.set('cache-control', `public, max-age=${maxAgeSec}`)
    return true
  }
}

export default AssetService