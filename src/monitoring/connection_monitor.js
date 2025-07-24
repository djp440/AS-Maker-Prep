const { EventEmitter } = require('events');
const Logger = require('../shared/logger');
const Config = require('../shared/config');

/**
 * @class ConnectionMonitor
 * @description 连接状态监控和指标收集器
 * 监控WebSocket连接状态、API可用性、数据流延迟等关键指标
 */
class ConnectionMonitor extends EventEmitter {
    /**
     * @private
     * @type {ConnectionMonitor | null}
     */
    static instance = null;

    /**
     * @private
     * @type {Object}
     */
    connectionMetrics = {
        // 连接状态指标
        wsConnectionStatus: 'unknown', // unknown, connected, disconnected, reconnecting
        apiAvailability: 'unknown', // unknown, available, unavailable
        dataLatency: 0, // 数据延迟（毫秒）
        
        // 连接质量指标
        reconnectCount: 0,
        lastReconnectTime: null,
        connectionUptime: 0,
        connectionStartTime: null,
        
        // API调用指标
        apiCallCount: 0,
        apiErrorCount: 0,
        apiSuccessRate: 100,
        lastApiCallTime: null,
        
        // 数据流指标
        messagesReceived: 0,
        lastMessageTime: null,
        averageMessageInterval: 0,
        messageIntervals: [], // 保存最近10次消息间隔
        
        // 错误统计
        errorHistory: [], // 保存最近的错误记录
        criticalErrors: 0,
        warningCount: 0
    };

    /**
     * @private
     * @type {Object}
     */
    monitoringConfig = {
        healthCheckInterval: 30000, // 30秒检查一次
        apiCheckInterval: 300000, // 5分钟检查一次API
        metricsReportInterval: 3600000, // 1小时报告一次指标
        dataLatencyThreshold: 5000, // 数据延迟阈值（毫秒）
        maxErrorHistorySize: 100, // 最大错误历史记录数
        maxMessageIntervals: 10 // 最大消息间隔记录数
    };

    /**
     * @private
     * @type {Object}
     */
    timers = {
        healthCheck: null,
        apiCheck: null,
        metricsReport: null
    };

    /**
     * @private
     * @type {Object}
     */
    services = {
        websocketManager: null,
        exchangeService: null
    };

    /**
     * @private
     * @constructor
     */
    constructor() {
        super();
        this.connectionMetrics.connectionStartTime = Date.now();
    }

    /**
     * @description 获取ConnectionMonitor的单例实例
     * @returns {ConnectionMonitor}
     */
    static getInstance() {
        if (!ConnectionMonitor.instance) {
            ConnectionMonitor.instance = new ConnectionMonitor();
        }
        return ConnectionMonitor.instance;
    }

    /**
     * @description 初始化连接监控器
     * @param {Object} services - 服务依赖
     * @param {Object} services.websocketManager - WebSocket管理器实例
     * @param {Object} services.exchangeService - 交换服务实例
     * @param {Object} config - 监控配置
     */
    async initialize(services, config = {}) {
        try {
            this.services = services;
            
            // 合并配置
            this.monitoringConfig = { ...this.monitoringConfig, ...config };
            
            // 设置事件监听器
            this.setupEventListeners();
            
            // 启动监控定时器
            this.startMonitoring();
            
            Logger.info('[ConnectionMonitor] 连接监控器初始化完成');
            
        } catch (error) {
            Logger.error('[ConnectionMonitor] 初始化失败:', error);
            throw error;
        }
    }

    /**
     * @description 设置事件监听器
     * @private
     */
    setupEventListeners() {
        if (this.services.websocketManager) {
            const wsManager = this.services.websocketManager;
            
            // 监听连接状态变化
            wsManager.on('connectionStateChanged', (state) => {
                this.updateConnectionStatus(state);
            });
            
            // 监听重连事件
            wsManager.on('reconnecting', () => {
                this.recordReconnectAttempt();
            });
            
            // 监听数据接收事件
            wsManager.on('message', (data) => {
                this.recordMessageReceived(data);
            });
            
            // 监听连接质量事件
            wsManager.on('connectionQuality', (quality) => {
                this.updateConnectionQuality(quality);
            });
            
            // 监听错误事件
            wsManager.on('error', (error) => {
                this.recordError('websocket', error);
            });
        }
    }

    /**
     * @description 启动监控定时器
     * @private
     */
    startMonitoring() {
        // 健康检查定时器
        this.timers.healthCheck = setInterval(() => {
            this.performHealthCheck();
        }, this.monitoringConfig.healthCheckInterval);
        
        // API可用性检查定时器
        this.timers.apiCheck = setInterval(() => {
            this.checkApiAvailability();
        }, this.monitoringConfig.apiCheckInterval);
        
        // 指标报告定时器
        this.timers.metricsReport = setInterval(() => {
            this.generateMetricsReport();
        }, this.monitoringConfig.metricsReportInterval);
        
        Logger.info('[ConnectionMonitor] 监控定时器已启动');
    }

    /**
     * @description 执行健康检查
     * @private
     */
    async performHealthCheck() {
        try {
            const healthStatus = {
                timestamp: Date.now(),
                wsConnection: this.checkWebSocketHealth(),
                apiAvailability: this.connectionMetrics.apiAvailability,
                dataLatency: this.connectionMetrics.dataLatency,
                uptime: this.calculateUptime(),
                errorRate: this.calculateErrorRate()
            };
            
            // 检查是否有异常情况
            const issues = this.identifyHealthIssues(healthStatus);
            
            if (issues.length > 0) {
                Logger.warn(`[ConnectionMonitor] 健康检查发现问题: ${issues.join(', ')}`);
                this.emit('healthIssue', { status: healthStatus, issues });
            } else {
                Logger.info(`[ConnectionMonitor] 系统健康状态: WebSocket=${healthStatus.wsConnection}, API=${healthStatus.apiAvailability}, 延迟=${healthStatus.dataLatency}ms`);
            }
            
            this.emit('healthCheck', healthStatus);
            
        } catch (error) {
            Logger.error('[ConnectionMonitor] 健康检查执行失败:', error);
            this.recordError('healthCheck', error);
        }
    }

    /**
     * @description 检查WebSocket连接健康状态
     * @private
     * @returns {string} 连接状态
     */
    checkWebSocketHealth() {
        if (!this.services.websocketManager) {
            return 'unavailable';
        }
        
        const wsManager = this.services.websocketManager;
        const connectionState = wsManager.getConnectionState ? wsManager.getConnectionState() : (wsManager.connectionState || 'unknown');
        
        // 检查数据接收延迟
        const now = Date.now();
        const timeSinceLastMessage = this.connectionMetrics.lastMessageTime ? 
            now - this.connectionMetrics.lastMessageTime : Infinity;
        
        if (connectionState === 'open') {
            if (timeSinceLastMessage > this.monitoringConfig.dataLatencyThreshold) {
                return 'stale'; // 连接正常但数据陈旧
            }
            return 'healthy';
        } else if (connectionState === 'connecting') {
            return 'connecting';
        } else {
            return 'disconnected';
        }
    }

    /**
     * @description 检查API可用性
     * @private
     */
    async checkApiAvailability() {
        if (!this.services.exchangeService) {
            this.connectionMetrics.apiAvailability = 'unavailable';
            return;
        }
        
        try {
            const startTime = Date.now();
            
            // 执行轻量级API调用
            const exchange = this.services.exchangeService.getExchangeInstance ? 
                this.services.exchangeService.getExchangeInstance() : null;
            if (exchange && exchange.fetchTime) {
                await exchange.fetchTime();
            } else if (this.services.exchangeService.fetchBalance) {
                // 如果没有fetchTime方法，尝试fetchBalance
                await this.services.exchangeService.fetchBalance();
            } else {
                // 如果都没有，抛出错误
                throw new Error('No available API method for health check');
            }
            
            const responseTime = Date.now() - startTime;
            
            this.connectionMetrics.apiAvailability = 'available';
            this.connectionMetrics.lastApiCallTime = Date.now();
            this.connectionMetrics.apiCallCount++;
            
            Logger.debug(`[ConnectionMonitor] API可用性检查成功，响应时间: ${responseTime}ms`);
            
        } catch (error) {
            this.connectionMetrics.apiAvailability = 'unavailable';
            this.connectionMetrics.apiErrorCount++;
            
            Logger.warn('[ConnectionMonitor] API可用性检查失败:', error.message);
            this.recordError('apiCheck', error);
            
            // 发出API不可用告警
            this.emit('apiUnavailable', { error, timestamp: Date.now() });
        }
        
        // 更新API成功率
        this.updateApiSuccessRate();
    }

    /**
     * @description 更新连接状态
     * @private
     * @param {string} state - 连接状态
     */
    updateConnectionStatus(state) {
        const previousState = this.connectionMetrics.wsConnectionStatus;
        this.connectionMetrics.wsConnectionStatus = state;
        
        if (state === 'open' && previousState !== 'open') {
            this.connectionMetrics.connectionStartTime = Date.now();
            Logger.info('[ConnectionMonitor] WebSocket连接已建立');
        } else if (state === 'closed' && previousState === 'open') {
            Logger.warn('[ConnectionMonitor] WebSocket连接已断开');
        }
        
        this.emit('connectionStatusChanged', { previous: previousState, current: state });
    }

    /**
     * @description 记录重连尝试
     * @private
     */
    recordReconnectAttempt() {
        this.connectionMetrics.reconnectCount++;
        this.connectionMetrics.lastReconnectTime = Date.now();
        
        Logger.info(`[ConnectionMonitor] 记录重连尝试，总计: ${this.connectionMetrics.reconnectCount}`);
    }

    /**
     * @description 记录消息接收
     * @private
     * @param {Object} data - 消息数据
     */
    recordMessageReceived(data) {
        const now = Date.now();
        
        if (this.connectionMetrics.lastMessageTime) {
            const interval = now - this.connectionMetrics.lastMessageTime;
            
            // 更新消息间隔记录
            this.connectionMetrics.messageIntervals.push(interval);
            if (this.connectionMetrics.messageIntervals.length > this.monitoringConfig.maxMessageIntervals) {
                this.connectionMetrics.messageIntervals.shift();
            }
            
            // 计算平均消息间隔
            this.connectionMetrics.averageMessageInterval = 
                this.connectionMetrics.messageIntervals.reduce((sum, val) => sum + val, 0) / 
                this.connectionMetrics.messageIntervals.length;
        }
        
        this.connectionMetrics.messagesReceived++;
        this.connectionMetrics.lastMessageTime = now;
        
        // 计算数据延迟（如果消息包含时间戳）
        if (data && data.timestamp) {
            this.connectionMetrics.dataLatency = now - data.timestamp;
        }
    }

    /**
     * @description 更新连接质量
     * @private
     * @param {Object} quality - 连接质量数据
     */
    updateConnectionQuality(quality) {
        // 这里可以根据需要处理连接质量数据
        this.emit('connectionQualityUpdate', quality);
    }

    /**
     * @description 记录错误
     * @private
     * @param {string} source - 错误来源
     * @param {Error} error - 错误对象
     */
    recordError(source, error) {
        const errorRecord = {
            timestamp: Date.now(),
            source,
            message: error.message,
            stack: error.stack,
            type: error.constructor.name
        };
        
        this.connectionMetrics.errorHistory.push(errorRecord);
        
        // 限制错误历史记录大小
        if (this.connectionMetrics.errorHistory.length > this.monitoringConfig.maxErrorHistorySize) {
            this.connectionMetrics.errorHistory.shift();
        }
        
        // 判断错误严重程度
        if (this.isCriticalError(error)) {
            this.connectionMetrics.criticalErrors++;
            this.emit('criticalError', errorRecord);
        } else {
            this.connectionMetrics.warningCount++;
        }
    }

    /**
     * @description 判断是否为关键错误
     * @private
     * @param {Error} error - 错误对象
     * @returns {boolean}
     */
    isCriticalError(error) {
        const criticalErrorTypes = [
            'AuthenticationError',
            'NetworkError',
            'ExchangeNotAvailable'
        ];
        
        return criticalErrorTypes.includes(error.constructor.name) ||
               error.message.includes('authentication') ||
               error.message.includes('network') ||
               error.message.includes('timeout');
    }

    /**
     * @description 计算运行时间
     * @private
     * @returns {number} 运行时间（毫秒）
     */
    calculateUptime() {
        if (!this.connectionMetrics.connectionStartTime) {
            return 0;
        }
        return Date.now() - this.connectionMetrics.connectionStartTime;
    }

    /**
     * @description 计算错误率
     * @private
     * @returns {number} 错误率（百分比）
     */
    calculateErrorRate() {
        const totalCalls = this.connectionMetrics.apiCallCount;
        const errorCalls = this.connectionMetrics.apiErrorCount;
        
        if (totalCalls === 0) {
            return 0;
        }
        
        return (errorCalls / totalCalls) * 100;
    }

    /**
     * @description 更新API成功率
     * @private
     */
    updateApiSuccessRate() {
        const totalCalls = this.connectionMetrics.apiCallCount;
        const successCalls = totalCalls - this.connectionMetrics.apiErrorCount;
        
        if (totalCalls > 0) {
            this.connectionMetrics.apiSuccessRate = (successCalls / totalCalls) * 100;
        }
    }

    /**
     * @description 识别健康问题
     * @private
     * @param {Object} healthStatus - 健康状态
     * @returns {Array<string>} 问题列表
     */
    identifyHealthIssues(healthStatus) {
        const issues = [];
        
        if (healthStatus.wsConnection === 'disconnected') {
            issues.push('WebSocket连接断开');
        } else if (healthStatus.wsConnection === 'stale') {
            issues.push('WebSocket数据陈旧');
        }
        
        if (healthStatus.apiAvailability === 'unavailable') {
            issues.push('API不可用');
        }
        
        if (healthStatus.dataLatency > this.monitoringConfig.dataLatencyThreshold) {
            issues.push(`数据延迟过高(${healthStatus.dataLatency}ms)`);
        }
        
        if (healthStatus.errorRate > 10) {
            issues.push(`错误率过高(${healthStatus.errorRate.toFixed(2)}%)`);
        }
        
        return issues;
    }

    /**
     * @description 生成指标报告
     * @private
     */
    generateMetricsReport() {
        const report = {
            timestamp: Date.now(),
            uptime: this.calculateUptime(),
            connectionMetrics: {
                wsStatus: this.connectionMetrics.wsConnectionStatus,
                apiAvailability: this.connectionMetrics.apiAvailability,
                reconnectCount: this.connectionMetrics.reconnectCount,
                messagesReceived: this.connectionMetrics.messagesReceived,
                averageMessageInterval: Math.round(this.connectionMetrics.averageMessageInterval),
                dataLatency: this.connectionMetrics.dataLatency
            },
            apiMetrics: {
                totalCalls: this.connectionMetrics.apiCallCount,
                errorCount: this.connectionMetrics.apiErrorCount,
                successRate: this.connectionMetrics.apiSuccessRate.toFixed(2) + '%',
                errorRate: this.calculateErrorRate().toFixed(2) + '%'
            },
            errorSummary: {
                criticalErrors: this.connectionMetrics.criticalErrors,
                totalWarnings: this.connectionMetrics.warningCount,
                recentErrors: this.connectionMetrics.errorHistory.slice(-5).length
            }
        };
        
        Logger.info('[ConnectionMonitor] 连接监控指标报告:', JSON.stringify(report, null, 2));
        this.emit('metricsReport', report);
        
        return report;
    }

    /**
     * @description 获取当前连接指标
     * @returns {Object} 连接指标
     */
    getConnectionMetrics() {
        return {
            ...this.connectionMetrics,
            uptime: this.calculateUptime(),
            errorRate: this.calculateErrorRate()
        };
    }

    /**
     * @description 获取健康状态
     * @returns {Object} 健康状态
     */
    getHealthStatus() {
        return {
            wsConnection: this.checkWebSocketHealth(),
            apiAvailability: this.connectionMetrics.apiAvailability,
            dataLatency: this.connectionMetrics.dataLatency,
            uptime: this.calculateUptime(),
            errorRate: this.calculateErrorRate(),
            isHealthy: this.isSystemHealthy()
        };
    }

    /**
     * @description 判断系统是否健康
     * @private
     * @returns {boolean}
     */
    isSystemHealthy() {
        const wsHealthy = ['healthy', 'connecting'].includes(this.checkWebSocketHealth());
        const apiHealthy = this.connectionMetrics.apiAvailability === 'available';
        const latencyOk = this.connectionMetrics.dataLatency < this.monitoringConfig.dataLatencyThreshold;
        const errorRateOk = this.calculateErrorRate() < 10;
        
        return wsHealthy && apiHealthy && latencyOk && errorRateOk;
    }

    /**
     * @description 重置指标
     */
    resetMetrics() {
        this.connectionMetrics = {
            wsConnectionStatus: 'unknown',
            apiAvailability: 'unknown',
            dataLatency: 0,
            reconnectCount: 0,
            lastReconnectTime: null,
            connectionUptime: 0,
            connectionStartTime: Date.now(),
            apiCallCount: 0,
            apiErrorCount: 0,
            apiSuccessRate: 100,
            lastApiCallTime: null,
            messagesReceived: 0,
            lastMessageTime: null,
            averageMessageInterval: 0,
            messageIntervals: [],
            errorHistory: [],
            criticalErrors: 0,
            warningCount: 0
        };
        
        Logger.info('[ConnectionMonitor] 指标已重置');
    }

    /**
     * @description 停止监控
     */
    stop() {
        // 清除所有定时器
        Object.values(this.timers).forEach(timer => {
            if (timer) {
                clearInterval(timer);
            }
        });
        
        this.timers = {
            healthCheck: null,
            apiCheck: null,
            metricsReport: null
        };
        
        Logger.info('[ConnectionMonitor] 连接监控已停止');
    }

    /**
     * @description 销毁监控器
     */
    destroy() {
        this.stop();
        this.removeAllListeners();
        ConnectionMonitor.instance = null;
        
        Logger.info('[ConnectionMonitor] 连接监控器已销毁');
    }
}

module.exports = ConnectionMonitor.getInstance();