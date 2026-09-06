# Motex-web-core

通用 **Web 前台框架核心**（纯服务端渲染）：基于 cordis 声明式装配，各项目通过 **cordis 插件**扩展页面/区块/语言包/API/会话，核心保持零项目个性化——与 Motex-fetcher-core 完全同构的哲学：

```
fetcher-core:  cordis.yml + 站点插件(provide site.<id>) + fetcher 插件 → 抓取
web-core:      cordis.yml + 页面插件(provide page.<id>) + web 插件     → 渲染网站
```

## 能力（全家桶）

- **页面 = cordis 服务**：`ctx.page.register({...})` 注册页面（路径/标题/布局），经 DI 分派，可替换/隔离
- **区块 = cordis 服务**：`ctx.page.block({...})`——页面 = 布局 + 区块列表，公共区块跨页复用、可换实现
- **纯服务端渲染**：服务端直出完整 HTML（`ctx.m()`/`ctx.esc()` 自动转义防 XSS）；浏览器端仅原生 base.js 控件（`data-motex-*` 注册表，可扩展），零前端框架
- **服务器**：HTTP + WebSocket + 中间件链（短路语义）+ 静态资源（项目目录覆盖内置）
- **API**：`ctx.router.api(id, path, handler)`——返回值自动 JSON；POST body 解析；路由模板 `:param`/`*`
- **会话**：cookie 会话（HMAC 签名 + memory/file 存储可换）、`ctx.session.ensure/restore/destroy`
- **i18n**：语言包插件注册（`ctx.i18n.register('en-US', {...})`）、URL/cookie/Accept-Language 三级解析、`ctx.i18n.t(lang, key, {param})`
- **主题/布局**：布局 = 服务（`ctx.provide('layout.<id>', renderer)`），内置默认 main 布局 + CSS 变量主题
- **管理后台**（可选）：`/manage` 页面 + API（状态/路由表/页面清单/清会话）
- **共享核多站点（host 模式）**：`mountSite()` 在唯一 cordis 进程挂载多站点（业务作用域隔离 + 独立端口，插件零改动）；`process` 独立进程模式并存
- **cordis 原生装配**：DSH 同款 `*.cordis.yml` 声明式启动；`cordis:include` 多文件组合；`--watch` 热更新——改页面插件/配置即生效，不重启
- **自检**：main 路径 + cordis 装配链路双重自检

## 快速开始

```bash
npm install
npm run self-test           # 框架自检（main 路径）
npm run self-test-cordis    # cordis 装配链路自检（loader → 页面插件 → web 插件）
npm run serve               # 跑示例站 http://127.0.0.1:18080
npm run dev                 # 示例站 + 热更新
```

## 各项目使用方式（推荐：cordis.yml 声明式装配）

> ### ⚠️ 接入规范：只许可「引用」，禁止「拷贝/另写」
>
> 所有基于本框架的项目**必须以下面两种方式之一接入**，以保证全体系共享同一份 core（单一事实来源，
> 修复与能力即时同步、不产生版本分叉）：
>
> **方式 A（本机开发，推荐）——引用本地路径**：`package.json` 里用 `file:` 指向本机 core 目录
> （npm 会建立目录链接，core 改动即时生效，无需重复安装）：
> ```json
> { "dependencies": { "motex-web-core": "file:../../Motex-web-core" } }
> ```
>
> **方式 B（远端/交付）——从 GitHub 引用**：以 git 依赖锁定版本/tag，或 `git clone` 后按方式 A 引用
> 克隆出来的目录：
> ```json
> { "dependencies": { "motex-web-core": "github:linxiaowen-928/Motex-web-core" } }
> ```
>
> **❌ 禁止**：
> - 不得把 `node_modules/motex-web-core` 或 `src/` 源码复制进自己的项目（拷贝即分叉，
>   之后 core 的任何修复/新能力都到不了你，还会造成多份“相似但不兼容”的框架）
> - 不得基于本框架的形态从头另写一套“自己的 webcore”（同样造成分叉）
>
> 一句话：**你写的是“站点/页面插件”，core 永远是同一份引用**。

```yaml
# app.web.cordis.yml（DSH 同款格式）
- id: pages
  name: './pages/pages.ts'      # 项目页面插件（相对本文件，.ts 直接加载）
- id: web
  name: 'cordis:web'            # 核心 web 插件（或 'motex-web-core/web'）
  config:
    config: './web.config.json' # server/session/i18n/theme/manage 配置
```

```bash
node --experimental-strip-types node_modules/motex-web-core/src/cli.ts --cordis app.web.cordis.yml
# 常驻 + 热更新：运行中改页面/配置即生效
node --experimental-strip-types node_modules/motex-web-core/src/cli.ts --cordis app.web.cordis.yml --watch
```

### 自动接入导航站（可选，一行配置）

配了 `registry.url` 的应用**启动即自动上架**到导航站/注册中心（心跳续命，90s 无心跳自动下架）：

```jsonc
// web.config.json
{ "registry": { "url": "http://127.0.0.1:19090", "name": "我的站点", "group": "我的项目" } }
```

- 缺省不启用；不配置 = 行为完全不变
- 已注册站点的展示字段：name/desc/tags/group/icon（都可省略）
- 需要**托管启停**（导航站拉起/杀进程）的站点，仍用导航站 `sites.cordis.yml` 注册表条目

### 写一个页面插件（一个插件 = 一个项目/站点）

```ts
// pages/pages.ts
import { Context } from '@deepseek-ai/cordis'

export default Object.assign(function mySitePages(ctx: Context) {
  // 语言包（语言学在项目侧）
  ctx.i18n.register('zh-CN', { home: { title: '首页' }, common: { hello: '你好，{name}' } })

  // 公共区块（跨页面复用）
  ctx.page.block({
    id: 'nav',
    render: ({ ctx: c, req, m: h, esc: e }) =>
      h('nav',
        h('a', { href: '/' }, e(c.i18n.t(c.i18n.resolveLang(req), 'home.title')))),
  })

  // 页面 = 布局 + 区块组成
  ctx.page.register({
    id: 'home', path: '/',
    title: (c, req) => c.i18n.t(c.i18n.resolveLang(req), 'home.title'),
    blocks: ['nav'],
    data: async () => ({ anything: 1 }),
  })

  // API（返回值自动 JSON）
  ctx.router.api('greet', '/api/greet', (_c, req) => ({
    hello: `你好，${req.query.name ?? 'world'}`,
  }))
}, {
  // ⚠️ cordis v4：apply 内访问 ctx.<服务> 必须声明依赖
  inject: ['i18n', 'router', 'page'],
})
```

## 目录

```
src/
├── index.ts              # 核心：createWebApp/runWeb/main（CLI）+ 全部导出
├── web.ts                # web 插件（cordis 插件形式：装配全部服务 + 启动）
├── loader.ts             # cordis.yml 装载器（DSH 同款：include 组合 + --watch 热更新）
├── cli.ts                # CLI 入口（--cordis / --self-test / --config）
├── selftest.ts           # 双重自检（main 路径 + cordis 装配链路，公共断言集）
├── config.ts / types.ts / markup.ts
├── services/             # server / router / page / render / asset / session / i18n / theme / manage
├── plugins/pipeline.ts   # 事件接线（会话闪存/访问日志）
└── assets/               # base.css 主题变量 + base.js 浏览器控件库 + manage.css
```

## 文档

- [UPGRADING.md](UPGRADING.md)——**升级必读**：各版本升级文档索引（改动清单/破坏性改动/手动操作项）
- [docs/architecture.md](docs/architecture.md)——架构说明（模块地图/装配模型/数据流/扩展机制/设计原则）
- [docs/guide-页面开发.md](docs/guide-页面开发.md)——页面/区块/API/会话/i18n 开发指南
- [docs/guide-扩展.md](docs/guide-扩展.md)——服务替换/中间件/事件/布局/主题扩展指南
- [CHANGELOG.md](CHANGELOG.md)——版本变更索引（每版本链接对应升级文档）
- [examples/](examples/)——可直接运行的示例站（页面/区块/i18n/会话/API/管理后台全演示）

## 许可

MIT