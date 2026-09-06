# Changelog

> **发版规则**：每个版本必须配套一份升级文档（[docs/upgrades/](docs/upgrades/)，见 [UPGRADING.md](UPGRADING.md)），
> 说明改动清单与破坏性改动（BREAKING）处理方式；本清单只做索引式摘要。

## 0.2.2 (2026-09-06) · [升级文档](docs/upgrades/0.2.2.md)

### 新增
- 自动注册（registry client）：应用启动自动上报导航站 + 心跳续命，90s 无心跳自动下架；
  `WebConfig.registry` 配置段（url/name/desc/tags/group/icon/heartbeatSec），缺省不启用
- 导航站 `POST /api/nav/register|unregister`：外部注册站点只读展示，yml 条目优先

## 0.2.1 (2026-09-06) · [升级文档](docs/upgrades/0.2.1.md)

### 新增：端口记忆（稳定端口）
- 实际监听端口写入 `state/port.memory.json`（按 portKey 分键：常规应用 `default`，共享核站点 = 站点 id）
- **下次启动优先使用上次实际端口**（不再从首选端口重新探测漂移）——每个 web 尽量钉在固定端口，
  多 web 各自占位后重启不互抢、不换号
- 记忆端口被占 → +1 顺延并**更新记忆**；修改配置端口 → 以新配置为准（记忆自动随新配置重建）
- `server.portMemory` 开关（缺省 true）；随机端口（port 0）不记忆；删 `state/port.memory.json` 即重置

## 0.2.0 (2026-09-06) · [升级文档](docs/upgrades/0.2.0.md)

### 新增：共享核多站点（Host 模式）
- `mountSite(hostCtx, cfg)` / `loadSitePlugin()`：在唯一 cordis 进程内挂载站点——
  业务服务名全隔离的作用域（page/router/render/session/i18n/theme/manage/server/m/esc/asset），
  各站点独立端口 listener（请求按作用域分派，互不可见），asset 共享宿主实例。
- 站点插件零改动接入（动态 import + 手动 apply，避开 active-fiber 嵌套 plugin 延迟坑）。
- 运行期上下文参数化：ServerService/PageService/RenderService 支持 `opts.runtime`——
  单站点 = root（全局视图）；共享核 = 站点作用域。
- PageService 支持 `opts.ns`（站点命名空间）：`page.<id>/page-block.<id>` 动态服务名
  加前缀，站点间同名页面/区块互不冲突。
- index.ts 导出 WebConfig 等配置类型。
- 示例修复：examples 页面 data 改用 `i18n.resolveLang`（宽容 Accept-Language 解析）。

## 0.1.1 (2026-09-06) · [升级文档](docs/upgrades/0.1.1.md)

### 修复
- 运行期统一使用 root ctx（全局服务视图）：中间件/API/页面/区块/布局回调现在能访问
  兄弟插件提供的服务（此前 strict fiber 下报 `cannot get property X without inject`）；
  行为向后兼容，属能力增强。修复了插件生态（如导航站提供 `nav` 服务）的关键卡点。

### 新增
- 端口避让机制：默认端口 18080，`EADDRINUSE` 时自动 +1 顺延
  （`server.portAutoShift` 开关，缺省开；`server.portShiftLimit` 上限，缺省 100）。
- 控制台日志输出（cordis logger 默认只缓冲）：`plugins/console.ts` 挂接，
  WARN 及以上走 stderr。

### 变更（注意）
- 默认端口 8080 → 18080：依赖项目若未显式配置 `server.port`，启动端口会变化。

## 0.1.0 (2026-09-06) · [升级文档](docs/upgrades/0.1.0.md)

- 首个版本：cordis 声明式装配的 Web 前台框架核心（纯服务端渲染全家桶）。
  server/router/page/render/asset/session/i18n/theme/manage + loader/CLI + 双重自检 + 示例站。