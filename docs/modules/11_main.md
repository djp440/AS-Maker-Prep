# 模块开发指南: main.js (程序入口) - GLFT模型

## 1. 核心职责
- 作为GLFT做市应用程序的启动入口。
- 初始化所有核心服务和模块，包括GLFT策略模块。
- 根据配置文件，为每个指定的交易对创建并启动一个独立的 `Trader` 实例。
- 处理顶层的异常捕获和程序的优雅退出。
- 确保GLFT模型的24/7连续运行稳定性。

## 2. 启动流程 (Step-by-Step)

1.  **加载配置**: 
    - 首先，初始化 `Config` 模块，加载 `.env` 和 `config.json` 的内容。
    - 进行配置验证，如果关键配置缺失或无效，则记录错误并立即退出程序。

2.  **初始化日志**: 
    - 初始化 `Logger` 模块，后续所有模块都将使用这个日志实例。

3.  **初始化核心服务 (单例)**: 
    - 创建 `ExchangeService` 的单例实例。
    - 创建 `WebSocketManager` 的单例实例。
    - 创建 `MarketDataService` 的单例实例。
    - 创建 `AccountService` 的单例实例。

4.  **启动前准备**: 
    - 调用 `ExchangeService.loadMarkets()` 来加载交易所的市场信息（精度、限制等）。
    - 启动 `WebSocketManager` 的连接。
    - 调用 `AccountService` 进行一次初始的状态同步（获取余额、持仓）。

5.  **创建并启动交易对实例**: 
    - 从 `Config` 获取 `SYMBOLS` 数组。
    - **遍历 `SYMBOLS` 数组**，为每个交易对配置执行以下操作：
        a.  **设置杠杆**: 调用 `ExchangeService.setLeverage()` 为该交易对设置配置的杠杆倍数。
        b.  **创建 Trader**: 创建一个新的 `Trader` 实例，并将所有需要的服务实例和该交易对的特定配置注入其构造函数。
        c.  **启动 Trader**: 调用该 `Trader` 实例的 `start()` 方法，启动其内部的做市主循环。
        d.  **日志记录**: 记录一条日志，表明该交易对的 `Trader` 已成功启动。

6.  **全局异常处理**: 
    - 注册 `process.on('uncaughtException', ...)` 和 `process.on('unhandledRejection', ...)` 事件监听器。
    - 当捕获到未处理的异常时，使用 `Logger` 记录致命错误，并尝试优雅地关闭应用程序（例如，取消所有挂单），然后退出。

## 3. 多交易对处理
- **核心理念**: **隔离**。每个 `Trader` 实例都应该独立运行，拥有自己的状态和做市循环。一个交易对的失败不应该直接影响到其他交易对的运行。
- **资源共享**: 所有 `Trader` 实例共享同一个 `ExchangeService`, `WebSocketManager`, `AccountService` 等服务实例，以有效管理API连接和共享账户状态。

## 4. 优雅退出 (Graceful Shutdown)
- 监听 `SIGINT` (Ctrl+C) 和 `SIGTERM` 信号。
- 当接收到退出信号时，执行以下操作：
  1. 记录一条“正在关闭程序”的日志。
  2. 指示所有 `Trader` 实例停止新的报价，并取消所有在市场上的挂单。
  3. 关闭 `WebSocketManager` 的连接。
  4. 等待所有操作完成后，调用 `process.exit()`。

## 5. 与其他模块的交互
- `main.js` 是所有模块的“总指挥”。它负责实例化和协调所有其他模块。
- 它不包含任何具体的业务逻辑，只负责组装和启动。

## 6. 最终项目结构概览 (GLFT模型)
```
/AS-Maker-Prep
├── /src
│   ├── /core
│   │   ├── glft_strategy.js
│   │   └── trader.js
│   ├── /services
│   │   ├── exchange_service.js
│   │   ├── websocket_manager.js
│   │   ├── market_data_service.js
│   │   └── account_service.js
│   ├── /monitoring
│   │   └── ... (health_checker.js, etc.)
│   ├── /shared
│   │   ├── config.js
│   │   ├── logger.js
│   │   └── utils.js
│   └── main.js
├── .env
└── config.json
```