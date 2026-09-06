# Motex-web-core 架构说明

> 内部怎么组织的：模块职责、装配模型、请求数据流、扩展机制、设计原则。

## 一、模块地图

```
src/
├── index.ts              # 核心：createWebApp（独立 Context 装配）/ runWeb（装配+启动）/ main（CLI）
├── web.ts                # web 插件（'cordis:web'）：loadConfig → assembleWeb → manage → server.start()
│   └── assembleWeb       # 服务装配（幂等：ctx.get(name,false) 判定已存在则跳过）
├── loader.ts             # cordis.yml 装载器（root include 组合 + patches 覆盖层 + --watch 热更新）
├── cli.ts                # CLI 入口（--cordis / --self-test / --config [--port]）
├── selftest.ts           # 双重自检：assertServer 公共断言集 + 两条装配路径
├── config.ts             # 配置契约（server/router/session/i18n/theme/manage）+ 默认值 + 深合并
├── types.ts              # 核心类型（Page/PageBlock/HttpRequest/HttpResponse/Middleware）+ 事件契约
├── markup.ts             # HTML 渲染工具（m/esc/attrs/document——一切输出自动转义）
├── services/
│   ├── server.ts         # ★ HTTP+WS 服务器：请求解析 → 静态资源 → 路由匹配 → 中间件链 → 处理
│   ├── router.ts         # 路由注册/匹配（:param/* 模板、priority 排序、ctx.effect 生命周期托管）
│   ├── page.ts           # 页面服务：页面注册（provide page.<id>）+ 数据加载 + 区块编排（错误隔离）
│   ├── render.ts         # 渲染服务：整页流水线（数据 → 区块 → 标题 → 布局 → document）
│   ├── asset.ts          # 静态资源（项目 publicDir 覆盖内置 assets/；URL 经 ctx.asset.url()）
│   ├── session.ts        # cookie 会话（HMAC 签名 + memory/file 存储 + 请求级活跃追踪）
│   ├── i18n.ts           # 多语言（语言包注册 + 三级解析 + 嵌套 key/参数替换）
│   ├── theme.ts          # 主题/布局（布局 = 服务 layout.<id>；内置默认 main 布局）
│   └── manage.ts         # 管理后台（/manage 页面 + API，可选开启）
├── plugins/pipeline.ts   # 事件接线（会话闪存 / 访问日志 / 会话日志）
└── assets/               # base.css（主题变量+基础样式）/ base.js（浏览器控件）/ manage.css
```

## 二、装配模型（cordis 原生）

```
app.web.cordis.yml（loader.ts 解析，DSH 格式）
 ├─ 页面插件条目（项目）：apply 时
 │    ctx.i18n.register('zh-CN', {...})         语言包（语言学在项目侧）
 │    ctx.provide('page-block.<id>', block)     区块服务
 │    ctx.page.register(page)                   页面服务（内部 provide page.<id> + 路由登记）
 │    ctx.router.api(...) / ctx.router.use(...) API 与全局中间件
 └─ 'cordis:web' 条目（web.ts）：
      loadConfig → assembleWeb(ctx, cfg)
      （asset/router/session/i18n/theme/render/page/server 构造 + 'm'/'esc' 提供
       + pipeline 插件应用 + manage 装配，全部落在当前 ctx）
      → server.start()
```

- **依赖注入协调启动顺序**：loader 并行应用条目；页面插件声明 `inject: ['i18n','router',...]`，
  cordis 等到服务提供（web 条目装配完成）后才 apply 页面插件——这就是"声明式依赖，自动编排"。
- **同一上下文树**：页面插件与核心服务共享作用域 DI 与事件总线（无 isolate = root realm 全局共享）。
- **页面 = 服务**：`ctx.page.register()` 内部 `provide('page.<id>', page)`——替换页面 = 换服务实现（realm 隔离）。
- **区块 = 服务**：`ctx.page.block()` / `provide('page-block.<id>', { render, requires })`——页面 = 布局 + 区块列表。
- **生命周期托管**：路由/区块/页面注册全部包在 `ctx.effect()` 里——插件 fiber 卸载（热更新替换）时自动撤销，
  无需手工清理。
- **热更新（--watch）**：startWatcher 监听 include 文件与相对路径插件文件（防抖 300ms）→ include.refresh()
  事务性刷新子树 / 条目 force 重启（重新 import + apply，旧 fiber 卸载自动撤销其注册）。

### cordis v4 关键规则（血泪教训）

1. **apply 内访问 ctx.<服务> 必须声明 inject**：`Object.assign(fn, { inject: ['i18n', 'router', ...] })`。
   否则报 `cannot get property "x" without inject`。
2. **不能把服务本身当函数调用**：`ctx.<service>` 是代理包装（traceable wrapper）——
   `ctx.router.api(...)`（取方法再调用）可以，`ctx.page({...})`（把服务当函数）不行。
   页面注册方法命名为 `ctx.page.register()`。
3. **核心装配代码用 `ctx.get(name, false)` 访问服务**（免 inject；strict=false 不要求提供者 fiber 正在运行）
   ——装配者是"自产自销"，inject 自己会死锁。
4. **未声明属性不能直接 set**（`cannot set property without provide`）——自检标记挂 `ctx.root`。
5. **插件 fiber 内 `ctx.plugin()` 且带 inject 的插件会延迟到父 fiber 结束才 apply**——
   pipeline 插件因此不声明 inject（服务经 ctx 惰性解析）。

## 三、请求数据流

```
server.handle(req) → HttpRequest 解析 → emit 'web/request'
 ├─ 静态资源：path 命中 publicPrefix → asset.serve（项目目录优先）
 ├─ 路由匹配：router.match(method, path)（priority 降序 → 注册顺序）
 ├─ 中间件链：[全局中间件..., ...路由中间件...] 顺序执行（不调 next() 即短路）
 ├─ 路由 handler：
 │    ├─ 页面（ctx.page.register 登记）：
 │    │    render.renderPage → page.renderBody（数据 → 区块 → head 资源）
 │    │    → 标题组装 → theme.renderLayout（layout.<id> 分派，缺省内置 main）
 │    │    → 文档骨架输出（含 #motex-page-data JSON + base.js）
 │    └─ API（ctx.router.api 登记）：返回值非 undefined → 自动 JSON
 ├─ 404 兜底（pretty404 页面 / 纯文本）
 ├─ emit 'web/response'（pipeline 在此闪存会话）
 └─ 序列化输出（异常 → emit 'web/error' → 500，不崩进程）
```

## 四、页面渲染管线

```
page.html 指定？
  ├─ 是（自定义整页）→ res.html(page.html(ctx, req, res))
  └─ 否（标准流水线）：
       lang = i18n.resolveLang(req)          # ?lang= > cookie > Accept-Language > 默认
       data = page.data(ctx, req, res)       # 可异步；emit 'page/data' 供插件加工
       for block of page.blocks:             # 字符串 = 区块 id；对象 = { id, config }
          block.render({ ctx, req, res, page, config, data, m, esc })
          # 区块未注册 → 警告占位；区块抛错 → 隔离（不拖垮整页）
       requires 收集 → head 标签（.css → link，其余 → script）
       title 解析 → theme.resolveTitle（后缀模板 {siteName}）
       theme.renderLayout(...)               # ctx.get('layout.<id>') 分派
       emit 'page/rendered' → res.html(完整 HTML)
```

## 五、事件契约（事件即接口）

| 事件 | 时机 | 典型用途 |
|---|---|---|
| `web/request` | 请求解析完成 | 访问统计/日志 |
| `page/data` | 页面数据加载后 | 加工/旁路数据 |
| `page/rendered` | 页面 HTML 生成后 | 性能/缓存 |
| `web/response` | 序列化前 | 会话闪存/日志 |
| `web/ready` | 服务器启动 | 就绪通知 |
| `web/error` | 未捕获异常 | 统一告警 |
| `api/done` | API 处理完成 | 旁路落盘（预留） |
| `session/created` / `session/restored` / `session/destroyed` | 会话生命周期 | 审计 |

## 六、扩展机制总览

```
页面插件（cordis 插件）：apply 时 ctx.page.register / ctx.provide('page-block.<id>')
   ├─ 加页面 = 一个 register({...})；改页面某区域 = 替换/新增区块服务
   └─ 页面 = 服务 page.<id>——作用域 DI 可替换/隔离

语言包：ctx.i18n.register('en-US', {...})——核心零个性化，语言学全在项目侧

布局/主题：ctx.provide('layout.<id>', renderer)——替换布局 = 换布局服务；CSS 变量改主题

API/中间件：ctx.router.api / ctx.router.use / 路由级 middleware

服务替换：createWebApp(cfg, { services: { server: MyServer, ... } })——继承默认类魔改
   （driver 路径：webPlugin.config.core 透传同构选项）

浏览器控件：base.js 的 MOTEX.register(name, fn)——区块输出 data-motex-<name> 指令即点亮

HTTP 服务器：ctx.server.ws(path, handler) 注册 WebSocket 端点
```

## 七、设计原则（与 fetcher-core 同源）

1. **解耦**：服务器不知道渲染细节，渲染不知道存储——事件与 DI 串起来（pipeline）
2. **零个性化**：核心不认识任何具体站点页面；页面/区块/语言 = 项目 cordis 插件
3. **可扩展**：一切皆服务（页面/区块/布局），替换实现 = 换服务，无需改框架
4. **安全默认**：全链路 HTML 转义（markup.ts）、cookie 签名、路径穿越防护
5. **可观测**：管理后台 + 事件契约 + 日志分级
6. **可热更**：cordis.yml 声明式 + include 组合 + --watch 事务性热更新