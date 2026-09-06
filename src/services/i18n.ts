/**
 * i18n 服务：语言包注册（插件调用 ctx.i18n.register）+ 请求语言解析 + 取词。
 *
 * 语言包插件形态（语言学放在项目插件侧，核心零个性化）：
 *   ctx.i18n.register('en-US', { common: { save: 'Save' }, home: { title: 'Home' } })
 *
 * 语言解析优先级：URL ?lang= > 语言 cookie > Accept-Language > 默认语言。
 * 取词：ctx.i18n.t(lang, 'common.save', { name: 'x' }) → 嵌套 key + {param} 替换；
 * 缺词回退默认语言包，再缺返回 key 原文。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { I18nConfig } from '../config.ts'
import type { HttpRequest, HttpResponse } from '../types.ts'

export type LanguagePack = Record<string, unknown>

export class I18nService extends Service {
  config: I18nConfig
  /** lang → 语言包（嵌套对象） */
  private packs = new Map<string, LanguagePack>()

  constructor(ctx: Context, config: I18nConfig) {
    super(ctx, 'i18n')
    this.config = config
  }

  /** 注册/合并一个语言包（项目插件 apply 时调用） */
  register(lang: string, pack: LanguagePack): void {
    const prev = this.packs.get(lang) ?? {}
    this.packs.set(lang, deepMerge(prev, pack))
    this.ctx.logger.debug('[i18n] 注册语言包 %s（%d 顶层键）', lang, Object.keys(pack).length)
  }

  /** 支持的语言列表（配置 + 已注册包） */
  languages(): string[] {
    const set = new Set<string>([this.config.defaultLang, ...(this.config.supportedLangs ?? [])])
    for (const l of this.packs.keys()) set.add(l)
    return [...set]
  }

  has(lang: string): boolean {
    return this.packs.has(lang)
  }

  /** 从请求解析语言（query > cookie > Accept-Language > default） */
  resolveLang(req: HttpRequest): string {
    const cfg = this.config
    if (cfg.allowQuerySwitch) {
      const q = req.query[cfg.queryParam]
      if (typeof q === 'string' && this.languages().includes(q)) return q
    }
    const cookie = parseCookie(req, cfg.cookieName)
    if (cookie && this.languages().includes(cookie)) return cookie
    const accept = req.headers['accept-language']
    if (accept) {
      const first = accept.split(',')[0]?.trim().split(';')[0]
      if (first && this.languages().some((l) => l.toLowerCase() === first.toLowerCase())) {
        const hit = this.languages().find((l) => l.toLowerCase() === first.toLowerCase())
        if (hit) return hit
      }
    }
    return cfg.defaultLang
  }

  /** 记录语言选择（写 cookie；页面处理器配合 res 调用） */
  setLangCookie(res: HttpResponse, lang: string): void {
    const cfg = this.config
    res.add('set-cookie', `${cfg.cookieName}=${encodeURIComponent(lang)}; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`)
  }

  /** 取词：嵌套 key + {param} 替换；本语言缺词回退默认语言包，再缺返回 key 原文 */
  t(lang: string, key: string, params?: Record<string, unknown>): string {
    const pack = this.packs.get(lang) ?? {}
    let value: unknown = lookup(pack, key)
    if (value === undefined && lang !== this.config.defaultLang) {
      value = lookup(this.packs.get(this.config.defaultLang) ?? {}, key)
    }
    if (value === undefined) return key
    let out = String(value)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        out = out.replaceAll(`{${k}}`, String(v))
      }
    }
    return out
  }
}

/** 嵌套对象路径查找：lookup({ a: { b: 1 } }, 'a.b') → 1 */
function lookup(obj: LanguagePack, key: string): unknown {
  let cur: unknown = obj
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** 从 cookie 头解析指定 cookie 值 */
export function parseCookie(req: HttpRequest, name: string): string | undefined {
  const raw = req.headers['cookie']
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const s = part.trim()
    if (s.startsWith(name + '=')) return decodeURIComponent(s.slice(name.length + 1))
  }
  return undefined
}

/** 深合并（对象递归；标量覆盖） */
function deepMerge(base: LanguagePack, over: LanguagePack): LanguagePack {
  const out: LanguagePack = { ...base }
  for (const [k, v] of Object.entries(over)) {
    const bv = out[k]
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(bv as LanguagePack, v as LanguagePack)
    } else {
      out[k] = v
    }
  }
  return out
}

export default I18nService