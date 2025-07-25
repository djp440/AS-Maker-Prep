# Main.js 使用指南

## 概述

`main.js` 是 GLFT 做市策略程序的主入口文件，负责整个应用程序的启动、运行和关闭流程。

## 功能特性

### 核心功能
- ✅ **程序启动流程** - 完整的应用程序初始化和启动
- ✅ **服务管理** - 统一管理所有核心服务的生命周期
- ✅ **多交易对支持** - 为每个配置的交易对创建独立的 Trader 实例
- ✅ **异常处理** - 全局异常捕获和处理机制
- ✅ **优雅退出** - 安全的资源清理和程序关闭
- ✅ **状态监控** - 实时获取应用程序和交易实例状态

### 启动流程

1. **配置加载** - 加载 `config.json` 和 `.env` 文件
2. **服务初始化** - 初始化交易所、WebSocket、市场数据和账户服务
3. **启动前准备** - 加载市场信息、建立连接、同步账户数据
4. **交易对启动** - 为每个交易对创建并启动 Trader 实例
5. **异常处理设置** - 配置全局异常处理和优雅退出机制

## 使用方法

### 1. 直接启动

```bash
# 使用 npm 脚本启动
npm start

# 或直接使用 node
node src/main.js
```

### 2. 测试功能

```bash
# 运行单元测试
npm run test:main

# 运行集成测试
npm run test:main:integration

# 运行启动流程测试
npm run test:main:startup
```

### 3. 编程方式使用

```javascript
const MainApplication = require('./src/main');

// 创建应用实例
const app = new MainApplication();

// 启动应用
app.start().catch(error => {
    console.error('启动失败:', error);
    process.exit(1);
});

// 获取运行状态
const status = app.getStatus();
console.log('应用状态:', status);

// 优雅关闭
process.on('SIGINT', async () => {
    await app.shutdown(0);
});
```

## 配置要求

### 环境变量 (.env)

```env
# 交易模式
PAPER_TRADING=true

# API 凭据
BITGET_API_KEY=your_api_key
BITGET_API_SECRET=your_api_secret
BITGET_API_PASSPHRASE=your_passphrase
```

### 配置文件 (config.json)

```json
{
  "exchange": "bitget",
  "symbols": [
    {
      "SYMBOL": "BTC/USDT:USDT",
      "LEVERAGE": 10,
      "RISK_AVERSION": 0.5,
      "ORDER_FLOW": 0.3,
      "MAX_INVENTORY": 1000,
      "ORDER_AMOUNT": 100,
      "VOLATILITY_LOOKBACK": 20,
      "KLINE_INTERVAL": "1m",
      "TRADE_DIRECTION": "both",
      "MIN_SPREAD_PCT": 0.01,
      "HALF_SPREAD_PCT": 0.005,
      "REBALANCE_INTERVAL": 5000,
      "PRICE_CHANGE_THRESHOLD": 0.001,
      "USE_TRADITIONAL_GLFT": false
    }
  ]
}
```

## 状态监控

### 获取应用状态

```javascript
const status = app.getStatus();

// 状态结构
{
  "isRunning": true,
  "tradersCount": 2,
  "traders": {
    "BTC/USDT:USDT": { "status": "running" },
    "ETH/USDT:USDT": { "status": "running" }
  },
  "services": {
    "exchange": true,
    "websocket": true,
    "marketData": true,
    "account": true
  }
}
```

## 异常处理

### 全局异常捕获

- **未捕获异常** (`uncaughtException`) - 自动触发优雅关闭
- **未处理的 Promise 拒绝** (`unhandledRejection`) - 记录错误并关闭
- **系统信号** (`SIGINT`, `SIGTERM`) - 优雅退出处理

### 优雅关闭流程

1. 停止所有 Trader 实例
2. 关闭 WebSocket 连接
3. 清理资源和定时器
4. 等待日志写入完成
5. 退出进程

## 日志输出

程序运行时会输出详细的日志信息：

```
🚀 GLFT做市程序启动中...
📋 加载配置文件...
✅ 配置加载成功 - 交易所: bitget, 交易对数量: 2
🔧 初始化核心服务...
✅ 交易所服务初始化完成
✅ WebSocket管理器初始化完成
✅ 市场数据服务初始化完成
✅ 账户服务初始化完成
🔄 执行启动前准备...
✅ 市场信息加载完成
✅ WebSocket连接已建立
✅ 账户同步完成
🎯 启动交易对实例...
✅ BTC/USDT:USDT Trader启动成功
✅ ETH/USDT:USDT Trader启动成功
✅ 所有交易对启动完成，共 2 个
✅ GLFT做市程序启动完成
📊 当前运行交易对数量: 2
```

## 故障排除

### 常见问题

1. **配置加载失败**
   - 检查 `config.json` 和 `.env` 文件是否存在
   - 验证 JSON 格式是否正确
   - 确认 API 凭据是否有效

2. **服务初始化失败**
   - 检查网络连接
   - 验证 API 权限
   - 查看详细错误日志

3. **WebSocket 连接问题**
   - 确认防火墙设置
   - 检查代理配置
   - 验证交易所服务状态

4. **Trader 启动失败**
   - 检查交易对配置
   - 验证杠杆设置
   - 确认账户余额充足

### 调试模式

```bash
# 设置调试级别
export LOG_LEVEL=debug
npm start
```

## 性能优化

### 资源管理

- **内存使用** - 定期清理缓存数据
- **连接池** - 复用 WebSocket 连接
- **定时器管理** - 及时清理无用定时器

### 监控指标

- **连接状态** - WebSocket 连接健康度
- **数据延迟** - 市场数据接收延迟
- **错误率** - 异常和错误统计
- **内存使用** - 进程内存占用

## 扩展开发

### 添加新服务

1. 在 `initializeServices()` 中添加服务初始化
2. 在 `shutdown()` 中添加清理逻辑
3. 在 `getStatus()` 中添加状态检查

### 自定义启动流程

```javascript
class CustomMainApplication extends MainApplication {
    async customInitialization() {
        // 自定义初始化逻辑
    }
    
    async start() {
        await super.start();
        await this.customInitialization();
    }
}
```

## 版本历史

- **v1.0.0** - 初始版本，实现基本启动流程
- **v1.1.0** - 添加异常处理和优雅退出
- **v1.2.0** - 增强状态监控和日志输出

## 相关文档

- [开发文档](./开发文档.md)
- [模块设计](./modules/11_main.md)
- [API 参考](./API.md)
- [故障排除](./TROUBLESHOOTING.md)