/**
 * @file integration_example.js
 * @description 监控系统集成示例
 * 展示如何在AS-Maker-Prep项目中集成和使用监控系统
 */

const MonitoringSystem = require('./index');
const Logger = require('../shared/logger');

/**
 * @class MonitoringIntegration
 * @description 监控系统集成示例类
 * 展示在实际应用中如何使用监控功能
 */
class MonitoringIntegration {
    constructor() {
        this.initialized = false;
        this.services = null;
    }

    /**
     * @description 初始化监控集成
     * @param {Object} services - 应用服务
     * @param {Object} services.websocketManager - WebSocket管理器
     * @param {Object} services.exchangeService - 交换服务
     * @param {Object} services.tradingEngine - 交易引擎
     */
    async initialize(services) {
        try {
            this.services = services;
            
            // 配置监控系统
            const monitoringConfig = {
                connectionMonitor: {
                    healthCheckInterval: 30000,     // 30秒健康检查
                    apiCheckInterval: 300000,       // 5分钟API检查
                    metricsReportInterval: 3600000, // 1小时指标报告
                    dataLatencyThreshold: 5000      // 5秒数据延迟阈值
                },
                alertManager: {
                    thresholds: {
                        reconnectCount: 5,           // 重连5次后告警
                        errorRate: 10,               // 错误率超过10%告警
                        dataLatency: 5000,           // 数据延迟超过5秒告警
                        apiFailureCount: 3,          // API失败3次后告警
                        inventoryUtilization: 0.8    // 库存利用率超过80%告警
                    },
                    rateLimits: {
                        INFO: 60000,                 // INFO级别1分钟限制
                        WARNING: 300000,             // WARNING级别5分钟限制
                        ERROR: 600000,               // ERROR级别10分钟限制
                        CRITICAL: 0                  // CRITICAL级别无限制
                    }
                },
                metricsCollector: {
                    reportIntervals: {
                        realtime: 60000,             // 1分钟实时报告
                        summary: 3600000,            // 1小时摘要报告
                        daily: 86400000              // 24小时日报告
                    },
                    historyLimits: {
                        tradeHistory: 200,           // 保留200条交易记录
                        apiResponseTimes: 100,       // 保留100次API响应时间
                        halfSpreadHistory: 200,      // 保留200个半价差记录
                        skewHistory: 200,            // 保留200个偏度记录
                        inventoryHistory: 500,       // 保留500个库存记录
                        dataLatencyHistory: 100      // 保留100个延迟记录
                    }
                }
            };
            
            // 初始化监控系统
            await MonitoringSystem.initialize(services, monitoringConfig);
            
            // 设置应用级事件监听
            this.setupApplicationEventListeners();
            
            // 启动定期报告
            this.startPeriodicReporting();
            
            this.initialized = true;
            Logger.info('[MonitoringIntegration] 监控系统集成完成');
            
        } catch (error) {
            Logger.error('[MonitoringIntegration] 监控系统集成失败:', error);
            throw error;
        }
    }

    /**
     * @description 设置应用级事件监听
     * @private
     */
    setupApplicationEventListeners() {
        const { websocketManager, exchangeService, tradingEngine } = this.services;
        
        // WebSocket事件监听
        if (websocketManager) {
            websocketManager.on('connected', () => {
                Logger.info('[MonitoringIntegration] WebSocket连接建立');
            });
            
            websocketManager.on('disconnected', () => {
                MonitoringSystem.sendConnectionAlert('websocket_disconnected', {
                    timestamp: Date.now()
                });
            });
            
            websocketManager.on('error', (error) => {
                MonitoringSystem.sendConnectionAlert('websocket_error', {
                    error: error.message,
                    timestamp: Date.now()
                });
            });
            
            websocketManager.on('message', (data) => {
                // 记录数据接收延迟
                if (data.timestamp) {
                    const latency = Date.now() - data.timestamp;
                    if (latency > 1000) { // 只记录超过1秒的延迟
                        MonitoringSystem.recordDataLatency(latency);
                    }
                }
            });
        }
        
        // 交易引擎事件监听
        if (tradingEngine) {
            tradingEngine.on('tradeExecuted', (trade) => {
                this.handleTradeExecution(trade);
            });
            
            tradingEngine.on('orderPlaced', (order) => {
                this.handleOrderPlacement(order);
            });
            
            tradingEngine.on('orderFailed', (orderData) => {
                this.handleOrderFailure(orderData);
            });
            
            tradingEngine.on('inventoryUpdated', (inventory) => {
                this.handleInventoryUpdate(inventory);
            });
            
            tradingEngine.on('quotingCompleted', (quotingData) => {
                this.handleQuotingCompletion(quotingData);
            });
        }
        
        // 交换服务事件监听
        if (exchangeService) {
            exchangeService.on('apiCall', (apiData) => {
                this.handleApiCall(apiData);
            });
            
            exchangeService.on('apiError', (error) => {
                MonitoringSystem.sendConnectionAlert('api_error', {
                    error: error.message,
                    timestamp: Date.now()
                });
            });
        }
    }

    /**
     * @description 处理交易执行事件
     * @param {Object} trade - 交易数据
     */
    handleTradeExecution(trade) {
        // 记录交易指标
        MonitoringSystem.recordTrade({
            side: trade.side,
            amount: trade.amount,
            price: trade.price,
            fee: trade.fee || 0,
            executionTime: trade.executionTime || 0,
            timestamp: trade.timestamp || Date.now()
        });
        
        // 检查异常交易
        if (trade.amount > 10000) { // 大额交易告警
            MonitoringSystem.sendTradingAlert('large_trade_executed', {
                amount: trade.amount,
                price: trade.price,
                value: trade.amount * trade.price
            });
        }
        
        Logger.debug(`[MonitoringIntegration] 记录交易: ${trade.side} ${trade.amount} @ ${trade.price}`);
    }

    /**
     * @description 处理订单下单事件
     * @param {Object} order - 订单数据
     */
    handleOrderPlacement(order) {
        MonitoringSystem.recordOrderExecution({
            type: 'placed',
            side: order.side,
            amount: order.amount,
            price: order.price,
            timestamp: Date.now()
        });
    }

    /**
     * @description 处理订单失败事件
     * @param {Object} orderData - 订单失败数据
     */
    handleOrderFailure(orderData) {
        MonitoringSystem.recordOrderExecution({
            type: 'failed',
            side: orderData.side,
            amount: orderData.amount,
            price: orderData.price,
            error: orderData.error,
            timestamp: Date.now()
        });
        
        // 发送订单失败告警
        MonitoringSystem.sendTradingAlert('order_execution_failed', {
            orderId: orderData.id,
            error: orderData.error,
            side: orderData.side,
            amount: orderData.amount
        });
    }

    /**
     * @description 处理库存更新事件
     * @param {Object} inventory - 库存数据
     */
    handleInventoryUpdate(inventory) {
        const inventoryData = {
            currentInventory: inventory.current,
            maxInventory: inventory.max,
            utilization: inventory.current / inventory.max,
            limitTriggered: inventory.limitTriggered || false,
            timestamp: Date.now()
        };
        
        MonitoringSystem.recordInventory(inventoryData);
        
        // 检查库存告警
        if (inventoryData.utilization > 0.9) {
            MonitoringSystem.sendTradingAlert('inventory_critical', {
                utilization: inventoryData.utilization,
                currentInventory: inventoryData.currentInventory
            });
        }
    }

    /**
     * @description 处理报价完成事件
     * @param {Object} quotingData - 报价数据
     */
    handleQuotingCompletion(quotingData) {
        MonitoringSystem.recordQuoting(quotingData.executionTime);
        
        // 记录GLFT特有指标
        if (quotingData.halfSpread !== undefined) {
            MonitoringSystem.recordHalfSpread(quotingData.halfSpread);
        }
        
        if (quotingData.skew !== undefined) {
            MonitoringSystem.recordSkew(quotingData.skew);
        }
        
        // 检查报价异常
        if (quotingData.executionTime > 1000) { // 报价时间超过1秒
            MonitoringSystem.sendTradingAlert('quoting_slow', {
                executionTime: quotingData.executionTime
            });
        }
    }

    /**
     * @description 处理API调用事件
     * @param {Object} apiData - API调用数据
     */
    handleApiCall(apiData) {
        MonitoringSystem.recordApiCall({
            method: apiData.method,
            endpoint: apiData.endpoint,
            success: apiData.success,
            responseTime: apiData.responseTime,
            error: apiData.error,
            timestamp: Date.now()
        });
        
        // 检查API响应时间
        if (apiData.responseTime > 5000) { // 响应时间超过5秒
            MonitoringSystem.sendConnectionAlert('api_slow_response', {
                endpoint: apiData.endpoint,
                responseTime: apiData.responseTime
            });
        }
    }

    /**
     * @description 启动定期报告
     * @private
     */
    startPeriodicReporting() {
        // 每小时生成摘要报告
        setInterval(() => {
            try {
                const report = MonitoringSystem.generateReport('summary');
                Logger.info('[MonitoringIntegration] 小时摘要报告:', JSON.stringify(report, null, 2));
                
                // 可以在这里将报告发送到外部系统
                this.sendReportToExternalSystem(report);
                
            } catch (error) {
                Logger.error('[MonitoringIntegration] 生成摘要报告失败:', error);
            }
        }, 3600000); // 1小时
        
        // 每天生成日报告
        setInterval(() => {
            try {
                const report = MonitoringSystem.generateReport('daily');
                Logger.info('[MonitoringIntegration] 日报告:', JSON.stringify(report, null, 2));
                
                // 重置日指标
                MonitoringSystem.resetMetrics(['trading', 'performance']);
                
            } catch (error) {
                Logger.error('[MonitoringIntegration] 生成日报告失败:', error);
            }
        }, 86400000); // 24小时
    }

    /**
     * @description 发送报告到外部系统
     * @param {Object} report - 监控报告
     * @private
     */
    sendReportToExternalSystem(report) {
        // 这里可以实现发送到外部监控系统的逻辑
        // 例如：发送到Prometheus、InfluxDB、或者通过Webhook发送
        
        Logger.debug('[MonitoringIntegration] 报告已准备发送到外部系统');
        
        // 示例：发送关键指标到外部API
        // await this.sendToExternalAPI({
        //     timestamp: report.timestamp,
        //     health: report.health.isHealthy,
        //     tradeCount: report.metrics.trading?.tradeCount || 0,
        //     errorRate: report.connection?.errorRate || 0
        // });
    }

    /**
     * @description 获取监控仪表板数据
     * @returns {Object} 仪表板数据
     */
    getDashboardData() {
        if (!this.initialized) {
            return { error: '监控系统未初始化' };
        }
        
        return {
            health: MonitoringSystem.getHealthStatus(),
            metrics: MonitoringSystem.getCurrentMetrics(),
            connection: MonitoringSystem.getConnectionMetrics(),
            alerts: MonitoringSystem.getAlertStats(),
            recentAlerts: MonitoringSystem.getAlertHistory({ limit: 10 }),
            systemInfo: {
                initialized: this.initialized,
                uptime: Date.now() - (this.startTime || Date.now())
            }
        };
    }

    /**
     * @description 执行健康检查
     * @returns {Object} 健康检查结果
     */
    performHealthCheck() {
        const healthStatus = MonitoringSystem.getHealthStatus();
        const isHealthy = MonitoringSystem.isSystemHealthy();
        
        return {
            overall: isHealthy,
            details: healthStatus,
            timestamp: Date.now()
        };
    }

    /**
     * @description 处理紧急情况
     * @param {string} emergencyType - 紧急情况类型
     * @param {Object} data - 相关数据
     */
    handleEmergency(emergencyType, data) {
        Logger.error(`[MonitoringIntegration] 紧急情况: ${emergencyType}`, data);
        
        // 发送紧急告警
        MonitoringSystem.sendAlert('CRITICAL', `紧急情况: ${emergencyType}`, 
            '系统检测到紧急情况，需要立即处理', {
                emergencyType,
                data,
                timestamp: Date.now()
            });
        
        // 根据紧急情况类型执行相应操作
        switch (emergencyType) {
            case 'connection_lost':
                this.handleConnectionLoss(data);
                break;
            case 'trading_halted':
                this.handleTradingHalt(data);
                break;
            case 'system_overload':
                this.handleSystemOverload(data);
                break;
            default:
                Logger.warn(`[MonitoringIntegration] 未知紧急情况类型: ${emergencyType}`);
        }
    }

    /**
     * @description 处理连接丢失
     * @param {Object} data - 连接数据
     * @private
     */
    handleConnectionLoss(data) {
        // 记录连接丢失事件
        MonitoringSystem.sendConnectionAlert('connection_lost', data);
        
        // 可以在这里实现自动恢复逻辑
        Logger.info('[MonitoringIntegration] 开始连接恢复流程');
    }

    /**
     * @description 处理交易暂停
     * @param {Object} data - 交易数据
     * @private
     */
    handleTradingHalt(data) {
        // 记录交易暂停事件
        MonitoringSystem.sendTradingAlert('trading_halted', data);
        
        // 可以在这里实现交易暂停处理逻辑
        Logger.info('[MonitoringIntegration] 交易已暂停');
    }

    /**
     * @description 处理系统过载
     * @param {Object} data - 系统数据
     * @private
     */
    handleSystemOverload(data) {
        // 记录系统过载事件
        MonitoringSystem.sendSystemAlert('system_overload', data);
        
        // 可以在这里实现负载降级逻辑
        Logger.info('[MonitoringIntegration] 系统过载，启动降级模式');
    }

    /**
     * @description 停止监控集成
     */
    stop() {
        if (this.initialized) {
            MonitoringSystem.stop();
            this.initialized = false;
            Logger.info('[MonitoringIntegration] 监控集成已停止');
        }
    }

    /**
     * @description 销毁监控集成
     */
    destroy() {
        this.stop();
        MonitoringSystem.destroy();
        Logger.info('[MonitoringIntegration] 监控集成已销毁');
    }
}

// 使用示例
if (require.main === module) {
    const integration = new MonitoringIntegration();
    
    // 模拟服务
    const mockServices = {
        websocketManager: new (require('events'))(),
        exchangeService: new (require('events'))(),
        tradingEngine: new (require('events'))()
    };
    
    // 初始化集成
    integration.initialize(mockServices)
        .then(() => {
            console.log('监控集成示例启动成功');
            
            // 模拟一些事件
            setTimeout(() => {
                mockServices.tradingEngine.emit('tradeExecuted', {
                    side: 'buy',
                    amount: 100,
                    price: 50000,
                    fee: 0.1,
                    timestamp: Date.now()
                });
            }, 1000);
            
            setTimeout(() => {
                const dashboardData = integration.getDashboardData();
                console.log('仪表板数据:', JSON.stringify(dashboardData, null, 2));
            }, 2000);
            
            // 5秒后停止
            setTimeout(() => {
                integration.destroy();
                process.exit(0);
            }, 5000);
            
        })
        .catch(error => {
            console.error('监控集成示例启动失败:', error);
            process.exit(1);
        });
}

module.exports = MonitoringIntegration;