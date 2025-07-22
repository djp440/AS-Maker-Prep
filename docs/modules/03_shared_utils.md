# 模块开发指南: Shared - Utils

## 1. 核心职责
- 提供一系列通用的、可复用的辅助函数，以简化代码并避免重复。
- 包含与特定业务逻辑无关的纯函数。

## 2. 技术实现要点
- **组织**: 将所有函数导出为一个或多个工具对象，例如 `precisionUtils`, `timeUtils`。
- **纯函数**: 工具函数应尽可能设计为纯函数，即给定相同的输入，总是返回相同的输出，并且没有副作用。
- **测试**: 为关键的工具函数（特别是精度计算）编写单元测试。

## 3. 函数分类与定义

### 3.1. 精度处理工具 (`precisionUtils`)
- **背景**: 交易所对订单的价格和数量有严格的精度要求（`tickSize`, `stepSize`）。所有理论计算出的报价在下单前必须经过精度调整。
- **函数**:
  - `adjustPrice(price, tickSize)`
    - **功能**: 将价格调整到最接近的有效 `tickSize` 倍数。
    - **逻辑**: `Math.round(price / tickSize) * tickSize`。
  - `adjustQuantity(quantity, stepSize, minQty)`
    - **功能**: 将数量向下调整到最接近的有效 `stepSize` 倍数，并确保不小于 `minQty`。
    - **逻辑**: `Math.max(Math.floor(quantity / stepSize) * stepSize, minQty)`。
  - `checkMinNotional(price, quantity, minNotional)`
    - **功能**: 检查订单价值（价格 × 数量）是否满足最小名义价值要求。
    - **逻辑**: `(price * quantity) >= minNotional`。

### 3.2. 时间处理工具 (`timeUtils`)
- **库**: 依赖 `day.js`。
- **函数**:
  - `getTimestamp()`
    - **功能**: 获取当前的 Unix 时间戳（毫秒）。
  - `formatDate(timestamp)`
    - **功能**: 将时间戳格式化为 `YYYY-MM-DD HH:mm:ss` 格式。

### 3.3. 异步处理工具 (`asyncUtils`)
- **函数**:
  - `sleep(ms)`
    - **功能**: 异步等待指定的毫秒数。
    - **逻辑**: `new Promise(resolve => setTimeout(resolve, ms))`。

## 4. 与其他模块的交互
- **依赖**: `day.js`。
- **被依赖**: `trader`, `exchange_service`, `logger` 等多个模块。
  - `trader`: 在下单前使用 `precisionUtils` 调整价格和数量。
  - `exchange_service`: 在处理 API 错误重试时可能使用 `sleep`。
  - `logger`: 使用 `timeUtils` 格式化时间戳。

## 5. 注意事项
- **保持通用**: `utils.js` 中不应包含任何特定于某个交易所或某个策略的逻辑。
- **文档清晰**: 每个工具函数都应有清晰的 JSDoc 注释，说明其功能、参数和返回值。