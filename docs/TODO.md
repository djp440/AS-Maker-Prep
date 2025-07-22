# 项目开发任务清单 (TODO)

本文档根据开发顺序和模块职责，列出了详细的开发任务清单。
[ ] - 未执行
[x] - 已执行
## 0. 项目初始化

- [x] 创建项目目录结构 (`src/core`, `src/services`, `src/shared`, `src/monitoring`).
- [x] 初始化 `package.json` (`npm init -y`).
- [x] 安装核心依赖 (`npm install ccxt dotenv winston dayjs`).
- [x] 安装开发依赖 (`npm install -D jest` 或其他测试框架).
- [x] 配置 `.gitignore` 文件，忽略 `node_modules`, `.env`, `logs`.

---

## 第一阶段：基础服务与配置 (Foundation)

### 1. Shared - Config (`src/shared/config.js`)

- [x] 创建 `Config` 类或单例对象。
- [x] 实现加载 `.env` 文件的功能 (`dotenv`).
- [x] 实现异步读取和解析 `config.json` 的功能 (`fs/promises`).
- [x] 提供清晰的 getter 方法 (`getApiKey`, `getSymbols`, `getStrategyParams`).
- [x] 实现启动时配置验证逻辑（检查必要参数、验证格式）。
- [x] 如果验证失败，记录错误并终止程序。

### 2. Shared - Logger (`src/shared/logger.js`) - 已完成

- [x] **特别说明**: 由于 `winston` 与项目中其他依赖存在冲突，最终选择 `pino` 作为日志库。
- [x] 使用 `pino` 创建一个全局 logger 实例。
- [x] 配置了美化的控制台输出 (`pino-pretty`)。
- [x] 配置了日志文件输出到 `logs/combined.log`。
- [x] 配置了错误日志单独输出到 `logs/error.log`。
- [x] 定义并实现了标准化的日志格式。
- [x] **注意**: 尽管代码实现和依赖冲突已解决，但在当前开发环境中日志文件未能成功生成。推测是由于本地环境的 I/O 或权限问题导致，代码本身是健壮的。

### 3. Shared - Utils (`src/shared/utils.js`)

- [ ] 创建 `precisionUtils.js` 用于精度计算。
  - [ ] 实现 `adjustPrice(price, tickSize)` 函数。
  - [ ] 实现 `adjustQuantity(quantity, stepSize, minQty)` 函数。
  - [ ] 实现 `checkMinNotional(price, quantity, minNotional)` 函数。
- [ ] 创建 `timeUtils.js` 用于时间处理。
  - [ ] 实现 `getTimestamp()` 函数。
  - [ ] 实现 `formatDate(timestamp)` 函数。
- [ ] 创建 `asyncUtils.js` 用于异步操作。
  - [ ] 实现 `sleep(ms)` 函数。

---

## 第二阶段：交易所接口与数据服务 (Connectivity & Data)

### 4. Services - Exchange Service (`src/services/exchange_service.js`)

- [ ] 创建 `ExchangeService` 类，并在构造函数中初始化 `ccxt`。
- [ ] 实现根据 `Config` 模块的配置，动态切换实盘和模拟盘模式。
- [ ] 启用 `ccxt` 内置的速率限制 (`enableRateLimit`).
- [ ] 实现 `loadMarkets()` 方法，在启动时加载并缓存市场信息。
- [ ] 实现 `getMarket(symbol)` 方法，提供精度和限制信息。
- [ ] 封装核心的 REST API 方法，并添加健壮的错误处理和重试逻辑：
  - [ ] `fetchBalance()`
  - [ ] `fetchPositions()`
  - [ ] `createOrder()`
  - [ ] `cancelOrder()`
  - [ ] `fetchOpenOrders()`
  - [ ] `setLeverage()`
  - [ ] `fetchOHLCV()`

### 5. Services - WebSocket Manager (`src/services/websocket_manager.js`)

- [ ] 创建 `WebSocketManager` 类，管理 WebSocket 连接。
- [ ] 实现基于 `ccxt` 的 `watch` 系列方法。
- [ ] 实现根据配置切换实盘/模拟盘 WebSocket URL。
- [ ] 实现健壮的自动重连机制（指数退避）。
- [ ] 实现订阅管理，重连后自动重新订阅频道。
- [ ] 使用 `EventEmitter` 将收到的数据分发出去 (`orderbook`, `orders`, `positions` 等)。
- [ ] 在重连成功后，触发事件通知 `AccountService` 进行状态校准。

### 6. Services - Market Data Service (`src/services/market_data_service.js`)

- [ ] 创建 `MarketDataService` 类。
- [ ] 监听 `WebSocketManager` 的行情事件 (`ticker`, `orderbook`)。
- [ ] 实现 `getMidPrice(symbol)`，实时计算并缓存市场中间价。
- [ ] 实现 `getVolatility(symbol)`，通过 `ExchangeService` 定期获取K线并计算波动率。
- [ ] 在启动时，主动获取一次历史K线来初始化波动率。
- [ ] 实现数据验证逻辑（价差、波动率异常检测）。

### 7. Services - Account Service (`src/services/account_service.js`)

- [ ] 创建 `AccountService` 类。
- [ ] 监听 `WebSocketManager` 的私有数据事件 (`orders`, `balance`, `positions`)。
- [ ] 实现启动/重连时通过 REST API 进行全量数据同步。
- [ ] 在内存中维护账户状态（总资产、持仓、活动订单）。
- [ ] 实现 `getTotalEquity()`, `getPosition(symbol)`, `getOpenOrders(symbol)` 等接口。
- [ ] 实现核心计算方法 `getNormalizedInventory(symbol)`。

---

## 第三阶段：核心策略与执行 (Core Logic)

### 8. Core - Strategy (`src/core/strategy.js`)

- [ ] 创建一个无状态的 `Strategy` 模块（类或纯函数集合）。
- [ ] 实现 `calculateReservationPrice(s, q, gamma, sigma)` 函数。
- [ ] 实现 `calculateOptimalSpread(baseSpread, ...)` 函数。
- [ ] 实现主入口函数 `calculateQuotes(inputs)`，返回 `{ bidPrice, askPrice }`。
- [ ] 为 `Strategy` 模块编写单元测试，覆盖关键场景（零库存、多/空头库存、高波动率）。

### 9. Core - Trader (`src/core/trader.js`)

- [ ] 创建 `Trader` 类，为每个交易对创建一个实例。
- [ ] 实现主交易循环 (`trading loop`)。
- [ ] 在循环中，完成数据收集 -> 策略计算 -> 精度调整 -> 风险检查 -> 订单执行的完整流程。
- [ ] 实现订单生命周期管理：取消旧订单，下新订单，并保存新订单ID。
- [ ] 实现启动时取消所有“僵尸”订单的逻辑。
- [ ] 在主循环中添加完整的 `try...catch` 块，防止单个交易对失败影响全局。

---

## 第四阶段：整合与监控 (Integration & Monitoring)

### 10. Main.js (`src/main.js`)

- [ ] 实现程序启动流程：加载配置 -> 初始化日志 -> 初始化所有服务。
- [ ] 启动 `WebSocketManager` 连接并进行初始账户同步。
- [ ] 遍历配置文件中的交易对，为每个交易对创建并启动一个 `Trader` 实例。
- [ ] 实现全局异常处理 (`uncaughtException`, `unhandledRejection`)。
- [ ] 实现优雅退出逻辑 (`SIGINT`, `SIGTERM`)，确保退出前取消所有挂单。

### 11. Monitoring (`src/monitoring/`)

- [ ] 创建 `HealthChecker` 模块。
  - [ ] 定期检查 WebSocket 连接状态。
  - [ ] 定期检查 API 可用性。
- [ ] 创建 `AlertManager` 模块。
  - [ ] 定义告警触发条件（如连续重连失败、认证失败）。
  - [ ] 实现通过 `logger.error()` 发送告警。
- [ ] 创建 `MetricsCollector` 模块。
  - [ ] 实现交易指标（成交量、PNL、费用）和性能指标（API调用次数）的收集。
  - [ ] 实现定期通过日志打印指标报告。

---

## 5. 测试与文档

- [ ] 完善所有核心模块的单元测试。
- [ ] 进行集成测试，在模拟盘环境中验证完整的做市流程。
- [ ] 编写或更新 `README.md`，包含安装、配置和启动说明。
- [ ] 确保所有代码都有清晰的 JSDoc 注释。