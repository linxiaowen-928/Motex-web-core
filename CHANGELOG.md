# Changelog

## 0.1.1 (2026-09-06)

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

## 0.1.0 (2026-09-06)

- 首个版本：cordis 声明式装配的 Web 前台框架核心（纯服务端渲染全家桶）。
  server/router/page/render/asset/session/i18n/theme/manage + loader/CLI + 双重自检 + 示例站。