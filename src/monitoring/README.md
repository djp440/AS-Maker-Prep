# 监控系统 (Monitoring System)

## 概述

本监控系统为AS-Maker-Prep项目提供全面的连接状态监控和指标收集功能，包括：

- **连接监控** (Connection Monitor): 监控WebSocket连接状态、API可用性、数据流延迟等
- **告警管理** (Alert Manager): 处理系统告警、风险提醒和通知发送
- **指标收集** (Metrics Collector): 收集交易、性能和GLFT特有指标

## 功能特性

### 🔍 连接状态监控
- WebSocket连接健康检查
- API可用性检测
- 数据接收延迟监控
- 连接质量评估
- 自动重连计数

### 📊 指标收集
- **交易指标**: 交易量、成交价格、手续费、订单执行时间
- **性能指标**: API响应时间、系统错误率、连接质量
- **GLFT特有指标**: 半价差、偏度、库存利用率、报价时间

### 🚨 告警管理
- 多级别告警 (INFO/WARNING/ERROR/CRITICAL)
- 频率限制防止告警轰炸
- 连接、交易、系统三类告警
- 告警历史和统计

## 快速开始

### 1. 基本使用

```javascript
const MonitoringSystem = require('./src/monitoring');
const WebSocketManager = require('./src/services/websocket_manager');
const ExchangeService = require('./src/services/exchange_service');

// 初始化监控系统
async function initializeMonitoring() {
    const services = {
        websocketManager: WebSocketManager,
        exchangeService: ExchangeService
    };
    
    const config = {
        connectionMonitor: {
            healthCheckInterval: 30000,    // 30秒健康检查
            apiCheckInterval: 300000,      // 5分钟API检查
            dataLatencyThreshold: 5000     // 5秒延迟阈值
        },
        alertManager: {
            thresholds: {
                reconnectCount: 5,         // 重连次数阈值
                errorRate: 10,             // 错误率阈值(%)
                dataLatency: 5000,         // 数据延迟阈值(ms)
                inventoryUtilization: 0.8  // 库存利用率阈值
            }
        }
    };
    
    await MonitoringSystem.initialize(services, config);
    console.log('监控系统初始化完成');
}
```

### 2. 记录指标

```javascript
// 记录交易指标
MonitoringSystem.recordTrade({
    side: 'buy',
    amount: 100,
    price: 50000,
    fee: 0.1,
    timestamp: Date.now()
});

// 记录API调用指标
MonitoringSystem.recordApiCall({
    method: 'GET',
    endpoint: '/api/v1/ticker',
    success: true,
    responseTime: 150,
    timestamp: Date.now()
});

// 记录GLFT特有指标
MonitoringSystem.recordHalfSpread(0.0025);
MonitoringSystem.recordSkew(0.15);
MonitoringSystem.recordInventory({
    currentInventory: 1500,
    maxInventory: 2000,
    utilization: 0.75,
    limitTriggered: false
});
```

### 3. 发送告警

```javascript
// 发送基本告警
MonitoringSystem.sendAlert('WARNING', '价格异常', '检测到价格波动超过阈值', {
    currentPrice: 51000,
    threshold: 50000
});

// 发送连接告警
MonitoringSystem.sendConnectionAlert('websocket_disconnected', {
    reconnectCount: 3
});

// 发送交易告警
MonitoringSystem.sendTradingAlert('inventory_utilization_high', {
    utilization: 0.95,
    currentInventory: 1900
});
```

### 4. 获取监控数据

```javascript
// 获取系统健康状态
const healthStatus = MonitoringSystem.getHealthStatus();
console.log('系统健康状态:', healthStatus);

// 获取当前指标
const currentMetrics = MonitoringSystem.getCurrentMetrics();
console.log('当前指标:', currentMetrics);

// 获取告警历史
const alertHistory = MonitoringSystem.getAlertHistory({
    level: 'ERROR',
    limit: 10
});
console.log('错误告警历史:', alertHistory);

// 生成监控报告
const report = MonitoringSystem.generateReport('summary');
console.log('监控报告:', report);
```

## 配置选项

### 连接监控配置

```javascript
connectionMonitor: {
    healthCheckInterval: 30000,        // 健康检查间隔(ms)
    apiCheckInterval: 300000,          // API检查间隔(ms)
    metricsReportInterval: 3600000,    // 指标报告间隔(ms)
    dataLatencyThreshold: 5000         // 数据延迟阈值(ms)
}
```

### 告警管理配置

```javascript
alertManager: {
    thresholds: {
        reconnectCount: 5,             // 重连次数阈值
        errorRate: 10,                 // 错误率阈值(%)
        dataLatency: 5000,             // 数据延迟阈值(ms)
        apiFailureCount: 3,            // API失败次数阈值
        inventoryUtilization: 0.8      // 库存利用率阈值
    },
    rateLimits: {
        INFO: 60000,                   // INFO级别告警频率限制(ms)
        WARNING: 300000,               // WARNING级别告警频率限制(ms)
        ERROR: 600000,                 // ERROR级别告警频率限制(ms)
        CRITICAL: 0                    // CRITICAL级别无频率限制
    }
}
```

### 指标收集配置

```javascript
metricsCollector: {
    reportIntervals: {
        realtime: 60000,               // 实时报告间隔(ms)
        summary: 3600000,              // 摘要报告间隔(ms)
        daily: 86400000                // 日报告间隔(ms)
    },
    historyLimits: {
        tradeHistory: 100,             // 交易历史记录数量
        apiResponseTimes: 50,          // API响应时间历史数量
        halfSpreadHistory: 100,        // 半价差历史数量
        skewHistory: 100,              // 偏度历史数量
        inventoryHistory: 200,         // 库存历史数量
        dataLatencyHistory: 50         // 数据延迟历史数量
    }
}
```

## API 参考

### 主要方法

#### 初始化和配置
- `initialize(services, config)` - 初始化监控系统
- `updateConfig(newConfig)` - 更新配置
- `stop()` - 停止监控系统
- `destroy()` - 销毁监控系统

#### 指标记录
- `recordTrade(tradeData)` - 记录交易指标
- `recordApiCall(apiData)` - 记录API调用指标
- `recordOrderExecution(orderData)` - 记录订单执行指标
- `recordHalfSpread(halfSpread)` - 记录半价差指标
- `recordSkew(skew)` - 记录偏度指标
- `recordInventory(inventoryData)` - 记录库存指标
- `recordQuoting(quotingTime)` - 记录报价指标

#### 告警发送
- `sendAlert(level, title, message, metadata)` - 发送基本告警
- `sendConnectionAlert(type, data)` - 发送连接告警
- `sendTradingAlert(type, data)` - 发送交易告警
- `sendSystemAlert(type, data)` - 发送系统告警

#### 数据获取
- `getHealthStatus()` - 获取系统健康状态
- `getConnectionMetrics()` - 获取连接指标
- `getCurrentMetrics()` - 获取当前指标
- `getMetricsSummary()` - 获取指标摘要
- `getAlertHistory(filters)` - 获取告警历史
- `getAlertStats()` - 获取告警统计
- `generateReport(type)` - 生成监控报告

#### 工具方法
- `isSystemHealthy()` - 检查系统是否健康
- `getComponent(componentName)` - 获取组件实例
- `resetMetrics(categories)` - 重置指标

## 事件系统

监控系统使用事件驱动架构，各组件间通过事件进行通信：

### 连接监控事件
- `healthIssue` - 健康问题检测
- `criticalError` - 严重错误
- `apiUnavailable` - API不可用
- `connectionStatusChanged` - 连接状态变化

### 指标收集事件
- `tradeRecorded` - 交易记录
- `inventoryRecorded` - 库存记录
- `halfSpreadRecorded` - 半价差记录
- `apiCallRecorded` - API调用记录

### 告警管理事件
- `alert` - 告警触发

## 集成示例

### 在交易策略中集成

```javascript
const MonitoringSystem = require('./src/monitoring');

class TradingStrategy {
    async executeTrade(side, amount, price) {
        const startTime = Date.now();
        
        try {
            // 执行交易
            const result = await this.exchange.createOrder(side, amount, price);
            
            // 记录成功交易
            MonitoringSystem.recordTrade({
                side,
                amount,
                price,
                fee: result.fee,
                executionTime: Date.now() - startTime,
                timestamp: Date.now()
            });
            
            return result;
            
        } catch (error) {
            // 记录交易失败
            MonitoringSystem.sendTradingAlert('order_execution_failed', {
                side,
                amount,
                price,
                error: error.message
            });
            
            throw error;
        }
    }
}
```

### 在WebSocket管理器中集成

```javascript
class WebSocketManager extends EventEmitter {
    onMessage(data) {
        // 记录数据接收
        MonitoringSystem.recordDataLatency(Date.now() - data.timestamp);
        
        // 处理消息
        this.processMessage(data);
    }
    
    onError(error) {
        // 发送连接告警
        MonitoringSystem.sendConnectionAlert('websocket_error', {
            error: error.message,
            reconnectCount: this.reconnectCount
        });
    }
}
```

## 测试

运行监控系统测试：

```bash
node src/monitoring/test_monitoring.js
```

测试包括：
- 系统初始化测试
- 连接监控功能测试
- 指标收集功能测试
- 告警管理功能测试
- 系统集成测试
- 报告生成测试
- 实际使用场景模拟

## 注意事项

1. **性能考虑**: 监控系统设计为轻量级，但频繁的指标记录可能影响性能
2. **内存管理**: 历史数据有限制，超出限制会自动清理旧数据
3. **告警频率**: 设置了告警频率限制，避免告警轰炸
4. **错误处理**: 监控系统本身的错误不会影响主业务逻辑
5. **配置灵活性**: 所有阈值和间隔都可以通过配置调整

## 故障排除

### 常见问题

1. **监控系统初始化失败**
   - 检查服务依赖是否正确传入
   - 确认配置格式正确

2. **指标记录不生效**
   - 确认监控系统已正确初始化
   - 检查传入的数据格式

3. **告警不触发**
   - 检查告警阈值配置
   - 确认告警频率限制设置

4. **性能问题**
   - 调整指标收集间隔
   - 减少历史数据保留数量

### 调试模式

启用详细日志：

```javascript
const Logger = require('./src/shared/logger');
Logger.setLevel('DEBUG');
```

## 更新日志

### v1.0.0
- 初始版本发布
- 实现连接状态监控
- 实现指标收集功能
- 实现告警管理系统
- 提供完整的API接口
- 包含测试套件和使用示例