# 模块开发指南: Services - Account Service

## 1. 核心职责
- 跟踪和管理账户的实时状态，包括总资产、持仓和活动订单。
- 提供统一的接口，供策略和交易模块查询账户信息。
- 计算与库存相关的衍生数据，如持仓价值和标准化库存量。

## 2. 技术实现要点
- **结构**: 创建 `AccountService` 类，维护账户的整体状态。
- **数据同步**: 
  - **实时更新**: 监听 `WebSocketManager` 分发的私有数据事件（`orders`, `balance`, `positions`）来实时更新内存中的状态。
  - **定期轮询/启动同步**: 通过 `ExchangeService` 的 REST API (`fetchBalance`, `fetchPositions`, `fetchOpenOrders`) 定期或在启动/重连时进行全量数据同步，以校准状态，防止因 WebSocket 消息丢失导致的状态不一致。
- **状态缓存**: 在内存中维护一个可靠的账户状态快照。

## 3. 核心数据与计算

### 3.1. 账户资产
- **总资产 (Total Equity)**: 
  - **来源**: 从 `fetchBalance` 或 `watchBalance` 获取。
  - **接口**: `getTotalEquity(currency)` (e.g., currency='USDT')。

### 3.2. 持仓管理
- **数据结构**: 使用一个 Map 或对象来存储每个交易对的持仓信息，`{ 'BTC/USDT:USDT': { amount: 0.5, entryPrice: 48000 } }`。
- **更新**: 根据 `watchPositions` 的实时更新和 `fetchPositions` 的全量同步来维护。
- **接口**: `getPosition(symbol)`。

### 3.3. 订单管理
- **数据结构**: 使用一个 Map 存储所有活动的订单。
- **更新**: 
  - 当 `trader` 模块成功创建一个新订单时，将其添加到此处的缓存中。
  - 监听 `watchOrders` 事件，当订单被部分成交、完全成交或取消时，更新或移除缓存中的订单。
- **接口**: `getOpenOrders(symbol)`。

### 3.4. 标准化库存量 (q)
- **这是 Avellaneda-Stoikov 模型的核心输入之一**。
- **计算逻辑**:
  1. **获取持仓**: `position = getPosition(symbol)`。
  2. **获取市价**: `midPrice = marketDataService.getMidPrice(symbol)`。
  3. **计算持仓价值**: `inventoryValue = Math.abs(position.amount) * midPrice`。
  4. **获取总资产**: `totalEquity = getTotalEquity('USDT')`。
  5. **计算库存比例**: `inventoryRatio = inventoryValue / totalEquity`。
  6. **获取最大库存配置**: `maxInventory = config.getStrategyParams(symbol).MAX_INVENTORY`。
  7. **计算标准化库存量**: `q = (inventoryRatio / maxInventory) * Math.sign(position.amount)`。
- **接口**: `getNormalizedInventory(symbol)`。

## 4. 与其他模块的交互
- **依赖**: `WebSocketManager`, `ExchangeService`, `MarketDataService`, `Config`, `Logger`。
- **被依赖**:
  - `strategy`: 调用 `getNormalizedInventory(symbol)` 获取计算预留价格所需的核心参数 `q`。
  - `trader`: 在下单前调用 `getPosition` 和 `getOpenOrders` 来进行风险检查（如检查是否会超过最大库存）。

## 5. 注意事项
- **状态一致性**: 保证状态一致性是本模块最大的挑战。必须结合 WebSocket 的实时更新和 REST API 的定期全量同步。
- **“在途”订单**: 在计算当前风险敞口时，不仅要考虑当前持仓，还必须考虑所有未成交的开仓订单的影响。
- **多交易对隔离**: 每个交易对的持仓和订单状态必须严格隔离。