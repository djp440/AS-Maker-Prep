# 模块开发指南: Core - Trader (GLFT模型)

## 1. 核心职责
- 驱动整个GLFT做市循环的业务流程。
- 从服务层收集数据，调用GLFT策略模块进行计算，并执行最终的交易决策。
- 管理订单的生命周期，包括下单、监控、更新和取消。
- 实现硬性库存限制机制，确保24/7连续运行的稳定性。

## 2. 技术实现要点
- **结构**: 创建一个 `Trader` 类，为每个交易对创建一个实例。
- **主循环 (Trading Loop)**: 每个 `Trader` 实例内部都有一个主循环（例如，通过 `setInterval` 或在每次数据更新后触发），该循环执行完整的做市逻辑。
- **状态管理**: `Trader` 维护着当前交易对的操作状态，例如 `isQuoting`, `activeBidOrderId`, `activeAskOrderId`。

## 3. 核心业务流程 (主循环)

**对于每个交易对的每一次循环：**

1.  **数据收集**: 
    - 从 `MarketDataService` 获取 `midPrice` 和 `volatility` (σ)。
    - 从 `AccountService` 获取 `normalizedInventory` (q)。
    - 从 `Config` 获取GLFT策略参数 `riskAversion` (γ), `orderFlowA` (A), `orderFlowK` (k), `maxInventoryQ` (Q), `orderAmount` 等。

2.  **策略计算**: 
    - 调用 `GLFTStrategy.calculateGLFTQuotes()` 并传入收集到的数据，获取理论上的 `theoreticalBid`, `theoreticalAsk`, `halfSpread`, `skew` 和库存限制状态。

3.  **精度调整**: 
    - 从 `ExchangeService` 获取该交易对的精度规则 (`tickSize`, `stepSize`)。
    - 使用 `Utils.adjustPrice()` 和 `Utils.adjustQuantity()` 将理论报价和下单数量调整为交易所接受的格式，得到 `actualBid`, `actualAsk`, `actualAmount`。

4.  **风险检查 (Pre-trade Checks)**:
    - **硬性库存限制**: 检查 `|q| ≥ Q` 的情况，如果触发限制则停止相应方向的下单（GLFT模型核心特性）。
    - **库存检查**: 检查如果新订单成交，总持仓是否会超过 `MAX_INVENTORY_Q`。 `(currentPosition + openOrders + newOrder) <= maxPosition`。
    - **最小名义价值**: 检查 `actualBid * actualAmount` 是否满足交易所的 `minNotional` 要求。
    - **价差保护**: 检查 `(actualAsk - actualBid)` 是否过大或为负。
    - **报价有效性**: 检查策略返回的报价是否为 `null`（库存限制触发时）。
    - 如果任何检查失败，则取消本次报价，并记录警告日志。

5.  **订单执行与管理**: 
    - **取消旧订单**: 首先，取消所有当前还挂在市场上的旧买卖订单（通过 `activeBidOrderId` 和 `activeAskOrderId` 跟踪）。
    - **下新订单**: 
        - 根据 `TRADE_SIDE` 配置决定下单逻辑：
            - `both`: 同时下新的买单（在 `actualBid`）和卖单（在 `actualAsk`）。
            - `long`: 只下买单。
            - `short`: 只下卖单。
        - 调用 `ExchangeService.createOrder()`。
    - **保存新订单ID**: 将新创建的订单ID保存到 `activeBidOrderId` 和 `activeAskOrderId` 中，以便下次循环可以取消它们。

## 4. 订单生命周期管理
- **订单超时**: 实现一个机制，如果订单在特定时间（如5分钟）内未成交，则自动取消，以避免持有过时的“僵尸”订单。
- **部分成交**: 监听 `watchOrders` 事件。如果一个订单被部分成交，`AccountService` 的库存会更新，这将自动在下一次主循环中影响 `q` 的计算，从而调整报价，这是一个自适应的过程。

## 5. 与其他模块的交互
- **依赖**: `GLFTStrategy`, `ExchangeService`, `MarketDataService`, `AccountService`, `Config`, `Logger`, `Utils`。
- **被依赖**: `main.js` 模块会创建和启动 `Trader` 实例。
- **协调者角色**: `Trader` 是所有模块的"协调者"。它不直接实现任何功能，而是通过调用其他模块的服务来完成复杂的GLFT业务逻辑。

## 6. 注意事项
- **并发安全**: 在执行“取消旧订单 -> 下新订单”这个原子操作时，要防止竞争条件。确保在新的订单成功创建之前，旧的订单已经被确认取消。
- **错误处理**: `Trader` 的主循环必须被包裹在健壮的 `try...catch` 块中，以确保单个交易对的失败不会导致整个应用程序崩溃。
- **启动逻辑**: 在 `Trader` 启动时，应首先进行一次完整的状态同步（账户、持仓），并取消所有可能存在的“僵尸”订单，然后再开始主循环。