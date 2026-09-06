/**
 * 注册代理（registry client）：web 应用启动后自动向导航站/注册中心上报自己。
 *
 * 机制：
 * - server.start() 成功后立即 POST /api/nav/register（id/name/url/port/描述…）
 * - 此后按 heartbeatSec 心跳续命；注册中心 90s 无心跳自动下架（进程崩溃也能清理）
 * - 注册中心不在线 = 静默失败（本机工具场景；不影响站点自身运行）
 * - 随调用方 fiber 生命周期清理（停止心跳；尽力注销）
 *
 * 各项目接入（web.config.json 配一段即可，缺省不自动注册）：
 *   { "registry": { "url": "http://127.0.0.1:19090", "name": "我的站点", "group": "我的项目" } }
 */
import { Context } from '@deepseek-ai/cordis'
import type { RegistryConfig } from '../config.ts'

/** 注册中心心跳过期秒（导航站侧清理阈值） */
export const REGISTRY_TTL_SEC = 90

/** 启动注册代理（在 server.start() 成功后调用；返回注销函数） */
export function attachRegistry(ctx: Context, config: RegistryConfig, port: number): () => void {
  const url = config?.url
  if (!url || !port) return () => {}
  const base = url.replace(/\/+$/, '')
  const id = config.id ?? `auto-${port}`
  const payload = {
    id,
    name: config.name ?? ctx.theme?.siteName?.() ?? `web-${port}`,
    url: `http://127.0.0.1:${port}`,
    port,
    desc: config.desc,
    tags: config.tags,
    group: config.group,
    icon: config.icon,
    mode: 'external',
  }
  let disposed = false

  const send = async (): Promise<void> => {
    if (disposed) return
    try {
      await fetch(`${base}/api/nav/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      /* 注册中心不在线：静默（下个心跳再试） */
    }
  }

  void send()
  const iv = setInterval(() => void send(), (config.heartbeatSec ?? 30) * 1000)
  iv.unref()

  ctx.logger.info('[registry] 自动注册 %s → %s（id=%s，心跳 %ss）', payload.name, base, id, config.heartbeatSec ?? 30)
  return () => {
    disposed = true
    clearInterval(iv)
    // 尽力注销（心跳已能保证清理；注销只是立即可见）
    void fetch(`${base}/api/nav/unregister`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
  }
}

export default attachRegistry