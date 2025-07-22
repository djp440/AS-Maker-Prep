# 模块开发指南: Services - WebSocket Manager

## 1. 核心职责
- 管理与 Bitget 交易所的 WebSocket 连接。
- 处理连接的认证、订阅、心跳和自动重连。
- 接收实时数据流（行情、订单、账户），并将其分发给相应的服务模块。

## 2. 技术实现要点
- **库**: 使用 `ccxt` 提供的 `watch` 系列方法，它内置了对 WebSocket 的支持。
- **结构**: 创建一个 `WebSocketManager` 类，作为所有 WebSocket 交互的中心枢纽。
- **URL切换**: 
  - 在初始化时，根据 `Config` 模块的 `PAPER_TRADING` 标志，动态设置 `ccxt` 实例的 WebSocket URL。
  - **实盘**: 使用默认 URL。
  - **模拟盘**: 需要将 `urls.api.ws` 或类似属性覆盖为模拟盘的地址 (`wss://wspap.bitget.com/v2/ws/public` 或 `wss://wspap.bitget.com/v2/ws/private`)。
- **连接管理**: 
  - 维护连接状态（connecting, open, closing, closed）。
  - 实现一个健壮的自动重连机制，采用指数退避策略（例如，延迟 1s, 2s, 4s, ... , 60s）。
- **订阅管理**: 
  - 跟踪当前已订阅的频道（topics）。
  - 在重连成功后，自动重新订阅之前的所有频道。

## 3. 数据流与订阅
- **核心方法**: `watch(topic, messageHandler)`
  - **功能**: 订阅一个主题，并为收到的消息注册一个处理函数。
- **订阅的主题 (Topics)**:
  - **行情数据**: 
    - `watchTicker(symbol)`: 订阅最新 Ticker。
    - `watchOrderBook(symbol)`: 订阅深度图（做市策略的核心数据源）。
  - **私有数据 (需要认证)**:
    - `watchOrders(symbol)`: 订阅订单更新（成交、取消等）。
    - `watchBalance()`: 订阅账户余额变化。
    - `watchPositions(symbol)`: 订阅持仓变化。
- **数据分发**: `WebSocketManager` 自身不处理业务逻辑。它接收到数据后，应通过事件发射器（`EventEmitter`）或回调函数，将数据传递给 `MarketDataService` 和 `AccountService`。

## 4. 连接稳定性机制
- **心跳检测**: `ccxt` 的 WebSocket 实现通常会自动处理心跳。需要确认 Bitget 的心跳机制（30秒 ping），并确保连接在无响应时能被正确关闭和重连。
- **自动重连**: 
  - 监听 `close` 和 `error` 事件来触发重连逻辑。
  - 在重连前清理所有旧的订阅状态。
  - 设置最大重连尝试次数，若持续失败则触发系统级告警。
- **状态恢复**: 重连成功后，不仅要重新订阅频道，还应通知 `AccountService` 通过 REST API 主动查询一次账户状态，以确保数据同步，防止在断连期间错过状态变化。

## 5. 与其他模块的交互
- **依赖**: `ccxt`, `Config`, `Logger`, `EventEmitter` (Node.js 内置)。
- **被依赖**:
  - `market_data_service`: 从 `WebSocketManager` 接收实时行情数据。
  - `account_service`: 从 `WebSocketManager` 接收实时的订单、余额和持仓更新。
- **交互模式**: 
  ```javascript
  // WebSocketManager.js
  const events = new EventEmitter();
  // ... on message received for order book ...
  events.emit('orderbook', data);

  // MarketDataService.js
  webSocketManager.events.on('orderbook', (data) => {
    // process order book data
  });
  ```

## 6. 注意事项
- **并发限制**: 注意 Bitget 对单 IP 的 WebSocket 连接数限制（100个并发）。对于多交易对，应尽可能复用单个连接来订阅多个频道，而不是为每个交易对都创建一个新连接。
- **消息速率**: 遵守每秒最多10条消息的速率限制。`ccxt` 的实现有助于处理这个问题。
- **24小时断开**: Bitget 会在24小时后强制断开连接。重连机制必须能够优雅地处理这种情况。