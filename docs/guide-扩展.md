# 扩展指南

> 面向"需要动框架行为"的开发者：换服务、加中间件、监听事件、换布局、热更新。

## 1. 全局中间件

```ts
// 页面插件 apply 里（inject 需含 'router'）
ctx.router.use(async (ctx, req, res, next) => {
  const t0 = Date.now()
  await next()                       // 不调 next 即短路（拦截）
  ctx.logger.info('%s %s → %d (%dms)', req.method, req.url, res.status, Date.now() - t0)
})

// 作用于所有请求（静态资源前）；路由级中间件在页面/API 的 middleware 字段
```

典型用途：访问日志、鉴权（短路 403）、请求改写、响应头注入。

## 2. 服务替换（createWebApp 程序化路径）

```ts
import { createWebApp, ServerService } from 'motex-web-core'

class MyServer extends ServerService {
  // 继承默认类魔改：换默认客户端/加钩子
}

const app = createWebApp(cfg, {
  services: { server: MyServer },
  plugins: [myPages],
  beforeServices: (ctx, cfg) => { /* 装配前钩子 */ },
  afterServices: (ctx, cfg) => { /* 装配后钩子 */ },
})
await app.server.start()
```

- 可替换：`server / router / page / render / asset / session / i18n / theme`（构造参数与默认类相同）。
- 用户插件照常 `app.plugin(...)`——和服务同树共享 DI。

## 3. 事件监听（不侵入核心）

```ts
// 任意插件 apply 内（ctx.on 生命周期托管，卸载自动清理）
ctx.on('page/rendered', (pageId, req, html) => {
  // 旁路：统计 / 缓存 / 落盘
})
ctx.on('web/error', (e, req) => {
  // 统一告警（钉钉/日志系统）
})
ctx.on('web/ready', (port) => {
  // 注册到服务发现
})
```

完整契约见 docs/architecture.md 事件表。

## 4. 换布局 / 换主题

```ts
// 布局 = 服务：provide('layout.<id>') 即替换
ctx.provide('layout.main', (lctx) => {
  // lctx: { ctx, req, page, bodyHtml, data, head, lang, themeId, siteName, title, m, esc }
  return ctx.m('html', {},
    ctx.m('head', {},
      ctx.m('meta', { charset: 'utf-8' }),
      ctx.m('title', ctx.esc(lctx.title)),
      lctx.head),
    ctx.m('body', { 'data-theme': lctx.themeId },
      ctx.m('div', { class: 'shell' }, lctx.bodyHtml)))
})
```

- 主题：`base.css` 的 `[data-theme='dark']` 变量块即暗色主题；`theme.theme` 配置切换。
- 页面可单独指定 `layout: 'custom'`——每页不同布局。

## 5. 热更新（--watch）

```bash
node --experimental-strip-types node_modules/motex-web-core/src/cli.ts --cordis app.web.cordis.yml --watch
```

| 改动 | 行为 |
|---|---|
| 页面插件 .ts 文件保存 | 该条目 force 重启（重新 import + apply），旧路由/提供自动撤销 |
| cordis.yml 增删条目 | include.refresh() 事务性刷新整棵子树 |
| 新增页面插件文件 + yml 条目 | 热应用——新页面立即生效 |
| web.config.json | 该配置重启（服务状态重置；会话按存储方式保留） |

## 6. 组合多文件（cordis:include）

```yaml
# app.web.cordis.yml
- id: pages
  name: 'cordis:include'
  config:
    path: './pages.cordis.yml'   # 子清单可再嵌套

- id: web
  name: 'cordis:web'
  config: { config: './web.config.json' }
```

```yaml
# pages.cordis.yml（多个项目/模块各自的页面插件）
- id: blog-pages
  name: './blog/blog-pages.ts'
- id: shop-pages
  name: './shop/shop-pages.ts'
```

## 7. WebSocket

```ts
// 服务器服务（inject 含 'server'）
ctx.server.ws('/ws/feed', (socket, req) => {
  socket.send(JSON.stringify({ hello: req.query.room ?? 'all' }))
  socket.on('message', (d) => socket.send(`echo:${d}`))
})
```

## 8. 浏览器控件扩展（base.js 注册表）

```js
// 你的区块/页面资源里（区块 requires: ['my-controls.js'] 挂到 <head>）
MOTEX.register('toast', (el, motex) => {
  el.addEventListener('click', () => {
    const msg = motex.data?.toast ?? 'ok'   // 读服务端页面数据
    el.insertAdjacentHTML('afterend', `<div class="toast">${msg}</div>`)
  })
})
```

```html
<!-- 页面区块输出 -->
<button data-motex-toast>弹提示</button>
```

## 9. 边界与注意

- **生产密钥**：`session.secret` 必须显式配置持久密钥（缺省随机 → 重启全部会话失效）。
- **对外发布**：`server.host` 缺省 127.0.0.1（仅本机）；发布改 0.0.0.0/公网地址。
- **请求体**：`server.maxBodyBytes` 默认 1MB，超出返回 413。
- **静态缓存**：`server.staticMaxAgeSec` 默认 3600（可关 0 调试）。
- **注入检查**：忘了 `inject` 声明就访问 ctx.<服务> 会报 `cannot get property without inject`——
  把用到的服务名全列进 `inject` 数组即可。