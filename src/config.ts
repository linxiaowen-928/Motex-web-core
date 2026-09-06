/**
 * motex-web-core 配置契约 + 默认值。
 *
 * 结构与 fetcher-core 的 config.ts 对齐：无配置也能跑（全部默认值），
 * 项目经 web.config.json（或 cordis.yml 里 web 条目的 config 字段）覆盖。
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** ===== server ===== */

export interface ServerConfig {
  /** 监听地址（缺省 127.0.0.1，仅本机；对外发布显式配置） */
  host: string
  /** 首选监听端口（缺省 18080） */
  port: number
  /** 端口被占用时自动 +1 避让（缺省 true：多项目以本框架为 core 并存互不冲突） */
  portAutoShift: boolean
  /** 避让最大尝试次数（缺省 100：从首选端口起最多顺延 100 个端口；0 = 不避让） */
  portShiftLimit: number
  /** 端口记忆（缺省 true）：把实际用到的端口记到 state/port.memory.json，
   *  下次启动优先使用记忆端口（不再从首选端口重新探测漂移）——每个 web 尽量钉在固定端口 */
  portMemory: boolean
  /** 项目静态资源根目录（缺省 = 内置 assets/；相对运行目录） */
  publicDir?: string
  /** 项目静态 URL 前缀（缺省 '/assets'） */
  publicPrefix: string
  /** 请求体大小上限（字节，缺省 1MB） */
  maxBodyBytes: number
  /** 静态资源浏览器缓存秒数（缺省 3600） */
  staticMaxAgeSec: number
}

/** ===== router ===== */

export interface RouterConfig {
  /** API 路由前缀（缺省 '/api'；页面路由不受影响） */
  apiPrefix: string
  /** 404 时是否渲染框架内置 404 页（缺省 true；false = 纯文本） */
  pretty404: boolean
}

/** ===== session ===== */

export interface SessionConfig {
  /** cookie 名（缺省 'motex_sid'） */
  cookieName: string
  /** 签名密钥（缺省随机生成——重启后旧会话失效；生产显式配置持久密钥） */
  secret: string
  /** 会话有效期秒（缺省 7 天） */
  maxAgeSec: number
  /** 存储：'memory' | 'file'（缺省 memory） */
  storage: 'memory' | 'file'
  /** file 存储目录（相对运行目录；缺省 state/sessions） */
  fileDir: string
  /** cookie 属性 */
  httpOnly: boolean
  sameSite: 'lax' | 'strict' | 'none'
  secure: boolean
}

/** ===== i18n ===== */

export interface I18nConfig {
  /** 缺省语言（缺省 'zh-CN'） */
  defaultLang: string
  /** 支持的语言列表（缺省仅 defaultLang）；语言包插件可扩展 */
  supportedLangs?: string[]
  /** 记录语言选择的 cookie 名（缺省 'motex_lang'） */
  cookieName: string
  /** 语言切换的查询参数名（缺省 'lang'） */
  queryParam: string
  /** 是否允许经 URL 查询参数临时切语言（缺省 true） */
  allowQuerySwitch: boolean
}

/** ===== theme ===== */

export interface ThemeConfig {
  /** 默认布局 id（缺省 'main'；布局由布局插件 ctx.provide('layout.<id>', ...) 提供） */
  layout: string
  /** 主题 id（缺省 'light'；CSS 变量由 assets/base.css 定义，可复写） */
  theme: string
  /** 站点名（缺省 'Motex'；显示在标题/页脚） */
  siteName: string
  /** 页面标题后缀（缺省 ' · {siteName}'；空 = 不加） */
  titleSuffix: string
}

/** ===== manage（后台管理，可选） ===== */

export interface ManageConfig {
  /** 是否启用（缺省 false，与 fetcher-core 的 manage 语义一致） */
  enabled: boolean
  /** 管理页路径（缺省 '/manage'） */
  path: string
  /** 是否开放管理 API（/manage/api/...） */
  api: boolean
  /** 是否提供管理页面（纯 SSR 渲染） */
  web: boolean
}

/** ===== 总配置 ===== */

export interface WebConfig {
  server: ServerConfig
  router: RouterConfig
  session: SessionConfig
  i18n: I18nConfig
  theme: ThemeConfig
  manage: ManageConfig
}

/** 默认全套配置（无 config 文件也能起服务） */
export function defaultConfig(): WebConfig {
  return {
    server: {
      host: '127.0.0.1',
      port: 18080,
      portAutoShift: true,
      portShiftLimit: 100,
      portMemory: true,
      publicPrefix: '/assets',
      maxBodyBytes: 1024 * 1024,
      staticMaxAgeSec: 3600,
    },
    router: {
      apiPrefix: '/api',
      pretty404: true,
    },
    session: {
      cookieName: 'motex_sid',
      secret: randomSecret(),
      maxAgeSec: 7 * 24 * 3600,
      storage: 'memory',
      fileDir: 'state/sessions',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    },
    i18n: {
      defaultLang: 'zh-CN',
      cookieName: 'motex_lang',
      queryParam: 'lang',
      allowQuerySwitch: true,
    },
    theme: {
      layout: 'main',
      theme: 'light',
      siteName: 'Motex',
      titleSuffix: ' · {siteName}',
    },
    manage: {
      enabled: false,
      path: '/manage',
      api: true,
      web: true,
    },
  }
}

function randomSecret(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

/** 深合并（对象递归；数组/标量直接覆盖） */
export function deepMerge<T>(base: T, over?: unknown): T {
  if (over === undefined || over === null) return base
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return (over as T)
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v)
  }
  return out as T
}

/** 读取配置文件（JSON；相对运行目录）并与默认值深合并 */
export function loadConfig(path?: string): WebConfig {
  const cfg = defaultConfig()
  if (!path) return cfg
  const abs = resolve(process.cwd(), path)
  let data: unknown
  try {
    data = JSON.parse(readFileSync(abs, 'utf-8'))
  } catch (e) {
    throw new Error(`[motex-web-core] 无法读取配置 ${abs}: ${String(e)}`)
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error(`[motex-web-core] 配置 ${abs} 顶层必须是对象`)
  }
  return deepMerge(cfg, data)
}

/** 会话存储文件路径（file 模式） */
export function sessionFilePath(cfg: SessionConfig, sid: string): string {
  return join(process.cwd(), cfg.fileDir, `${sid}.json`)
}