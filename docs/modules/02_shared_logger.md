# 模块开发指南: Shared - Logger

## 1. 核心职责
- 提供一个统一、可配置的日志记录服务。
- 支持多种日志级别（如 info, warn, error, debug）。
- 支持将日志输出到控制台和文件。
- 确保日志格式标准化，便于问题排查和后续分析。

## 2. 技术实现要点
- **库**: 使用 `Winston` 作为核心日志库。
- **实例化**: 创建一个全局单例的 logger 实例，确保整个应用程序使用同一个 logger。
- **配置**: 允许通过配置文件或环境变量设置日志级别。
- **多目标输出 (Transports)**:
  - **控制台**: 用于开发环境，输出带颜色的、易于阅读的日志。
  - **文件**: 用于生产环境，将日志记录到文件中，并支持日志轮转（按大小或日期）。

## 3. 日志格式
- **标准化格式**: 每条日志应包含以下关键信息：
  - `timestamp`: 时间戳 (使用 `day.js` 格式化)。
  - `level`: 日志级别 (e.g., `info`, `error`)。
  - `message`: 日志消息主体。
  - `[context]`: 可选的上下文标识，例如模块名或交易对 (`strategy`, `trader`, `BTC/USDT:USDT`)。
  - `metadata`: 可选的结构化数据对象，用于记录详细信息（如 API 响应、错误堆栈）。

- **示例格式**:
  ```
  [YYYY-MM-DD HH:mm:ss] [INFO] [Strategy:BTC/USDT:USDT] New optimal prices calculated: { bid: 50000, ask: 50025 }
  [YYYY-MM-DD HH:mm:ss] [ERROR] [ExchangeService] API call failed: { error: 'Invalid API Key', endpoint: '/v1/order' }
  ```

## 4. 日志级别定义
- **error**: 严重错误，导致程序功能异常或需要立即关注（如 API 认证失败、程序崩溃）。
- **warn**: 警告信息，表示潜在问题，但程序仍可继续运行（如 API 请求超时重试、库存接近阈值）。
- **info**: 普通信息，记录关键业务流程和状态变化（如订单创建成功、连接建立、配置加载）。
- **debug**: 调试信息，仅在开发或问题排查时开启，记录详细的技术细节（如 API 请求/响应全文、详细的计算过程）。

## 5. 文件日志与轮转
- **库**: 使用 `winston-daily-rotate-file` 实现日志轮转。
- **配置**:
  - `filename`: 日志文件名前缀，如 `app-%DATE%.log`。
  - `datePattern`: 日期格式，如 `YYYY-MM-DD`。
  - `zippedArchive`: 是否压缩旧日志。
  - `maxSize`: 单个日志文件最大尺寸，如 `20m`。
  - `maxFiles`: 最多保留日志文件数，如 `14d` (保留14天)。
- **分离**: 错误日志应单独记录到 `error-%DATE%.log` 文件中，便于快速定位问题。

## 6. 与其他模块的交互
- **依赖**: `day.js` (用于时间戳格式化)。
- **被依赖**: 所有需要记录日志的模块。
- **使用方式**: 其他模块通过 `import logger from './shared/logger'` 引入并使用。
  ```javascript
  import logger from './shared/logger';

  logger.info('Service started.');
  logger.warn('Connection is unstable.', { latency: 300 });
  logger.error('Failed to place order.', { symbol: 'BTC/USDT:USDT', error: new Error('Insufficient balance') });
  ```

## 7. 注意事项
- **日志脱敏**: 绝对不能在日志中记录 `API_KEY`, `API_SECRET` 等敏感信息。
- **性能影响**: 避免在高性能循环中记录大量 `debug` 级别的日志。生产环境的日志级别应设置为 `info` 或 `warn`。
- **上下文信息**: 鼓励在日志中加入上下文信息（如交易对、模块名），这对于在多交易对并发运行时排查问题至关重要。