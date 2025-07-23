# 模块开发指南: Core - Strategy (GLFT模型中低频改造版)

## 1. 核心职责
- 实现中低频改造的GLFT策略：从"抢时间"到"管库存"的核心转变。
- 提供两种模式：固定价差+偏度模式（主要）和传统GLFT模式（备用）。
- 作为一个纯计算单元，接收市场和账户状态作为输入，输出理想的买卖报价。
- 不执行任何 I/O 操作（如 API 请求），不维护状态。
- 适应网络延迟和手续费限制，确保单笔交易有足够利润。

## 2. 技术实现要点
- **结构**: 创建 `MidLowFreqGLFTStrategy` 主模块和 `TraditionalGLFTStrategy` 备用模块。
- **无状态设计**: 该模块应该是无状态的。每次计算都依赖于外部传入的参数，这使得它非常容易进行单元测试和回测。
- **输入**: 包含所有必要参数的对象，例如 `{ midPrice, volatility, normalizedInventory, riskAversion, halfSpreadPct, minSpreadPct, useTraditionalGLFT, maxInventoryQ }`。
- **输出**: 包含计算结果的对象，例如 `{ bidPrice, askPrice, halfSpread, skew, inventoryLimited, strategyMode }`。

## 3. 中低频改造核心算法

### 3.1. 固定价差+偏度模式（主要模式）

#### 3.1.1. 固定半价差设定
- **公式**: `half_spread = midPrice * halfSpreadPct / 100`
- **函数**: `calculateFixedHalfSpread(midPrice, halfSpreadPct)`
- **逻辑**: 不再依赖复杂的C1、C2常数计算，直接使用配置的固定百分比

#### 3.1.2. 库存偏度计算（核心价值）
- **公式**: `skew = midPrice * volatility * riskAversion * skewFactor`
- **函数**: `calculateInventorySkew(midPrice, volatility, riskAversion)`
- **逻辑**: 保留GLFT模型最有价值的库存风险管理机制

#### 3.1.3. 库存调节报价
- **公式**:
  - `bid_depth = half_spread + skew * normalizedInventory`
  - `ask_depth = half_spread - skew * normalizedInventory`
- **函数**: `calculateInventoryAdjustedDepths(halfSpread, skew, normalizedInventory)`
- **逻辑**: 当有货时买单更远，空仓时卖单更远，自动平衡库存

### 3.2. 传统GLFT算法（备用模式）

#### 3.2.1. 常数计算 (Constants C1, C2)
- **公式**: 
  - `C₁ = f(γ, A, k)` - 由风险厌恶系数和订单流强度决定
  - `C₂ = g(γ, A, k)` - 由风险厌恶系数和订单流强度决定
- **函数**: `calculateConstants(gamma, orderFlowA, orderFlowK)`
- **逻辑**: 根据GLFT模型的理论公式计算常数，这些常数在策略运行期间保持不变。

#### 3.2.2. 传统半价差计算
- **公式**: `half_spread = C₁ + C₂ * σ²`
- **函数**: `calculateTraditionalHalfSpread(C1, C2, volatility)`
- **逻辑**: 计算基础的半价差，依赖于波动率的平方。

#### 3.2.3. 传统库存偏度计算
- **公式**: `skew = C₂ * σ`
- **函数**: `calculateTraditionalSkew(C2, volatility)`
- **逻辑**: 计算库存对报价的影响系数，依赖于波动率。

### 3.3. 通用功能模块

#### 3.3.1. 最终报价计算
- **公式**:
  - `bid_price = mid_price - bid_depth`
  - `ask_price = mid_price + ask_depth`
- **函数**: `calculateFinalQuotes(midPrice, bidDepth, askDepth)`

#### 3.3.2. 库存限制检查
- **逻辑**: 
  - 当 `q ≥ Q` 时，返回 `bidPrice = null`（停止下买单）
  - 当 `q ≤ -Q` 时，返回 `askPrice = null`（停止下卖单）
- **函数**: `checkInventoryLimits(normalizedInventory, maxInventoryQ)`

#### 3.3.3. 策略模式选择器
- **函数**: `selectStrategy(useTraditionalGLFT)`
- **逻辑**: 根据配置选择使用固定价差模式还是传统GLFT模式

#### 3.3.4. 主入口函数
- **函数**: `calculateOptimalQuotes(inputs)`
- **功能**: 整合所有计算步骤的主入口点
- **输出**: `{ bidPrice, askPrice, halfSpread, skew, inventoryLimited, strategyMode }`

## 4. 与其他模块的交互
- **依赖**: 无直接依赖。它是一个独立的计算库。
- **被依赖**:
  - `trader`: `Trader` 模块是 `GLFTStrategy` 的主要使用者。`Trader` 负责从各个服务（`MarketDataService`, `AccountService`）收集数据，然后将这些数据传递给 `GLFTStrategy` 的计算函数以获取理论报价。

- **数据流**: 
  1. `Trader` 收集 `midPrice`, `σ`, `q`, `γ`, `A`, `k`, `Q`。
  2. `Trader` 调用 `GLFTStrategy.calculateGLFTQuotes({ midPrice, σ, q, γ, A, k, Q })`。
  3. `GLFTStrategy` 返回 `{ bidPrice, askPrice, halfSpread, skew, inventoryLimited }`。
  4. `Trader` 接收到理论报价，然后进行精度调整和风险检查，最终决定是否下单。

## 5. 测试要点

### 5.1. 中低频模式单元测试
- **测试固定价差计算**: 验证 `calculateFixedHalfSpread` 函数的正确性
- **测试库存偏度计算**: 验证 `calculateInventorySkew` 函数在不同库存水平下的输出
- **测试库存调节报价**: 验证 `calculateInventoryAdjustedDepths` 函数的库存平衡逻辑
- **测试策略模式选择**: 验证 `selectStrategy` 函数正确切换策略模式
- **测试主入口函数**: 验证 `calculateOptimalQuotes` 函数的完整流程

### 5.2. 传统GLFT模式单元测试
- **测试常数计算**: 验证 `calculateConstants` 函数在不同参数下的输出
- **测试传统半价差**: 验证 `calculateTraditionalHalfSpread` 函数的正确性
- **测试传统偏度**: 验证 `calculateTraditionalSkew` 函数的正确性

### 5.3. 通用功能测试
- **测试库存限制**: 验证当库存达到极限时，相应的报价被正确地设为 `null`
- **测试最终报价**: 验证 `calculateFinalQuotes` 函数的计算逻辑

### 5.4. 中低频改造测试用例
- **固定价差测试**: 验证半价差始终为配置的固定百分比（如0.04%）
- **库存平衡测试**: 
  - 零库存时，买卖报价应该对称
  - 正库存时，买单更远，卖单更近，促进卖出
  - 负库存时，卖单更远，买单更近，促进买入
- **极限库存测试**: 当库存达到最大值时买单禁用，达到最小值时卖单禁用
- **策略切换测试**: 验证传统GLFT和固定价差模式的正确切换
- **宽价差盈利测试**: 验证在0.06%最小价差下的盈利能力
- **高波动率适应**: 当 `σ` 增加时，库存偏度应相应增加
- **边界条件**: 测试极端参数值的情况

## 6. 注意事项
- **保持纯粹**: 该模块应该只负责计算，不应包含任何I/O操作、状态管理或业务逻辑
- **命名清晰**: 函数和变量名应该清晰地反映其用途，例如 `calculateFixedHalfSpread` 而不是 `calc`
- **时间无关性**: GLFT模型的渐近解消除了时间依赖性，因此该模块不需要处理时间相关的计算
- **库存限制**: 确保库存限制逻辑的正确实现，这是风险管理的关键部分
- **策略模式兼容**: 确保两种策略模式（固定价差和传统GLFT）可以无缝切换
- **中低频特殊考虑**:
  - 固定价差模式下，半价差不再依赖波动率，简化了计算复杂度
  - 库存偏度仍然是核心价值，必须保持其库存风险管理功能
  - 宽价差设定（0.06%）为网络延迟和手续费提供了缓冲空间
  - 策略从"抢时间"转为"管库存"，重点关注库存平衡而非速度优势
- **性能优化**: 固定价差模式下可以预计算更多参数，减少实时计算负担