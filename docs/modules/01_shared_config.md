# 模块开发指南: Shared - Config

## 1. 核心职责
- 加载、解析并验证 `config.json` 和 `.env` 文件中的配置信息。
- 提供一个全局单例或可注入的服务，供其他模块访问配置参数。

## 2. 技术实现要点
- **库**: 使用 `dotenv` 库加载 `.env` 文件。
- **文件读取**: 使用 Node.js 内置的 `fs` 模块异步读取 `config.json`。
- **结构**: 创建一个 `Config` 类或对象，在启动时加载所有配置。
- **访问接口**: 提供清晰的 getter 方法，例如 `getApiKey()`, `getSymbols()`, `getStrategyParams(symbol)`。
- **缓存**: 配置加载后应缓存在内存中，避免重复读取文件。

## 3. 配置参数来源与处理

### 3.1. 私密参数 (`.env`)
- **来源**: `.env` 文件。
- **参数**:
  - `API_KEY`: 实盘API Key
  - `API_SECRET`: 实盘API Secret
  - `API_PASSWORD`: 实盘API Passphrase
  - `PAPER_TRADING`: 是否启用模拟盘 (e.g., `true`)
  - `PAPER_API_KEY`: 模拟盘API Key
  - `PAPER_API_SECRET`: 模拟盘API Secret
  - `PAPER_API_PASSWORD`: 模拟盘API Passphrase
- **处理**:
  - 使用 `dotenv.config()` 加载到 `process.env`。
  - 模块应从 `process.env` 读取这些值。
  - **安全**: 确保 `.env` 文件在 `.gitignore` 中。

### 3.2. 策略参数 (`config.json`)
- **来源**: `config.json` 文件。
- **结构**:
  ```json
  {
    "EXCHANGE": "bitget",
    "SYMBOLS": [
      {
        "SYMBOL": "BTC/USDT:USDT",
        "RISK_AVERSION": 1,
        "BASE_SPREAD": 0.001,
        "ORDER_AMOUNT": 0.01,
        "MAX_INVENTORY": 0.2,
        "VOLATILITY_LOOKBACK": 14,
        "KLINE_INTERVAL": "15m",
        "LEVERAGE": 2,
        "TRADE_SIDE": "both"
      }
    ]
  }
  ```
- **处理**:
  - 读取文件内容并使用 `JSON.parse()` 解析。
  - 提供一个方法，可以根据交易对 `SYMBOL` 字符串获取其特定配置。

## 4. 启动验证
- **必要性检查**:
  - 启动时必须检查所有必需的参数是否存在且格式正确。
  - `API_KEY`, `API_SECRET` 不能为空。
  - `SYMBOLS` 数组不能为空。
- **格式验证**:
  - `RISK_AVERSION`, `BASE_SPREAD` 等数值参数应为数字类型。
  - `TRADE_SIDE` 必须是 `long`, `short`, 或 `both` 之一。
- **错误处理**: 如果验证失败，程序应立即抛出错误并退出，同时在日志中记录详细的错误信息。

## 5. 与其他模块的交互
- **依赖**: 无。
- **被依赖**: 几乎所有其他模块都会依赖此配置模块来获取必要的参数。
  - `exchange_service`: 需要API密钥。
  - `strategy`: 需要策略参数。
  - `trader`: 需要订单金额、杠杆等参数。
  - `main`: 需要交易所和交易对列表。

## 6. 注意事项
- **不可变性**: 配置一旦加载，在程序运行时应视为不可变的，以避免状态混乱。
- **热重载**: 本项目当前版本不要求支持配置热重载。