const { EventEmitter } = require('events');
const Logger = require('../shared/logger');
const Config = require('../shared/config');
const ConnectionMonitor = require('../monitoring/connection_monitor');

/**
 * @class NetworkRecoveryManager
 * @description 网络异常恢复管理器
 * 实现指数退避自动重连、降级模式和风险控制机制
 */
class NetworkRecoveryManager extends EventEmitter {
    /**
     * @private
     * @type {NetworkRecoveryManager | null}
     */
    static instance = null;

    /**
     * @private
     * @type {Object}
     */
    recoveryConfig = {
        // 指数退避配置
        baseDelay: 1000, // 基础延迟1秒
        maxDelay: 300000, // 最大延迟5分钟
        backoffMultiplier: 2, // 退避倍数
        jitterFactor: 0.1, // 抖动因子
        maxRetries: 20, // 最大重试次数
        
        // 降级模式配置
        degradationThreshold: 5, // 连续失败5次后进入降级模式
        degradationDuration: 600000, // 降级模式持续10分钟
        emergencyMode: false, // 紧急模式标志
        
        // 风险控制配置
        maxPositionRisk: 0.02, // 最大仓位风险2%
        emergencyCloseThreshold: 0.05, // 紧急平仓阈值5%
        tradingPauseThreshold: 3, // 交易暂停阈值（连续失败次数）
        
        // 健康检查配置
        healthCheckInterval: 30000, // 30秒检查一次
        connectionTimeoutThreshold: 60000, // 连接超时阈值1分钟
        dataStaleThreshold: 120000 // 数据过期阈值2分钟
    };

    /**
     * @private
     * @type {Object}
     */
    recoveryState = {
        // 重连状态
        isRecovering: false,
        retryCount: 0,
        lastRetryTime: null,
        nextRetryDelay: 0,
        consecutiveFailures: 0,
        
        // 降级状态
        isDegraded: false,
        degradationStartTime: null,
        emergencyModeActive: false,
        
        // 风险控制状态
        tradingPaused: false,
        riskLevel: 'low', // low, medium, high, critical
        lastRiskAssessment: null,
        lastRecoveryTime: null, // 最后一次恢复时间
        
        // 服务状态
        servicesStatus: {
            websocket: 'unknown',
            api: 'unknown',
            trading: 'unknown',
            data: 'unknown'
        }
    };

    /**
     * @private
     * @type {Object}
     */
    timers = {
        recovery: null,
        healthCheck: null,
        degradationCheck: null,
        riskAssessment: null
    };

    /**
     * @private
     * @type {Object}
     */
    services = {
        websocketManager: null,
        exchangeService: null,
        trader: null,
        connectionMonitor: null
    };

    /**
     * @constructor
     * @param {Object} options - 初始化选项
     * @param {Object} options.logger - 日志记录器
     * @param {Object} options.config - 配置对象
     */
    constructor(options = {}) {
        super();
        this.logger = options.logger || Logger;
        
        // 合并配置
        if (options.config) {
            this.recoveryConfig = { ...this.recoveryConfig, ...options.config };
        }
        
        this.isInitialized = false;
    }

    /**
     * @description 获取NetworkRecoveryManager的单例实例
     * @returns {NetworkRecoveryManager}
     */
    static getInstance() {
        if (!NetworkRecoveryManager.instance) {
            NetworkRecoveryManager.instance = new NetworkRecoveryManager();
        }
        return NetworkRecoveryManager.instance;
    }

    /**
     * @description 初始化网络恢复管理器
     * @param {Object} services - 服务对象（可选）
     */
    async initialize(services = {}) {
        try {
            // 设置服务引用
            if (services && Object.keys(services).length > 0) {
                this.services = { ...this.services, ...services };
            }
            
            // 从配置中获取服务引用
            if (this.recoveryConfig.services) {
                this.services = { ...this.services, ...this.recoveryConfig.services };
            }
            
            // 设置事件监听器
            this.setupEventListeners();
            
            // 启动健康检查
            this.startHealthCheck();
            
            // 启动风险评估
            this.startRiskAssessment();
            
            this.isInitialized = true;
            this.logger.info('网络恢复管理器初始化完成');
            this.emit('initialized');
            
        } catch (error) {
            this.logger.error('网络恢复管理器初始化失败:', error);
            throw error;
        }
    }

    /**
     * @description 设置事件监听器
     * @private
     */
    setupEventListeners() {
        // 监听连接状态变化
        if (this.services.websocketManager) {
            this.services.websocketManager.on('error', (error) => {
                this.handleConnectionError('websocket', error);
            });
            
            this.services.websocketManager.on('close', () => {
                this.handleConnectionLoss('websocket');
            });
            
            this.services.websocketManager.on('open', () => {
                this.handleConnectionRecovered('websocket');
            });
        }
        
        // 监听API错误
        if (this.services.exchangeService) {
            this.services.exchangeService.on('error', (error) => {
                this.handleConnectionError('api', error);
            });
        }
        
        // 监听连接监控器事件
        if (this.services.connectionMonitor) {
            this.services.connectionMonitor.on('connection_degraded', () => {
                this.handleConnectionDegradation();
            });
            
            this.services.connectionMonitor.on('critical_error', (error) => {
                this.handleCriticalError(error);
            });
        }
    }

    /**
     * @description 处理连接错误
     * @param {string} source - 错误源
     * @param {Error} error - 错误对象
     */
    async handleConnectionError(source, error) {
        this.logger.warn(`${source}连接错误:`, error.message);
        
        this.recoveryState.consecutiveFailures++;
        this.recoveryState.servicesStatus[source] = 'error';
        
        // 记录错误
        this.emit('connection_error', { source, error, timestamp: Date.now() });
        
        // 评估风险级别
        await this.assessRiskLevel();
        
        // 评估是否需要进入降级模式
        if (this.shouldEnterDegradationMode()) {
            await this.enterDegradationMode();
        }
        
        // 启动恢复流程
        if (!this.recoveryState.isRecovering) {
            await this.startRecoveryProcess(source);
        }
    }

    /**
     * @description 处理连接丢失
     * @param {string} source - 连接源
     */
    async handleConnectionLoss(source) {
        this.logger.warn(`${source}连接丢失`);
        
        this.recoveryState.servicesStatus[source] = 'disconnected';
        this.emit('connection_lost', { source, timestamp: Date.now() });
        
        // 启动恢复流程
        if (!this.recoveryState.isRecovering) {
            await this.startRecoveryProcess(source);
        }
    }

    /**
     * @description 处理连接恢复
     * @param {string} source - 连接源
     */
    async handleConnectionRecovered(source) {
        this.logger.info(`${source}连接已恢复`);
        
        this.recoveryState.servicesStatus[source] = 'connected';
        this.recoveryState.lastRecoveryTime = Date.now(); // 记录恢复时间
        
        // 只有在所有关键服务都恢复时才重置连续失败计数
        const criticalServices = ['websocket', 'api'];
        const allRecovered = criticalServices.every(service => 
            this.recoveryState.servicesStatus[service] === 'connected'
        );
        
        if (allRecovered) {
            this.recoveryState.consecutiveFailures = 0;
        }
        
        this.emit('connection_recovered', { source, timestamp: Date.now() });
        
        // 检查是否可以退出降级模式
        if (this.recoveryState.isDegraded && this.canExitDegradationMode()) {
            await this.exitDegradationMode();
        }
        
        // 重新评估风险级别
        await this.assessRiskLevel();
    }

    /**
     * @description 启动恢复流程
     * @param {string} source - 恢复源
     */
    async startRecoveryProcess(source) {
        if (this.recoveryState.isRecovering) {
            return;
        }
        
        this.recoveryState.isRecovering = true;
        this.recoveryState.retryCount = 0;
        
        this.logger.info(`启动${source}恢复流程`);
        this.emit('recovery_started', { source, timestamp: Date.now() });
        
        await this.executeRecoveryWithBackoff(source);
    }

    /**
     * @description 执行指数退避恢复
     * @param {string} source - 恢复源
     */
    async executeRecoveryWithBackoff(source) {
        while (this.recoveryState.isRecovering && 
               this.recoveryState.retryCount < this.recoveryConfig.maxRetries) {
            
            // 计算退避延迟
            const delay = this.calculateBackoffDelay();
            this.recoveryState.nextRetryDelay = delay;
            
            this.logger.info(`第${this.recoveryState.retryCount + 1}次恢复尝试，延迟${delay}ms`);
            
            // 等待退避时间
            await this.sleep(delay);
            
            try {
                // 尝试恢复连接
                const success = await this.attemptRecovery(source);
                
                if (success) {
                    this.logger.info(`${source}恢复成功`);
                    this.recoveryState.isRecovering = false;
                    this.recoveryState.retryCount = 0;
                    this.emit('recovery_success', { source, attempts: this.recoveryState.retryCount + 1 });
                    return;
                }
                
            } catch (error) {
                this.logger.error(`${source}恢复尝试失败:`, error.message);
            }
            
            this.recoveryState.retryCount++;
            this.recoveryState.lastRetryTime = Date.now();
        }
        
        // 恢复失败
        this.logger.error(`${source}恢复失败，已达到最大重试次数`);
        this.recoveryState.isRecovering = false;
        this.emit('recovery_failed', { source, attempts: this.recoveryState.retryCount });
        
        // 进入紧急模式
        await this.enterEmergencyMode();
    }

    /**
     * @description 计算指数退避延迟
     * @returns {number} 延迟时间（毫秒）
     */
    calculateBackoffDelay() {
        const { baseDelay, maxDelay, backoffMultiplier, jitterFactor } = this.recoveryConfig;
        
        // 指数退避计算
        let delay = baseDelay * Math.pow(backoffMultiplier, this.recoveryState.retryCount);
        
        // 限制最大延迟
        delay = Math.min(delay, maxDelay);
        
        // 添加随机抖动
        const jitter = delay * jitterFactor * (Math.random() - 0.5);
        delay += jitter;
        
        return Math.max(delay, baseDelay);
    }

    /**
     * @description 尝试恢复连接
     * @param {string} source - 恢复源
     * @returns {boolean} 是否成功
     */
    async attemptRecovery(source) {
        switch (source) {
            case 'websocket':
                if (this.services.websocketManager) {
                    await this.services.websocketManager.reconnect();
                    return this.services.websocketManager.isConnected();
                }
                break;
                
            case 'api':
                if (this.services.exchangeService) {
                    // 测试API连接
                    await this.services.exchangeService.testConnection();
                    return true;
                }
                break;
                
            case 'health_check':
            case 'manual':
                // 对于健康检查和手动恢复，尝试恢复所有服务
                let success = true;
                if (this.services.websocketManager && !this.services.websocketManager.isConnected()) {
                    try {
                        await this.services.websocketManager.reconnect();
                        success = success && this.services.websocketManager.isConnected();
                    } catch (error) {
                        success = false;
                    }
                }
                return success;
                
            default:
                this.logger.warn(`未知的恢复源: ${source}`);
                return false;
        }
        
        return false;
    }

    /**
     * @description 判断是否应该进入降级模式
     * @returns {boolean}
     */
    shouldEnterDegradationMode() {
        return !this.recoveryState.isDegraded && 
               this.recoveryState.consecutiveFailures >= this.recoveryConfig.degradationThreshold;
    }

    /**
     * @description 进入降级模式
     */
    async enterDegradationMode() {
        this.logger.warn('进入降级模式');
        
        this.recoveryState.isDegraded = true;
        this.recoveryState.degradationStartTime = Date.now();
        
        // 暂停交易
        if (this.services.trader) {
            await this.services.trader.pauseTrading('网络降级');
        }
        
        this.emit('degradation_mode_entered', { timestamp: Date.now() });
    }

    /**
     * @description 判断是否可以退出降级模式
     * @returns {boolean}
     */
    canExitDegradationMode() {
        if (!this.recoveryState.isDegraded) {
            return false;
        }
        
        // 检查降级时间是否足够
        const degradationTime = Date.now() - this.recoveryState.degradationStartTime;
        if (degradationTime < this.recoveryConfig.degradationDuration) {
            return false;
        }
        
        // 检查所有关键服务是否正常
        const criticalServices = ['websocket', 'api'];
        return criticalServices.every(service => 
            this.recoveryState.servicesStatus[service] === 'connected'
        );
    }

    /**
     * @description 退出降级模式
     */
    async exitDegradationMode() {
        this.logger.info('退出降级模式');
        
        this.recoveryState.isDegraded = false;
        this.recoveryState.degradationStartTime = null;
        
        // 恢复交易
        if (this.services.trader) {
            await this.services.trader.resumeTrading('网络恢复');
        }
        
        this.emit('degradation_mode_exited', { timestamp: Date.now() });
    }

    /**
     * @description 进入紧急模式
     */
    async enterEmergencyMode() {
        this.logger.error('进入紧急模式');
        
        this.recoveryState.emergencyModeActive = true;
        
        // 立即暂停所有交易
        if (this.services.trader) {
            await this.services.trader.emergencyStop('网络异常');
        }
        
        // 发送紧急警报
        this.emit('emergency_mode_entered', { 
            timestamp: Date.now(),
            reason: '网络恢复失败，进入紧急模式'
        });
    }

    /**
     * @description 评估风险级别
     */
    async assessRiskLevel() {
        const metrics = this.services.connectionMonitor?.getConnectionMetrics() || {};
        const healthStatus = this.services.connectionMonitor?.getHealthStatus() || {};
        
        let riskScore = 0;
        
        // 连接质量评分
        if (metrics.apiErrorCount > 10) riskScore += 2;
        if (metrics.reconnectCount > 5) riskScore += 2;
        if (metrics.dataLatency > 5000) riskScore += 1;
        
        // 服务状态评分
        Object.values(this.recoveryState.servicesStatus).forEach(status => {
            if (status === 'error' || status === 'disconnected') riskScore += 3;
        });
        
        // 连续失败评分
        if (this.recoveryState.consecutiveFailures > 3) riskScore += 2;
        if (this.recoveryState.consecutiveFailures > 10) riskScore += 5;
        
        // 确定风险级别
        let newRiskLevel;
        if (riskScore >= 10) {
            newRiskLevel = 'critical';
        } else if (riskScore >= 6) {
            newRiskLevel = 'high';
        } else if (riskScore >= 3) {
            newRiskLevel = 'medium';
        } else {
            newRiskLevel = 'low';
        }
        
        if (newRiskLevel !== this.recoveryState.riskLevel) {
            const oldLevel = this.recoveryState.riskLevel;
            this.logger.info(`风险级别变更: ${oldLevel} -> ${newRiskLevel}`);
            this.recoveryState.riskLevel = newRiskLevel;
            this.recoveryState.lastRiskAssessment = Date.now();
            
            this.emit('risk_level_changed', { 
                oldLevel: oldLevel,
                newLevel: newRiskLevel,
                score: riskScore
            });
            
            // 根据风险级别采取行动
            await this.handleRiskLevelChange(newRiskLevel);
        }
    }

    /**
     * @description 处理风险级别变化
     * @param {string} riskLevel - 风险级别
     */
    async handleRiskLevelChange(riskLevel) {
        switch (riskLevel) {
            case 'critical':
                // 立即暂停交易
                if (this.services.trader && !this.recoveryState.tradingPaused) {
                    await this.services.trader.pauseTrading('高风险');
                    this.recoveryState.tradingPaused = true;
                }
                break;
                
            case 'high':
                // 减少交易频率
                if (this.services.trader) {
                    await this.services.trader.setTradingMode('conservative');
                    // 高风险也暂停交易
                    if (!this.recoveryState.tradingPaused) {
                        await this.services.trader.pauseTrading('高风险');
                        this.recoveryState.tradingPaused = true;
                    }
                }
                break;
                
            case 'medium':
                // 正常交易但增加监控
                if (this.services.trader) {
                    await this.services.trader.setTradingMode('normal');
                }
                break;
                
            case 'low':
                // 恢复正常交易
                if (this.services.trader && this.recoveryState.tradingPaused) {
                    await this.services.trader.resumeTrading('风险降低');
                    this.recoveryState.tradingPaused = false;
                }
                break;
        }
    }

    /**
     * @description 处理连接降级
     */
    async handleConnectionDegradation() {
        this.logger.warn('检测到连接质量降级');
        
        if (!this.recoveryState.isDegraded) {
            await this.enterDegradationMode();
        }
    }

    /**
     * @description 处理关键错误
     * @param {Error} error - 错误对象
     */
    async handleCriticalError(error) {
        this.logger.error('检测到关键错误:', error);
        
        // 立即进入紧急模式
        await this.enterEmergencyMode();
    }

    /**
     * @description 启动健康检查
     */
    startHealthCheck() {
        if (this.timers.healthCheck) {
            clearInterval(this.timers.healthCheck);
        }
        
        this.timers.healthCheck = setInterval(() => {
            this.performHealthCheck();
        }, this.recoveryConfig.healthCheckInterval);
    }

    /**
     * @description 执行健康检查
     */
    async performHealthCheck() {
        try {
            // 检查连接状态
            if (this.services.websocketManager) {
                const isConnected = this.services.websocketManager.isConnected();
                this.recoveryState.servicesStatus.websocket = isConnected ? 'connected' : 'disconnected';
            }
            
            // 检查数据新鲜度
            const metrics = this.services.connectionMonitor?.getConnectionMetrics();
            if (metrics && metrics.lastMessageTime) {
                const dataAge = Date.now() - metrics.lastMessageTime;
                if (dataAge > this.recoveryConfig.dataStaleThreshold) {
                    this.logger.warn(`数据过期，最后更新时间: ${dataAge}ms前`);
                    this.recoveryState.servicesStatus.data = 'stale';
                } else {
                    this.recoveryState.servicesStatus.data = 'fresh';
                }
            }
            
            // 评估整体健康状况
            const isHealthy = this.isSystemHealthy();
            if (!isHealthy && !this.recoveryState.isRecovering) {
                this.logger.warn('系统健康检查失败，启动恢复流程');
                await this.startRecoveryProcess('health_check');
            }
            
        } catch (error) {
            this.logger.error('健康检查失败:', error);
        }
    }

    /**
     * @description 启动风险评估
     */
    startRiskAssessment() {
        if (this.timers.riskAssessment) {
            clearInterval(this.timers.riskAssessment);
        }
        
        this.timers.riskAssessment = setInterval(() => {
            this.assessRiskLevel();
        }, 60000); // 每分钟评估一次
    }

    /**
     * @description 判断系统是否健康
     * @returns {boolean}
     */
    isSystemHealthy() {
        const criticalServices = ['websocket', 'api'];
        const healthyServices = criticalServices.filter(service => 
            this.recoveryState.servicesStatus[service] === 'connected'
        );
        
        return healthyServices.length >= criticalServices.length * 0.5; // 至少50%的关键服务正常
    }

    /**
     * @description 获取恢复状态
     * @returns {Object}
     */
    getRecoveryState() {
        return {
            ...this.recoveryState,
            config: this.recoveryConfig,
            isHealthy: this.isSystemHealthy()
        };
    }

    /**
     * @description 手动触发恢复
     * @param {string} source - 恢复源
     */
    async triggerManualRecovery(source = 'manual') {
        this.logger.info(`手动触发${source}恢复`);
        
        if (this.recoveryState.isRecovering) {
            this.logger.warn('恢复流程已在进行中');
            return false;
        }
        
        await this.startRecoveryProcess(source);
        return true;
    }

    /**
     * @description 检查是否最近刚恢复连接
     * @param {number} timeWindow - 时间窗口（毫秒），默认30秒
     * @returns {boolean}
     */
    wasRecentlyRecovered(timeWindow = 30000) {
        if (!this.recoveryState.lastRecoveryTime) {
            return false;
        }
        
        const timeSinceRecovery = Date.now() - this.recoveryState.lastRecoveryTime;
        return timeSinceRecovery <= timeWindow;
    }
    
    /**
     * @description 重置恢复状态
     */
    resetRecoveryState() {
        this.logger.info('重置恢复状态');
        
        // 停止所有定时器
        Object.values(this.timers).forEach(timer => {
            if (timer) clearInterval(timer);
        });
        
        // 重置状态
        this.recoveryState.isRecovering = false;
        this.recoveryState.retryCount = 0;
        this.recoveryState.consecutiveFailures = 0;
        this.recoveryState.isDegraded = false;
        this.recoveryState.emergencyModeActive = false;
        this.recoveryState.tradingPaused = false;
        this.recoveryState.riskLevel = 'low';
        
        // 重新启动监控
        this.startHealthCheck();
        this.startRiskAssessment();
        
        this.emit('recovery_state_reset', { timestamp: Date.now() });
    }

    /**
     * @description 睡眠函数
     * @param {number} ms - 毫秒数
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * @description 停止网络恢复管理器
     */
    stop() {
        this.logger.info('停止网络恢复管理器');
        
        // 停止所有定时器
        Object.values(this.timers).forEach(timer => {
            if (timer) clearInterval(timer);
        });
        
        // 停止恢复流程
        this.recoveryState.isRecovering = false;
        
        this.emit('stopped', { timestamp: Date.now() });
    }

    /**
     * @description 销毁网络恢复管理器
     */
    destroy() {
        this.stop();
        this.removeAllListeners();
        NetworkRecoveryManager.instance = null;
    }
}

module.exports = NetworkRecoveryManager;