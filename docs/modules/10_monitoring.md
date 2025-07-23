# 模块开发指南: Monitoring (Health Checker, Alert Manager, Metrics Collector) - GLFT模型

## 1. 核心职责
- **Health Checker**: 监控应用程序的关键组件（如 WebSocket 连接、API 可用性）是否正常运行。
- **Alert Manager**: 在检测到严重问题时，通过预设的渠道（如日志、未来可扩展的钉钉/Telegram）发送告警。
- **Metrics Collector**: 收集和记录关键的性能和交易指标，用于分析和报告。
- **GLFT特有监控**: 监控库存限制触发情况、半价差和偏度计算的有效性。

*在项目初期，这三个模块的功能可以被简化并整合到一个或两个文件中，主要通过日志系统来实现。*

## 2. Health Checker (健康状态检查)

### 2.1. 监控点
- **WebSocket 连接状态**: 
  - **逻辑**: 定期检查 `WebSocketManager` 的连接状态。如果状态长时间处于 `closed` 或 `connecting`，则认为连接异常。
  - **实现**: `WebSocketManager` 可以在连接状态改变时发出事件，健康检查器监听这些事件。
- **API 可用性**: 
  - **逻辑**: 定期（例如，每5分钟）向交易所发送一个轻量级的只读API请求（如 `fetchStatus` 或 `fetchTime`）。如果请求失败或超时，则认为 API 不可用。
  - **实现**: 通过 `ExchangeService` 调用。
- **数据流延迟**: 
  - **逻辑**: 比较收到的 WebSocket 消息中的时间戳和本地系统时间戳。如果延迟持续超过一个阈值（如5秒），则可能存在网络或交易所问题。

### 2.2. 状态输出
- 健康检查的结果应通过 `Logger` 以 `info` 或 `warn` 级别定期输出。
- **示例日志**: `[INFO] [HealthCheck] System status: { ws_connection: 'OK', api_availability: 'OK', data_latency_ms: 50 }`

## 3. Alert Manager (告警管理)

### 3.1. 触发条件 (Triggers)
- **严重错误**: 
  - WebSocket 连续重连失败超过最大次数。
  - API 认证失败 (`AuthenticationError`)。
  - 程序启动验证失败。
  - 出现未捕获的严重异常导致进程退出。
- **风险阈值**: 
  - 库存水平超过强制减仓阈值（如 `MAX_INVENTORY_Q` 的 120%）。
  - GLFT硬性库存限制频繁触发（如连续10次循环都触发限制）。
  - 半价差计算异常（如返回负值或极大值）。
  - 市场波动率或价差异常，触发了交易暂停。

### 3.2. 告警方式
- **当前版本**: 所有告警都通过 `Logger` 以 `ERROR` 级别记录。这是最直接的实现方式。
- **未来扩展**: 可以设计一个 `AlertManager` 类，它有一个 `send(message)` 方法。目前这个方法只是调用 `logger.error()`，但未来可以轻松地扩展为发送HTTP请求到钉钉机器人或Telegram Bot。

## 4. Metrics Collector (指标收集)

### 4.1. 收集的指标
- **交易指标**: 
  - `total_trades`: 总成交次数。
  - `total_volume`: 总成交量。
  - `pnl`: 已实现和未实现的盈亏。
  - `fees_paid`: 支付的总手续费。
- **性能指标**: 
  - `api_call_count`: API 调用次数。
  - `api_error_rate`: API 调用错误率。
  - `order_fill_rate`: 订单成交率。
- **GLFT特有指标**: 
  - `inventory_limit_triggers`: 库存限制触发次数。
  - `avg_half_spread`: 平均半价差。
  - `avg_skew`: 平均库存偏度。
  - `inventory_utilization`: 库存利用率 (|q|/Q)。

### 4.2. 实现方式
- **事件驱动**: 在关键事件发生时收集指标。
  - `AccountService` 在收到订单成交更新时，可以更新 `total_trades`, `pnl` 等。
  - `ExchangeService` 在每次 API 调用后，可以更新 `api_call_count`。
- **定期报告**: 
  - 创建一个 `MetricsCollector` 服务，定期（如每小时或每天）将收集到的指标通过 `Logger` 以 `info` 级别打印出来。
  - **示例日志**: `[INFO] [Metrics] Daily report: { trades: 150, volume: 7.5, pnl: 120.5, fees: 15.2 }`

## 5. 与其他模块的交互
- **监控模块是观察者**: 它们观察其他模块的状态和事件，但不直接参与核心业务逻辑。
- **依赖**: `Logger`, `WebSocketManager`, `ExchangeService`, `AccountService`。
- **被依赖**: 无。

## 6. 注意事项
- **从简开始**: 在项目初期，不要过度设计监控系统。一个良好的日志系统是所有监控的基础。
- **性能影响**: 指标收集和健康检查不应过于频繁，以免对系统性能产生负面影响。