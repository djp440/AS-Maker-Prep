const ConnectionMonitor = require('./connection_monitor');
const AlertManager = require('./alert_manager');
const MetricsCollector = require('./metrics_collector');
const Logger = require('../shared/logger');

/**
 * @class MonitoringSystem
 * @description 监控系统主入口，整合连接监控、告警管理和指标收集功能
 * 提供统一的监控接口和事件处理机制
 */
class MonitoringSystem {
    /**
     * @private
     * @type {MonitoringSystem | null}
     */
    static instance = null;

    /**
     * @private
     * @type {Object}
     */
    components = {
        connectionMonitor: null,
        alertManager: null,
        metricsCollector: null
    };

    /**
     * @private
     * @type {boolean}
     */
    initialized = false;

    /**
     * @private
     * @type {Object}
     */
    config = {
        // 连接监控配置
        connectionMonitor: {
            healthCheckInterval: 30000,
            apiCheckInterval: 300000,
            metricsReportInterval: 3600000,
            dataLatencyThreshold: 5000
        },
        
        // 告警管理配置
        alertManager: {
            thresholds: {
                reconnectCount: 5,
                errorRate: 10,
                dataLatency: 5000,
                apiFailureCount: 3,
                inventoryUtilization: 0.8
            },
            rateLimits: {
                INFO: 60000,
                WARNING: 300000,
                ERROR: 600000,
                CRITICAL: 0
            }
        },
        
        // 指标收集配置
        metricsCollector: {
            reportIntervals: {
                realtime: 60000,
                summary: 3600000,
                daily: 86400000
            },
            historyLimits: {
                tradeHistory: 100,
                apiResponseTimes: 50,
                halfSpreadHistory: 100,
                skewHistory: 100,
                inventoryHistory: 200,
                dataLatencyHistory: 50
            }
        }
    };

    /**
     * @private
     * @constructor
     */
    constructor() {
        // 私有构造函数，防止外部实例化
    }

    /**
     * @description 获取MonitoringSystem的单例实例
     * @returns {MonitoringSystem}
     */
    static getInstance() {
        if (!MonitoringSystem.instance) {
            MonitoringSystem.instance = new MonitoringSystem();
        }
        return MonitoringSystem.instance;
    }

    /**
     * @description 初始化监控系统
     * @param {Object} services - 服务依赖
     * @param {Object} services.websocketManager - WebSocket管理器实例
     * @param {Object} services.exchangeService - 交换服务实例
     * @param {Object} config - 监控配置
     */
    async initialize(services, config = {}) {
        try {
            if (this.initialized) {
                Logger.warn('[MonitoringSystem] 监控系统已经初始化');
                return;
            }

            // 合并配置
            this.config = this.mergeConfig(this.config, config);

            // 初始化各个组件
            await this.initializeComponents(services);

            // 设置组件间的事件监听
            this.setupComponentInteractions();

            this.initialized = true;
            Logger.info('[MonitoringSystem] 监控系统初始化完成');

        } catch (error) {
            Logger.error('[MonitoringSystem] 监控系统初始化失败:', error);
            throw error;
        }
    }

    /**
     * @description 初始化各个监控组件
     * @private
     * @param {Object} services - 服务依赖
     */
    async initializeComponents(services) {
        // 初始化告警管理器
        this.components.alertManager = AlertManager;
        this.components.alertManager.initialize(this.config.alertManager);

        // 初始化指标收集器
        this.components.metricsCollector = MetricsCollector;
        this.components.metricsCollector.initialize(this.config.metricsCollector);

        // 初始化连接监控器
        this.components.connectionMonitor = ConnectionMonitor;
        await this.components.connectionMonitor.initialize(services, this.config.connectionMonitor);

        Logger.info('[MonitoringSystem] 所有监控组件初始化完成');
    }

    /**
     * @description 设置组件间的事件交互
     * @private
     */
    setupComponentInteractions() {
        const { connectionMonitor, alertManager, metricsCollector } = this.components;

        // 连接监控器事件处理
        connectionMonitor.on('healthIssue', (data) => {
            this.handleHealthIssue(data);
        });

        connectionMonitor.on('criticalError', (error) => {
            alertManager.sendSystemAlert('uncaught_exception', { error });
            metricsCollector.recordError('error');
        });

        connectionMonitor.on('apiUnavailable', (data) => {
            alertManager.sendConnectionAlert('api_unavailable', data);
            metricsCollector.recordApiCall({
                success: false,
                method: 'healthCheck',
                error: data.error
            });
        });

        connectionMonitor.on('connectionStatusChanged', (data) => {
            if (data.current === 'closed' && data.previous === 'open') {
                alertManager.sendConnectionAlert('websocket_disconnected', {
                    reconnectCount: connectionMonitor.getConnectionMetrics().reconnectCount
                });
            }
            
            metricsCollector.recordConnection({
                type: 'websocket',
                reconnect: data.current === 'connecting'
            });
        });

        // 指标收集器事件处理
        metricsCollector.on('tradeRecorded', (trade) => {
            Logger.debug(`[MonitoringSystem] 交易记录: ${trade.side} ${trade.amount} @ ${trade.price}`);
        });

        metricsCollector.on('inventoryRecorded', (inventory) => {
            // 检查库存利用率告警
            if (inventory.utilization > alertManager.getConfig().thresholds.inventoryUtilization) {
                alertManager.sendTradingAlert('inventory_utilization_high', {
                    utilization: inventory.utilization,
                    currentInventory: inventory.currentInventory
                });
            }
            
            // 检查库存限制触发
            if (inventory.limitTriggered) {
                alertManager.sendTradingAlert('inventory_limit_exceeded', {
                    currentInventory: inventory.currentInventory
                });
            }
        });

        metricsCollector.on('halfSpreadRecorded', (data) => {
            // 检查半价差异常
            if (data.halfSpread <= 0 || data.halfSpread > 0.01) {
                alertManager.sendTradingAlert('half_spread_anomaly', {
                    halfSpread: data.halfSpread
                });
            }
        });

        metricsCollector.on('apiCallRecorded', (api) => {
            if (!api.success) {
                metricsCollector.recordError('warning');
            }
        });

        // 告警管理器事件处理
        alertManager.on('alert', (alert) => {
            Logger.debug(`[MonitoringSystem] 告警触发: ${alert.level} - ${alert.title}`);
        });

        Logger.info('[MonitoringSystem] 组件事件交互设置完成');
    }

    /**
     * @description 处理健康问题
     * @private
     * @param {Object} data - 健康问题数据
     */
    handleHealthIssue(data) {
        const { issues, status } = data;
        
        issues.forEach(issue => {
            if (issue.includes('WebSocket连接断开')) {
                this.components.alertManager.sendConnectionAlert('websocket_disconnected', {
                    reconnectCount: status.reconnectCount || 0
                });
            } else if (issue.includes('API不可用')) {
                this.components.alertManager.sendConnectionAlert('api_unavailable', {
                    error: new Error('API健康检查失败')
                });
            } else if (issue.includes('数据延迟过高')) {
                this.components.alertManager.sendConnectionAlert('data_latency_high', {
                    latency: status.dataLatency
                });
            } else if (issue.includes('错误率过高')) {
                this.components.alertManager.sendConnectionAlert('connection_quality_poor', {
                    errorRate: status.errorRate
                });
            }
        });
    }

    /**
     * @description 记录交易指标
     * @param {Object} tradeData - 交易数据
     */
    recordTrade(tradeData) {
        if (this.components.metricsCollector) {
            this.components.metricsCollector.recordTrade(tradeData);
        }
    }

    /**
     * @description 记录API调用指标
     * @param {Object} apiData - API调用数据
     */
    recordApiCall(apiData) {
        if (this.components.metricsCollector) {
            this.components.metricsCollector.recordApiCall(apiData);
        }
    }

    /**
     * @description 记录订单执行指标
     * @param {Object} orderData - 订单数据
     */
    recordOrderExecution(orderData) {
        if (this.components.metricsCollector) {
            this.components.metricsCollector.recordOrderExecution(orderData);
        }
    }

    /**
     * @description 记录GLFT半价差指标
     * @param {number} halfSpread - 半价差值
     */
    recordHalfSpread(halfSpread) {
        if (this.components.metricsCollector) {
            this.components.metricsCollector.recordHalfSpread(halfSpread);
        }
    }

    /**
     * @description 记录GLFT偏度指标
     * @param {number} skew - 偏度值
     */
    recordSkew(skew) {
        if (this.components.metricsCollector) {
            this.components.metricsCollector.recordSkew(skew);
        }
    }

    /**
     * @description 记录库存指标
     * @param {Object} inventoryData - 库存数据
     */
    recordInventory(inventoryData) {
        if (this.components.metricsCollector) {
            this.components.metricsCollector.recordInventory(inventoryData);
        }
    }

    /**
     * @description 记录报价指标
     * @param {number} quotingTime - 报价耗时
     */
    recordQuoting(quotingTime) {
        if (this.components.metricsCollector) {
            this.components.metricsCollector.recordQuoting(quotingTime);
        }
    }

    /**
     * @description 发送告警
     * @param {string} level - 告警级别
     * @param {string} title - 告警标题
     * @param {string} message - 告警消息
     * @param {Object} metadata - 附加元数据
     */
    sendAlert(level, title, message, metadata = {}) {
        if (this.components.alertManager) {
            return this.components.alertManager.sendAlert(level, title, message, metadata);
        }
        return false;
    }

    /**
     * @description 发送连接相关告警
     * @param {string} type - 告警类型
     * @param {Object} data - 告警数据
     */
    sendConnectionAlert(type, data) {
        if (this.components.alertManager) {
            this.components.alertManager.sendConnectionAlert(type, data);
        }
    }

    /**
     * @description 发送交易相关告警
     * @param {string} type - 告警类型
     * @param {Object} data - 告警数据
     */
    sendTradingAlert(type, data) {
        if (this.components.alertManager) {
            this.components.alertManager.sendTradingAlert(type, data);
        }
    }

    /**
     * @description 发送系统相关告警
     * @param {string} type - 告警类型
     * @param {Object} data - 告警数据
     */
    sendSystemAlert(type, data) {
        if (this.components.alertManager) {
            this.components.alertManager.sendSystemAlert(type, data);
        }
    }

    /**
     * @description 获取系统健康状态
     * @returns {Object} 健康状态
     */
    getHealthStatus() {
        if (!this.components.connectionMonitor) {
            return { status: 'unknown', message: '监控系统未初始化' };
        }

        const healthStatus = this.components.connectionMonitor.getHealthStatus();
        const metrics = this.components.metricsCollector ? 
            this.components.metricsCollector.getMetricsSummary() : {};

        return {
            ...healthStatus,
            metrics,
            timestamp: Date.now()
        };
    }

    /**
     * @description 获取连接指标
     * @returns {Object} 连接指标
     */
    getConnectionMetrics() {
        if (this.components.connectionMonitor) {
            return this.components.connectionMonitor.getConnectionMetrics();
        }
        return {};
    }

    /**
     * @description 获取当前指标
     * @returns {Object} 当前指标
     */
    getCurrentMetrics() {
        if (this.components.metricsCollector) {
            return this.components.metricsCollector.getCurrentMetrics();
        }
        return {};
    }

    /**
     * @description 获取指标摘要
     * @returns {Object} 指标摘要
     */
    getMetricsSummary() {
        if (this.components.metricsCollector) {
            return this.components.metricsCollector.getMetricsSummary();
        }
        return {};
    }

    /**
     * @description 获取告警历史
     * @param {Object} filters - 过滤条件
     * @returns {Array<Object>} 告警历史
     */
    getAlertHistory(filters = {}) {
        if (this.components.alertManager) {
            return this.components.alertManager.getAlertHistory(filters);
        }
        return [];
    }

    /**
     * @description 获取告警统计
     * @returns {Object} 告警统计
     */
    getAlertStats() {
        if (this.components.alertManager) {
            return this.components.alertManager.getAlertStats();
        }
        return {};
    }

    /**
     * @description 生成监控报告
     * @param {string} type - 报告类型 (realtime/summary/daily)
     * @returns {Object} 监控报告
     */
    generateReport(type = 'summary') {
        const report = {
            type,
            timestamp: Date.now(),
            system: {
                initialized: this.initialized,
                uptime: Date.now() - (this.components.metricsCollector?.metrics?.system?.startTime || Date.now())
            }
        };

        // 添加健康状态
        report.health = this.getHealthStatus();

        // 添加指标摘要
        report.metrics = this.getMetricsSummary();

        // 添加告警统计
        report.alerts = this.getAlertStats();

        // 添加连接指标
        report.connection = this.getConnectionMetrics();

        Logger.info(`[MonitoringSystem] 生成${type}监控报告:`, JSON.stringify(report, null, 2));
        
        return report;
    }

    /**
     * @description 重置指标
     * @param {Array<string>} categories - 要重置的类别
     */
    resetMetrics(categories = null) {
        if (this.components.metricsCollector) {
            this.components.metricsCollector.resetMetrics(categories);
        }
        
        if (this.components.connectionMonitor) {
            this.components.connectionMonitor.resetMetrics();
        }
        
        Logger.info('[MonitoringSystem] 监控指标已重置');
    }

    /**
     * @description 更新配置
     * @param {Object} newConfig - 新配置
     */
    updateConfig(newConfig) {
        this.config = this.mergeConfig(this.config, newConfig);
        
        // 更新各组件配置
        if (this.components.alertManager && newConfig.alertManager) {
            this.components.alertManager.updateConfig(newConfig.alertManager);
        }
        
        Logger.info('[MonitoringSystem] 监控配置已更新');
    }

    /**
     * @description 合并配置
     * @private
     * @param {Object} baseConfig - 基础配置
     * @param {Object} newConfig - 新配置
     * @returns {Object} 合并后的配置
     */
    mergeConfig(baseConfig, newConfig) {
        const merged = { ...baseConfig };
        
        Object.keys(newConfig).forEach(key => {
            if (typeof newConfig[key] === 'object' && !Array.isArray(newConfig[key])) {
                merged[key] = { ...merged[key], ...newConfig[key] };
            } else {
                merged[key] = newConfig[key];
            }
        });
        
        return merged;
    }

    /**
     * @description 检查系统是否健康
     * @returns {boolean} 是否健康
     */
    isSystemHealthy() {
        if (!this.initialized) {
            return false;
        }
        
        const healthStatus = this.getHealthStatus();
        return healthStatus.isHealthy !== false;
    }

    /**
     * @description 获取组件实例
     * @param {string} componentName - 组件名称
     * @returns {Object|null} 组件实例
     */
    getComponent(componentName) {
        return this.components[componentName] || null;
    }

    /**
     * @description 停止监控系统
     */
    stop() {
        if (!this.initialized) {
            return;
        }
        
        // 停止各个组件
        Object.values(this.components).forEach(component => {
            if (component && typeof component.stop === 'function') {
                component.stop();
            }
        });
        
        this.initialized = false;
        Logger.info('[MonitoringSystem] 监控系统已停止');
    }

    /**
     * @description 销毁监控系统
     */
    destroy() {
        this.stop();
        
        // 销毁各个组件
        Object.values(this.components).forEach(component => {
            if (component && typeof component.destroy === 'function') {
                component.destroy();
            }
        });
        
        this.components = {
            connectionMonitor: null,
            alertManager: null,
            metricsCollector: null
        };
        
        MonitoringSystem.instance = null;
        Logger.info('[MonitoringSystem] 监控系统已销毁');
    }
}

module.exports = MonitoringSystem.getInstance();