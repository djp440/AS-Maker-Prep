# 模块开发指南: Services - Exchange Service

## 1. 核心职责
- 封装 `CCXT` 库，为上层应用提供一个统一、简化的交易所接口。
- 处理 API 的认证、请求和响应。
- 实现 API 速率限制和错误重试逻辑。
- 获取交易所的市场结构信息（如精度、限制等）。
- **支持实盘与模拟盘模式的切换**。

## 2. 技术实现要点
- **库**: `ccxt`。
- **结构**: 创建一个 `ExchangeService` 类，在构造函数中初始化 `ccxt` 实例。
- **单例模式**: 整个应用中应只存在一个 `ExchangeService` 实例，以共享 API 连接和速率限制状态。
- **认证与模式切换**: 
  - 在初始化时，从 `Config` 模块读取 `PAPER_TRADING` 标志。
  - 如果启用模拟盘，则使用模拟盘的 API 密钥 (`PAPER_API_KEY` 等) 和特定的 `options` (如 `{'papertrading': true}` 或修改 `urls`) 来实例化 `ccxt`。
  - 否则，使用实盘的 API 密钥进行标准实例化。
- **速率控制**: 利用 `ccxt` 内置的 `enableRateLimit` 功能，并可考虑封装更复杂的令牌桶或优先级队列逻辑。

## 3. 核心方法定义

### 3.1. 市场和账户信息
- `loadMarkets()`
  - **功能**: 加载并缓存所有交易对的市场信息。
  - **调用时机**: 程序启动时调用一次。
- `getMarket(symbol)`
  - **功能**: 从缓存中获取指定交易对的市场信息，特别是 `precision` 和 `limits`。
- `fetchBalance()`
  - **功能**: 获取账户的资产余额。
- `fetchPositions()`
  - **功能**: 获取当前持仓信息。

### 3.2. 交易操作 (REST API)
- **通用错误处理**: 所有交易方法都应包含 `try...catch` 块，捕获 `ccxt` 抛出的异常（如 `NetworkError`, `ExchangeError`），并根据错误类型执行重试或上报。
- `createOrder(symbol, type, side, amount, price, params)`
  - **功能**: 创建订单。
  - **参数**: `params` 可用于传递特定于交易所的参数，如 `postOnly` 或 `reduceOnly`。
- `cancelOrder(id, symbol)`
  - **功能**: 取消一个订单。
- `fetchOpenOrders(symbol)`
  - **功能**: 获取指定交易对的未成交订单。
- `setLeverage(symbol, leverage)`
  - **功能**: 为合约交易对设置杠杆。

### 3.3. 行情数据
- `fetchOHLCV(symbol, timeframe, since, limit)`
  - **功能**: 获取 K 线数据，用于波动率计算。
- `fetchTicker(symbol)`
  - **功能**: 获取最新的市场 Ticker 信息（包含买一、卖一价）。

## 4. API 速率控制与错误处理
- **内置速率限制**: 确保 `ccxt` 实例的 `enableRateLimit` 设置为 `true`。
- **智能重试**: 
  - 识别可重试的错误（如网络问题 `NetworkError`、交易所临时繁忙 `RequestTimeout`）。
  - 使用指数退避算法（e.g., 1s, 2s, 4s...）进行重试。
  - 设置最大重试次数，超过后向上抛出异常。
- **致命错误**: 对于不可重试的错误（如认证失败 `AuthenticationError`、无效参数 `InvalidOrder`），应立即记录错误并通知上层模块，而不是重试。

## 5. 与其他模块的交互
- **依赖**: `ccxt`, `Config`, `Logger`。
- **被依赖**:
  - `trader`: 调用 `createOrder`, `cancelOrder` 等方法执行交易。
  - `market_data_service`: 调用 `fetchOHLCV`, `fetchTicker` 获取行情数据。
  - `account_service`: 调用 `fetchBalance`, `fetchPositions` 获取账户状态。
  - `main`: 在启动时调用 `loadMarkets` 和 `setLeverage`。

## 6. 注意事项
- **统一 Symbol 格式**: 确保所有传入 `ExchangeService` 的 `symbol` 都使用 CCXT 的标准格式。
- **抽象泄漏**: 尽量避免将 `ccxt` 的特定实现细节泄漏到上层模块。例如，`trader` 模块不应该知道它正在与 `ccxt` 交互，而只知道它在与 `ExchangeService` 交互。