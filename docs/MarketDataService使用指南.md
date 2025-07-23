# MarketDataService 使用指南

## 概述

`MarketDataService` 是一个为策略模块提供统一、实时市场数据接口的服务类。它整合了来自 WebSocket 的实时数据和来自 REST API 的历史数据，计算并缓存策略所需的衍生数据，如市场中间价和波动率。

## 主要功能

### 1. 实时数据处理
- 监听 `WebSocketManager` 的 `ticker` 和 `orderbook` 事件
- 实时计算并缓存市场中间价
- 计算价差和价差百分比
- 数据验证和异常检测

### 2. 波动率计算
- 通过 `ExchangeService` 定期获取K线数据
- 使用对数收益率计算波动率
- 支持可配置的回看周期
- 定期更新波动率数据

### 3. 数据验证
- 价差异常检测
- 价格数据合理性验证
- 买卖价顺序检查
- 实时警报机制

## 快速开始

### 1. 初始化服务

```javascript
const MarketDataService = require('./src/services/market_data_service');
const Config = require('./src/shared/config');

// 获取单例实例
const marketDataService = MarketDataService.getInstance();

// 初始化服务
await marketDataService.initialize(Config);
```

### 2. 设置事件监听

```javascript
// 监听中间价更新
marketDataService.on('midPriceUpdate', (data) => {
    console.log(`${data.symbol} 中间价: ${data.midPrice}`);
    console.log(`价差: ${data.spreadPct.toFixed(4)}%`);
});

// 监听波动率更新
marketDataService.on('volatilityUpdate', (data) => {
    console.log(`${data.symbol} 波动率: ${(data.volatility * 100).toFixed(4)}%`);
});

// 监听数据验证警告
marketDataService.on('dataValidationWarning', (data) => {
    console.warn(`数据异常: ${data.symbol} - ${data.message}`);
});
```

### 3. 获取市场数据

```javascript
const symbol = 'BTC/USDT:USDT';

// 获取中间价
const midPrice = marketDataService.getMidPrice(symbol);
console.log(`中间价: ${midPrice}`);

// 获取波动率
const volatility = marketDataService.getVolatility(symbol);
console.log(`波动率: ${(volatility * 100).toFixed(4)}%`);

// 获取完整市场数据
const marketData = marketDataService.getMarketData(symbol);
console.log('完整市场数据:', marketData);
```

## API 参考

### 核心方法

#### `initialize(config)`
初始化市场数据服务
- **参数**: `config` - 配置对象
- **返回**: `Promise<void>`

#### `getMidPrice(symbol)`
获取交易对的实时中间价
- **参数**: `symbol` - 交易对符号
- **返回**: `number|null` - 中间价

#### `getVolatility(symbol)`
获取交易对的波动率
- **参数**: `symbol` - 交易对符号
- **返回**: `number|null` - 波动率

#### `getMarketData(symbol)`
获取交易对的完整市场数据
- **参数**: `symbol` - 交易对符号
- **返回**: `object|null` - 市场数据对象

#### `getAllMarketData()`
获取所有交易对的市场数据
- **返回**: `Map<string, object>` - 所有市场数据

#### `cleanup()`
清理资源和定时器
- **返回**: `void`

### 事件

#### `midPriceUpdate`
中间价更新事件
```javascript
{
    symbol: 'BTC/USDT:USDT',
    midPrice: 50000,
    bestBid: 49950,
    bestAsk: 50050,
    spread: 100,
    spreadPct: 0.2
}
```

#### `volatilityUpdate`
波动率更新事件
```javascript
{
    symbol: 'BTC/USDT:USDT',
    volatility: 0.025
}
```

#### `dataValidationWarning`
数据验证警告事件
```javascript
{
    symbol: 'BTC/USDT:USDT',
    type: 'spread', // 'spread', 'price', 'order'
    value: 5.2,
    message: '价差异常扩大'
}
```

## 配置说明

在 `config.json` 中为每个交易对配置以下参数：

```json
{
    "SYMBOL": "BTC/USDT:USDT",
    "VOLATILITY_LOOKBACK": 14,  // 波动率计算回看周期
    "KLINE_INTERVAL": "15m"     // K线时间间隔
}
```

## 数据结构

### MarketData 对象

```javascript
{
    symbol: 'BTC/USDT:USDT',           // 交易对符号
    midPrice: 50000,                   // 中间价
    bestBid: 49950,                    // 最佳买价
    bestAsk: 50050,                    // 最佳卖价
    spread: 100,                       // 价差
    spreadPct: 0.2,                    // 价差百分比
    volatility: 0.025,                 // 波动率
    lastTickerUpdate: 1640995200000,   // 最后ticker更新时间
    lastOrderbookUpdate: 1640995200000, // 最后orderbook更新时间
    lastVolatilityUpdate: 1640995200000, // 最后波动率更新时间
    config: { ... }                    // 交易对配置
}
```

## 测试

### 运行单元测试

```bash
npm test src/services/__tests__/market_data_service.test.js
```

### 运行功能测试

```bash
node test_market_data_service.js
```

## 注意事项

1. **单例模式**: `MarketDataService` 使用单例模式，确保全局只有一个实例
2. **数据隔离**: 每个交易对的数据严格隔离，不会相互影响
3. **错误处理**: 服务包含完善的错误处理和日志记录
4. **资源管理**: 使用完毕后应调用 `cleanup()` 方法清理资源
5. **依赖关系**: 需要先初始化 `WebSocketManager` 和 `ExchangeService`

## 故障排除

### 常见问题

1. **获取不到数据**
   - 检查 WebSocket 连接是否正常
   - 确认交易对符号格式正确
   - 查看日志中的错误信息

2. **波动率为 null**
   - 检查 K线数据是否足够
   - 确认 `VOLATILITY_LOOKBACK` 配置合理
   - 查看网络连接和API限制

3. **数据验证警告**
   - 检查市场是否异常波动
   - 确认数据源的可靠性
   - 调整验证阈值（如需要）

### 调试技巧

1. 启用详细日志记录
2. 监听所有事件以了解数据流
3. 使用测试文件验证功能
4. 检查配置文件的正确性

## 扩展开发

如需扩展 `MarketDataService` 的功能，可以考虑：

1. 添加更多技术指标计算
2. 实现数据持久化
3. 添加更多数据验证规则
4. 支持更多数据源
5. 实现数据缓存优化

---

更多详细信息请参考源代码注释和相关文档。