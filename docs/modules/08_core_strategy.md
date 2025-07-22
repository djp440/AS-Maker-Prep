# 模块开发指南: Core - Strategy

## 1. 核心职责
- 实现 Avellaneda-Stoikov 模型的核心算法。
- 作为一个纯计算单元，接收市场和账户状态作为输入，输出理想的买卖报价。
- 不执行任何 I/O 操作（如 API 请求），不维护状态。

## 2. 技术实现要点
- **结构**: 创建一个 `Strategy` 类或一组纯函数。
- **无状态设计**: 该模块应该是无状态的。每次计算都依赖于外部传入的参数，这使得它非常容易进行单元测试和回测。
- **输入**: 一个包含所有必要参数的对象，例如 `{ midPrice, volatility, normalizedInventory, riskAversion, baseSpread }`。
- **输出**: 一个包含计算结果的对象，例如 `{ reservationPrice, optimalSpread, bidPrice, askPrice }`。

## 3. 核心算法实现

### 3.1. 预留价格 (Reservation Price, r)
- **公式**: `r = s - q * γ * σ²`
- **函数**: `calculateReservationPrice(s, q, gamma, sigma)`
  - `s` (midPrice): 市场中间价。
  - `q` (normalizedInventory): 标准化库存量。
  - `γ` (riskAversion): 风险厌恶系数。
  - `σ` (volatility): 市场波动率。
- **逻辑**: 直接根据公式进行计算。这个价格是策略愿意持有资产的“公平”价格，会根据库存 `q` 进行调整。

### 3.2. 最优价差 (Optimal Spread)
- **公式**: `Spread = BaseSpread + VolatilitySpread * σ` (简化模型，实际可以只用 `BaseSpread` 或更复杂的模型)
- **函数**: `calculateOptimalSpread(baseSpread, volatility, ...)`
  - `baseSpread`: 基础价差，零库存时的最小价差。
  - `volatility`: 市场波动率。
- **逻辑**: 在基础价差之上，可以根据波动性增加额外的价差，以补偿市场风险。在当前项目中，可以简化为 `Spread = BaseSpread`，或 `Spread = BaseSpread + γ * σ`。

### 3.3. 最终报价 (Bid/Ask Price)
- **公式**:
  - `Ask = r + Spread / 2`
  - `Bid = r - Spread / 2`
- **函数**: `calculateQuotes(inputs)`
  - **功能**: 这是模块的主入口点，它调用上述内部函数，并整合计算出最终的理论报价。
  - **输入**: 所有需要的市场和配置参数。
  - **输出**: `{ bidPrice, askPrice }`。

## 4. 与其他模块的交互
- **依赖**: 无直接依赖。它是一个独立的计算库。
- **被依赖**:
  - `trader`: `Trader` 模块是 `Strategy` 的主要使用者。`Trader` 负责从各个服务（`MarketDataService`, `AccountService`）收集数据，然后将这些数据传递给 `Strategy` 的计算函数以获取理论报价。

- **数据流**: 
  1. `Trader` 收集 `s`, `σ`, `q`, `γ`, `BaseSpread`。
  2. `Trader` 调用 `Strategy.calculateQuotes({ s, σ, q, ... })`。
  3. `Strategy` 返回 `{ bidPrice, askPrice }`。
  4. `Trader` 接收到理论报价，然后进行精度调整和风险检查，最终决定是否下单。

## 5. 测试
- **单元测试**: 由于其纯函数和无状态的特性，`Strategy` 模块非常适合进行单元测试。
- **测试用例**:
  - **零库存**: 当 `q = 0` 时，预留价格 `r` 应等于中间价 `s`。
  - **多头库存**: 当 `q > 0` 时，预留价格 `r` 应低于中间价 `s`，报价整体下移以吸引卖单。
  - **空头库存**: 当 `q < 0` 时，预留价格 `r` 应高于中间价 `s`，报价整体上移以吸引买单。
  - **高波动率**: 当 `σ` 增加时，价差应扩大（如果模型支持）。
  - **边界条件**: 测试 `q` 极大或极小的情况。

## 6. 注意事项
- **保持纯粹**: 严格禁止在该模块中添加任何网络请求、文件读写或状态管理的代码。这会破坏其可测试性和可复用性。
- **命名清晰**: 函数和变量名应与 Avellaneda-Stoikov 模型的数学符号保持一致（如 `s`, `q`, `gamma`, `sigma`），以便于理解和验证。