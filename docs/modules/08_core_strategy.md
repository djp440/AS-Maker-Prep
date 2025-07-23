# 模块开发指南: Core - Strategy (GLFT模型)

## 1. 核心职责
- 实现 GLFT 模型的渐近解算法。
- 作为一个纯计算单元，接收市场和账户状态作为输入，输出理想的买卖报价。
- 不执行任何 I/O 操作（如 API 请求），不维护状态。
- 消除时间依赖性，适用于24/7连续交易。

## 2. 技术实现要点
- **结构**: 创建一个 `GLFTStrategy` 类或一组纯函数。
- **无状态设计**: 该模块应该是无状态的。每次计算都依赖于外部传入的参数，这使得它非常容易进行单元测试和回测。
- **输入**: 一个包含所有必要参数的对象，例如 `{ midPrice, volatility, normalizedInventory, riskAversion, orderFlowA, orderFlowK, maxInventoryQ }`。
- **输出**: 一个包含计算结果的对象，例如 `{ bidPrice, askPrice, halfSpread, skew, inventoryLimited }`。

## 3. 核心算法实现

### 3.1. 常数计算 (Constants C1, C2)
- **公式**: 
  - `C₁ = f(γ, A, k)` - 由风险厌恶系数和订单流强度决定
  - `C₂ = g(γ, A, k)` - 由风险厌恶系数和订单流强度决定
- **函数**: `calculateConstants(gamma, orderFlowA, orderFlowK)`
  - `γ` (riskAversion): 风险厌恶系数。
  - `A` (orderFlowA): 订单流强度参数A。
  - `k` (orderFlowK): 订单流强度参数k。
- **逻辑**: 根据GLFT模型的理论公式计算常数，这些常数在策略运行期间保持不变。

### 3.2. 半价差计算 (Half-Spread)
- **公式**: `half_spread = C₁ + C₂ * σ²`
- **函数**: `calculateHalfSpread(C1, C2, volatility)`
  - `C1`, `C2`: 预计算的常数。
  - `σ` (volatility): 市场波动率。
- **逻辑**: 计算基础的半价差，不依赖于库存状态。

### 3.3. 库存偏度计算 (Inventory Skew)
- **公式**: `skew = C₂ * σ`
- **函数**: `calculateSkew(C2, volatility)`
  - `C2`: 预计算的常数。
  - `σ` (volatility): 市场波动率。
- **逻辑**: 计算库存对报价的影响系数。

### 3.4. 报价深度计算 (Quote Depths)
- **公式**:
  - `bid_depth = half_spread + skew × q`
  - `ask_depth = half_spread - skew × q`
- **函数**: `calculateQuoteDepths(halfSpread, skew, normalizedInventory)`
  - `q` (normalizedInventory): 标准化库存量。
- **逻辑**: 根据当前库存调整买卖报价的深度。

### 3.5. 最终报价 (Bid/Ask Price)
- **公式**:
  - `bid_price = mid_price - bid_depth`
  - `ask_price = mid_price + ask_depth`
- **函数**: `calculateGLFTQuotes(inputs)`
  - **功能**: 这是模块的主入口点，整合所有计算步骤。
  - **输入**: 所有需要的市场和配置参数。
  - **输出**: `{ bidPrice, askPrice, halfSpread, skew }`。

### 3.6. 库存限制检查 (Inventory Limits)
- **逻辑**: 
  - 当 `q ≥ Q` 时，返回 `bidPrice = null`（停止下买单）
  - 当 `q ≤ -Q` 时，返回 `askPrice = null`（停止下卖单）
- **函数**: `checkInventoryLimits(normalizedInventory, maxInventoryQ)`

## 4. 与其他模块的交互
- **依赖**: 无直接依赖。它是一个独立的计算库。
- **被依赖**:
  - `trader`: `Trader` 模块是 `GLFTStrategy` 的主要使用者。`Trader` 负责从各个服务（`MarketDataService`, `AccountService`）收集数据，然后将这些数据传递给 `GLFTStrategy` 的计算函数以获取理论报价。

- **数据流**: 
  1. `Trader` 收集 `midPrice`, `σ`, `q`, `γ`, `A`, `k`, `Q`。
  2. `Trader` 调用 `GLFTStrategy.calculateGLFTQuotes({ midPrice, σ, q, γ, A, k, Q })`。
  3. `GLFTStrategy` 返回 `{ bidPrice, askPrice, halfSpread, skew, inventoryLimited }`。
  4. `Trader` 接收到理论报价，然后进行精度调整和风险检查，最终决定是否下单。

## 5. 测试
- **单元测试**: 由于其纯函数和无状态的特性，`GLFTStrategy` 模块非常适合进行单元测试。
- **测试用例**:
  - **零库存**: 当 `q = 0` 时，`bid_depth = ask_depth = half_spread`，报价关于中间价对称。
  - **多头库存**: 当 `q > 0` 时，`bid_depth > ask_depth`，买价更低以吸引卖单。
  - **空头库存**: 当 `q < 0` 时，`ask_depth > bid_depth`，卖价更低以吸引买单。
  - **高波动率**: 当 `σ` 增加时，`half_spread` 和 `skew` 都应增加。
  - **库存限制**: 测试 `|q| ≥ Q` 时的限制机制，相应方向的报价应为 `null`。
  - **常数计算**: 验证 `C1` 和 `C2` 的计算正确性。
  - **边界条件**: 测试极端参数值的情况。

## 6. 注意事项
- **保持纯粹**: 严格禁止在该模块中添加任何网络请求、文件读写或状态管理的代码。这会破坏其可测试性和可复用性。
- **命名清晰**: 函数和变量名应与 GLFT 模型的数学符号保持一致（如 `midPrice`, `q`, `gamma`, `sigma`, `halfSpread`, `skew`），以便于理解和验证。
- **时间无关性**: 确保所有计算都不依赖于终端时间T或当前时间，体现GLFT模型的核心优势。
- **库存限制**: 严格实现硬性库存限制机制，这是GLFT模型相比AS模型的重要改进。
- **常数预计算**: C1和C2常数应在策略初始化时计算一次，运行期间保持不变以提高效率。