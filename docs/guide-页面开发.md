# 页面开发指南

> 面向"用 motex-web-core 搭自己站点"的项目开发者。
> 最小心智模型：**一个项目 = 一个 cordis 插件文件 + 一个 cordis.yml**。

## 1. 起步骨架

```bash
mkdir my-site && cd my-site
npm install motex-web-core
```

```yaml
# app.web.cordis.yml
- id: pages
  name: './pages.ts'
- id: web
  name: 'cordis:web'
```

```bash
node --experimental-strip-types node_modules/motex-web-core/src/cli.ts --cordis app.web.cordis.yml --watch
```

## 2. 页面插件模板（pages.ts）

```ts
// ⚠️ inject 必填：apply 内访问的每个 ctx.<服务> 都要声明
import { Context } from '@deepseek-ai/cordis'

export default Object.assign(function pages(ctx: Context) {
  // ...你的注册代码
}, {
  inject: ['i18n', 'router', 'page', 'session', 'server'],
})
```

## 3. 页面（ctx.page.register）

```ts
ctx.page.register({
  id: 'home',                    // 唯一 id；路由 id 同用
  path: '/',                     // 缺省 '/' + id
  title: '首页',                  // 字符串或 (ctx, req) => string
  layout: 'main',                // 布局 id（缺省取 theme 配置；内置 main）
  blocks: ['nav', { id: 'hero', config: { tag: 'x' } }],  // 区块组合
  data: async (ctx, req, res) => ({ now: Date.now() }),   // 页面数据 → 区块共享
  middleware: [...],             // 页面级中间件（可选）
  html: async (ctx, req, res) => '...',  // 指定后跳过 blocks 流水线，整页自定义
})
```

- **路径模板**：`/post/:id`（路由参数进 `req.params.id`）、`/files/*`（通配剩余）。
- **标题后缀**：`theme.titleSuffix` 模板默认 ` · {siteName}`，`resolveTitle` 自动套用。
- **数据闭包**：`data` 返回的内容就是所有区块的 `data`——页面数据一次加载，区块只渲染。

## 4. 区块（ctx.page.block）

```ts
ctx.page.block({
  id: 'hero',
  requires: [],                  // 可选：本区块依赖的 /assets/ 资源（自动进 <head>）
  render: ({ ctx, req, res, page, config, data, m, esc }) => {
    // m = 元素构造（自动转义）；esc = 转义
    // 一切用户数据必须 esc！否则 XSS
    return m('section', { class: 'hero' },
      m('h1', esc(data.title)),
      m('p', esc(String(config ?? ''))))
  },
})
```

- 区块 = 服务（`ctx.page.block` 内部即 `ctx.provide('page-block.<id>', block)`）：
  跨页面复用（`blocks: ['nav']` 处处可引）、可被项目插件替换（同名重新注册即覆盖)。
- **错误隔离**：某区块抛错只渲染占位，不拖垮整页（日志有 `[render]` 记录）。

## 5. API（ctx.router.api）

```ts
ctx.router.api('hello', '/api/hello', (ctx, req, res, params) => {
  return { hello: req.query.name ?? 'world' }   // 自动 JSON
})
ctx.router.api('echo', '/api/echo', (ctx, req) => ctx.server.parseJson(req), { method: 'POST' })
```

- 返回值 `undefined` 且未写 res → 404「no content」。想要空 200 用 `res.status = 204`。
- 中间件短路：`middleware` 里不调 `next()` 即终止（可用作鉴权）。
- 抛 `HttpError(403, 'no')` → 该状态码。

## 6. 会话（ctx.session）

```ts
// 页面 middlewaare / data loader / html / API 中：
const session = await ctx.session.ensure(req, res)   // 恢复或新建（写 cookie）
session.data.visits = (session.data.visits ?? 0) + 1  // 直接改对象
// 请求结束自动闪存（memory 模式对象即引用；file 模式 pipeline 自动落盘）

await ctx.session.restore(req)      // 只读恢复（无 cookie 返回 null）
await ctx.session.destroy(req, res) // 销毁 + 清 cookie
```

- 会话签名：cookie 值 `sid.sig`（HMAC-SHA256），防伪造。
- 配置：`session.secret`（生产必配持久密钥）/ `storage: 'file'` / `maxAgeSec`。

## 7. i18n（ctx.i18n）

```ts
ctx.i18n.register('zh-CN', { common: { save: '保存' }, home: { title: '首页' } })
ctx.i18n.register('en-US', { common: { save: 'Save' }, home: { title: 'Home' } })
ctx.i18n.register('ja-JP', { ... })

// 页面/区块里：
const lang = ctx.i18n.resolveLang(req)      // ?lang= > cookie > Accept-Language > 默认
ctx.i18n.t(lang, 'common.save')             // → '保存'；缺词回退默认包 → key 原文
ctx.i18n.t(lang, 'home.greet', { name: '张三' })  // 模板 {name} 替换
```

- 语言切换按钮：`<button data-motex-lang="en-US">`（base.js 控件写 cookie + 刷新）。

## 8. 浏览器交互（零框架，data-motex-*）

基架 base.js 是**控件注册表**：

```html
<button data-motex-count="#target">+1</button>   <!-- 内置计数控件 -->
<span data-motex-clock></span>                   <!-- 时钟 -->
<form data-motex-form action="/api/x" method="POST">…</form>
```

扩展新控件（页面任意 JS 文件，经区块 `requires` 挂载）：

```js
MOTEX.register('hello', (el, motex) => {
  el.addEventListener('click', () => alert(motex.data?.message ?? 'hi'))
})
// 页面里 <button data-motex-hello> 即点亮
```

页面数据：布局把 `page.data` 序列化进 `#motex-page-data`，控件经 `MOTEX.data` 读取（服务端状态 → 客户端初始化）。

## 9. 静态资源

- 项目目录：`server.publicDir`（相对运行目录），URL `server.publicPrefix + '/' + 文件名`（默认 `/assets/...`）。
- 同名覆盖内置（base.css/base.js 可整体换肤扩展）。
- 资源 URL 永远走 `ctx.asset.url('base.css')`（尊重前缀配置）。

## 10. 管理后台

```jsonc
// web.config.json
{ "manage": { "enabled": true, "path": "/manage", "api": true, "web": true } }
```

`/manage` 页面：状态/页面清单/路由表；`/manage/api/status`、`/manage/api/routes`、`/manage/api/clear-sessions`。

## 11. 配置一览（web.config.json，全部有默认值）

```jsonc
{
  "server": { "host": "127.0.0.1", "port": 18080, "publicDir": "./public", "maxBodyBytes": 1048576 },
  "router": { "apiPrefix": "/api", "pretty404": true },
  "session": { "cookieName": "motex_sid", "secret": "改我", "maxAgeSec": 604800, "storage": "memory", "fileDir": "state/sessions" },
  "i18n": { "defaultLang": "zh-CN", "supportedLangs": ["zh-CN", "en-US"], "cookieName": "motex_lang" },
  "theme": { "layout": "main", "theme": "light", "siteName": "Motex", "titleSuffix": " · {siteName}" },
  "manage": { "enabled": false, "path": "/manage", "api": true, "web": true }
}
```

> **端口避让 + 端口记忆**：缺省首选端口 18080；**被占用时自动 +1 顺延**（18080 → 18081 → …，
> 最多顺延 `server.portShiftLimit` 个，默认 100），多个以本框架为 core 的项目同时启动互不冲突。
> **端口记忆（默认开）**：实际用到的端口记录在 `state/port.memory.json`——**下次启动优先使用
> 上次实际端口**（而非重新探测），每个 web 尽量钉在固定端口，重启不漂移不换号；
> 记忆端口被占则顺延并更新记忆；想换端口改配置文件即自动生效，或删记忆文件重置。
> 随机端口写 `"port": 0`（不记忆）。