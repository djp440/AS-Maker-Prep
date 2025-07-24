/**
 * @file OrderRecoveryManager - 网络异常时的订单状态恢复机制
 * @description 处理网络异常恢复后的订单状态同步和恢复策略
 */

const { EventEmitter } = require('events');
const Logger = require('../shared/logger');
const { sleep, getTimestamp } = require('../shared/utils');
const ConnectionMonitor = require('../monitoring/connection_monitor');

/**
 * @class OrderRecoveryManager
 * @description 订单状态恢复管理器
 * 负责在网络异常恢复后同步和恢复订单状态
 */
class OrderRecoveryManager extends EventEmitter {
    /**
     * @param {Object} services - 服务依赖
     * @param {Object} config - 配置参数
     */
    constructor(services, config = {}) {
        super();
        
        this.services = {
            exchangeService: services.exchangeService,
            accountService: services.accountService,
            websocketManager: services.websocketManager
        };
        
        this.config = {
            // 恢复检测配置
            recoveryCheckInterval: config.recoveryCheckInterval || 5000, // 5秒检查一次
            maxRecoveryAttempts: config.maxRecoveryAttempts || 3,
            recoveryTimeout: config.recoveryTimeout || 30000, // 30秒超时
            
            // 订单同步配置
            orderSyncDelay: config.orderSyncDelay || 2000, // 恢复后等待2秒再同步
            maxOrderAge: config.maxOrderAge || 300000, // 5分钟内的订单才处理
            batchSyncSize: config.batchSyncSize || 10, // 批量同步大小
            
            // 状态检查配置
            stateCheckRetries: config.stateCheckRetries || 3,
            stateCheckDelay: config.stateCheckDelay || 1000,
            
            // 恢复策略配置
            autoRecoveryEnabled: config.autoRecoveryEnabled !== false,
            conservativeMode: config.conservativeMode || false, // 保守模式：只取消，不重建
            allowPartialRecovery: config.allowPartialRecovery !== false
        };
        
        // 状态管理
        this.isMonitoring = false;
        this.isRecovering = false;
        this.lastNetworkState = 'unknown';
        this.recoveryAttempts = 0;
        
        // 订单状态缓存
        this.orderStateCache = new Map(); // symbol -> { orders, timestamp }
        this.pendingRecoveries = new Map(); // symbol -> recovery info
        
        // 统计信息
        this.stats = {
            totalRecoveries: 0,
            successfulRecoveries: 0,
            failedRecoveries: 0,
            ordersRecovered: 0,
            ordersCanceled: 0,
            lastRecoveryTime: null,
            averageRecoveryTime: 0
        };
        
        // 定时器
        this.monitoringTimer = null;
        
        Logger.info('OrderRecoveryManager initialized');
    }
    
    /**
     * 启动恢复监控
     * @returns {Promise<void>}
     */
    async startMonitoring() {
        if (this.isMonitoring) {
            Logger.warn('OrderRecoveryManager already monitoring');
            return;
        }
        
        try {
            // 设置连接状态监听
            this.setupConnectionListeners();
            
            // 启动定期检查
            this.startPeriodicCheck();
            
            this.isMonitoring = true;
            this.emit('monitoring_started');
            
            Logger.info('OrderRecoveryManager monitoring started');
            
        } catch (error) {
            Logger.error('Failed to start OrderRecoveryManager monitoring:', error);
            throw error;
        }
    }
    
    /**
     * 停止恢复监控
     */
    stopMonitoring() {
        if (!this.isMonitoring) {
            return;
        }
        
        // 清理定时器
        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
            this.monitoringTimer = null;
        }
        
        // 移除监听器
        this.removeAllListeners();
        
        this.isMonitoring = false;
        this.emit('monitoring_stopped');
        
        Logger.info('OrderRecoveryManager monitoring stopped');
    }
    
    /**
     * 设置连接状态监听器
     * @private
     */
    setupConnectionListeners() {
        // 监听连接状态变化
        ConnectionMonitor.on('connection_restored', this.handleConnectionRestored.bind(this));
        ConnectionMonitor.on('connection_lost', this.handleConnectionLost.bind(this));
        
        // 监听WebSocket事件
        if (this.services.websocketManager) {
            this.services.websocketManager.on('open', this.handleWebSocketOpen.bind(this));
            this.services.websocketManager.on('close', this.handleWebSocketClose.bind(this));
            this.services.websocketManager.on('error', this.handleWebSocketError.bind(this));
        }
    }
    
    /**
     * 启动定期检查
     * @private
     */
    startPeriodicCheck() {
        this.monitoringTimer = setInterval(async () => {
            try {
                await this.performRecoveryCheck();
            } catch (error) {
                Logger.error('Error in periodic recovery check:', error);
            }
        }, this.config.recoveryCheckInterval);
    }
    
    /**
     * 执行恢复检查
     * @private
     */
    async performRecoveryCheck() {
        if (this.isRecovering) {
            return; // 正在恢复中，跳过检查
        }
        
        try {
            // 检查网络状态
            const currentNetworkState = await this.checkNetworkState();
            
            // 检测网络恢复
            if (this.lastNetworkState === 'disconnected' && currentNetworkState === 'connected') {
                Logger.info('Network recovery detected, initiating order recovery');
                await this.initiateOrderRecovery();
            }
            
            this.lastNetworkState = currentNetworkState;
            
        } catch (error) {
            Logger.error('Error in recovery check:', error);
        }
    }
    
    /**
     * 检查网络状态
     * @private
     * @returns {Promise<string>}
     */
    async checkNetworkState() {
        try {
            // 检查API连接
            const apiAvailable = await this.checkApiConnection();
            
            // 检查WebSocket连接
            const wsConnected = this.checkWebSocketConnection();
            
            if (apiAvailable && wsConnected) {
                return 'connected';
            } else if (!apiAvailable && !wsConnected) {
                return 'disconnected';
            } else {
                return 'partial';
            }
            
        } catch (error) {
            Logger.error('Error checking network state:', error);
            return 'unknown';
        }
    }
    
    /**
     * 检查API连接
     * @private
     * @returns {Promise<boolean>}
     */
    async checkApiConnection() {
        try {
            if (!this.services.exchangeService) {
                return false;
            }
            
            // 尝试获取服务器时间（轻量级API调用）
            await this.services.exchangeService.fetchTime();
            return true;
            
        } catch (error) {
            return false;
        }
    }
    
    /**
     * 检查WebSocket连接
     * @private
     * @returns {boolean}
     */
    checkWebSocketConnection() {
        if (!this.services.websocketManager) {
            return false;
        }
        
        try {
            const state = this.services.websocketManager.getConnectionState ? 
                this.services.websocketManager.getConnectionState() : 
                this.services.websocketManager.connectionState || 'unknown';
            
            return state === 'open' || state === 'connected';
            
        } catch (error) {
            return false;
        }
    }
    
    /**
     * 处理连接恢复事件
     * @private
     */
    async handleConnectionRestored() {
        Logger.info('Connection restored event received');
        
        if (!this.config.autoRecoveryEnabled) {
            Logger.info('Auto recovery disabled, skipping order recovery');
            return;
        }
        
        // 延迟一段时间再开始恢复，确保连接稳定
        await sleep(this.config.orderSyncDelay);
        
        await this.initiateOrderRecovery();
    }
    
    /**
     * 处理连接丢失事件
     * @private
     */
    handleConnectionLost() {
        Logger.warn('Connection lost event received');
        
        // 缓存当前订单状态
        this.cacheCurrentOrderStates();
        
        this.emit('connection_lost');
    }
    
    /**
     * 处理WebSocket打开事件
     * @private
     */
    async handleWebSocketOpen() {
        Logger.info('WebSocket connection opened');
        
        if (this.lastNetworkState === 'disconnected') {
            await this.handleConnectionRestored();
        }
    }
    
    /**
     * 处理WebSocket关闭事件
     * @private
     */
    handleWebSocketClose() {
        Logger.warn('WebSocket connection closed');
        this.handleConnectionLost();
    }
    
    /**
     * 处理WebSocket错误事件
     * @private
     */
    handleWebSocketError(error) {
        Logger.error('WebSocket error:', error);
        this.emit('websocket_error', error);
    }
    
    /**
     * 缓存当前订单状态
     * @private
     */
    async cacheCurrentOrderStates() {
        try {
            // 这里可以根据实际需要缓存特定交易对的订单状态
            // 暂时记录缓存时间
            const timestamp = Date.now();
            Logger.debug(`Order states cached at ${new Date(timestamp).toISOString()}`);
            
        } catch (error) {
            Logger.error('Error caching order states:', error);
        }
    }
    
    /**
     * 启动订单恢复流程
     * @private
     */
    async initiateOrderRecovery() {
        if (this.isRecovering) {
            Logger.warn('Order recovery already in progress');
            return;
        }
        
        this.isRecovering = true;
        this.recoveryAttempts++;
        const startTime = Date.now();
        
        try {
            Logger.info(`Starting order recovery attempt ${this.recoveryAttempts}`);
            
            // 执行恢复流程
            const result = await this.executeOrderRecovery();
            
            // 更新统计
            const recoveryTime = Date.now() - startTime;
            this.updateRecoveryStats(true, recoveryTime, result);
            
            this.emit('recovery_completed', result);
            Logger.info(`Order recovery completed successfully in ${recoveryTime}ms`);
            
        } catch (error) {
            const recoveryTime = Date.now() - startTime;
            this.updateRecoveryStats(false, recoveryTime);
            
            Logger.error(`Order recovery failed after ${recoveryTime}ms:`, error);
            this.emit('recovery_failed', error);
            
            // 如果还有重试次数，安排下次重试
            if (this.recoveryAttempts < this.config.maxRecoveryAttempts) {
                Logger.info(`Scheduling retry in ${this.config.recoveryCheckInterval}ms`);
                setTimeout(() => {
                    this.initiateOrderRecovery();
                }, this.config.recoveryCheckInterval);
            } else {
                Logger.error('Max recovery attempts reached, giving up');
                this.emit('recovery_abandoned');
            }
            
        } finally {
            this.isRecovering = false;
        }
    }
    
    /**
     * 执行订单恢复
     * @private
     * @returns {Promise<Object>}
     */
    async executeOrderRecovery() {
        const result = {
            symbolsProcessed: 0,
            ordersRecovered: 0,
            ordersCanceled: 0,
            errors: []
        };
        
        try {
            // 获取所有需要恢复的交易对
            const symbols = await this.getSymbolsForRecovery();
            
            Logger.info(`Processing ${symbols.length} symbols for order recovery`);
            
            // 逐个处理交易对
            for (const symbol of symbols) {
                try {
                    const symbolResult = await this.recoverOrdersForSymbol(symbol);
                    
                    result.symbolsProcessed++;
                    result.ordersRecovered += symbolResult.ordersRecovered;
                    result.ordersCanceled += symbolResult.ordersCanceled;
                    
                } catch (error) {
                    Logger.error(`Error recovering orders for ${symbol}:`, error);
                    result.errors.push({ symbol, error: error.message });
                    // 继续处理其他交易对，不抛出错误
                }
            }
            
            // 更新统计信息 - 如果有错误则标记为失败
            const hasErrors = result.errors.length > 0;
            this.updateRecoveryStats(!hasErrors, 0, result);
            
            if (hasErrors) {
                this.emit('recovery_failed', result);
            }
            
            return result;
            
        } catch (error) {
            Logger.error('Error in order recovery execution:', error);
            // 更新失败统计
            this.updateRecoveryStats(false, 0);
            throw error;
        }
    }
    
    /**
     * 获取需要恢复的交易对列表
     * @private
     * @returns {Promise<Array<string>>}
     */
    async getSymbolsForRecovery() {
        try {
            // 如果配置中指定了目标交易对，只恢复该交易对
            if (this.config.targetSymbol) {
                return [this.config.targetSymbol];
            }
            
            // 否则可以根据实际需要获取活跃的交易对
            // 这里可以从交易器管理器或配置中获取
            return ['BTC/USDT', 'ETH/USDT']; // 示例
            
        } catch (error) {
            Logger.error('Error getting symbols for recovery:', error);
            return [];
        }
    }
    
    /**
     * 恢复特定交易对的订单
     * @private
     * @param {string} symbol - 交易对
     * @returns {Promise<Object>}
     */
    async recoverOrdersForSymbol(symbol) {
        const result = {
            ordersRecovered: 0,
            ordersCanceled: 0
        };
        
        try {
            Logger.debug(`Starting order recovery for ${symbol}`);
            
            // 1. 获取当前活跃订单
            const currentOrders = await this.getCurrentOrders(symbol);
            
            // 2. 分析订单状态
            const analysis = await this.analyzeOrderStates(symbol, currentOrders);
            
            // 3. 执行恢复策略
            if (this.config.conservativeMode) {
                // 保守模式：只取消可能有问题的订单
                result.ordersCanceled = await this.cancelProblematicOrders(symbol, analysis.problematicOrders);
            } else {
                // 积极模式：取消并重建订单
                result.ordersCanceled = await this.cancelProblematicOrders(symbol, analysis.problematicOrders);
                
                if (analysis.needsRebuilding) {
                    result.ordersRecovered = await this.rebuildOrders(symbol, analysis.expectedOrders);
                }
            }
            
            Logger.debug(`Order recovery completed for ${symbol}: recovered=${result.ordersRecovered}, canceled=${result.ordersCanceled}`);
            
            return result;
            
        } catch (error) {
            Logger.error(`Error in order recovery for ${symbol}:`, error);
            // 检查是否是网络错误，如果是则抛出错误
            if (error.message && (error.message.includes('Network error') || error.message.includes('network') || error.message.includes('connection'))) {
                throw error;
            }
            // 其他错误返回空结果，不中断整个恢复流程
            return result;
        }
    }
    
    /**
     * 获取当前订单
     * @private
     * @param {string} symbol - 交易对
     * @returns {Promise<Array>}
     */
    async getCurrentOrders(symbol) {
        try {
            if (!this.services.exchangeService) {
                throw new Error('ExchangeService not available');
            }
            
            const orders = await this.services.exchangeService.fetchOpenOrders(symbol);
            return orders || [];
            
        } catch (error) {
            Logger.error(`Error fetching current orders for ${symbol}:`, error);
            // 检查是否是网络错误，如果是则抛出错误
            if (error.message && (error.message.includes('Network error') || error.message.includes('network') || error.message.includes('connection'))) {
                throw error;
            }
            return [];
        }
    }
    
    /**
     * 分析订单状态
     * @private
     * @param {string} symbol - 交易对
     * @param {Array} currentOrders - 当前订单
     * @returns {Promise<Object>}
     */
    async analyzeOrderStates(symbol, currentOrders) {
        const analysis = {
            problematicOrders: [],
            validOrders: [],
            needsRebuilding: false,
            expectedOrders: []
        };
        
        try {
            const now = Date.now();
            
            // 分析每个订单
            for (const order of currentOrders) {
                const orderAge = now - (order.timestamp || 0);
                
                // 检查订单是否过期
                if (orderAge > this.config.maxOrderAge) {
                    analysis.problematicOrders.push(order);
                    continue;
                }
                
                // 检查订单状态
                if (order.status === 'open' || order.status === 'pending') {
                    analysis.validOrders.push(order);
                } else {
                    analysis.problematicOrders.push(order);
                }
            }
            
            // 判断是否需要重建订单
            analysis.needsRebuilding = analysis.validOrders.length === 0 && !this.config.conservativeMode;
            
            Logger.debug(`Order analysis for ${symbol}: valid=${analysis.validOrders.length}, problematic=${analysis.problematicOrders.length}, needsRebuilding=${analysis.needsRebuilding}`);
            
            return analysis;
            
        } catch (error) {
            Logger.error(`Error analyzing order states for ${symbol}:`, error);
            return analysis;
        }
    }
    
    /**
     * 取消有问题的订单
     * @private
     * @param {string} symbol - 交易对
     * @param {Array} orders - 要取消的订单
     * @returns {Promise<number>}
     */
    async cancelProblematicOrders(symbol, orders) {
        let canceledCount = 0;
        
        if (orders.length === 0) {
            return canceledCount;
        }
        
        try {
            Logger.info(`Canceling ${orders.length} problematic orders for ${symbol}`);
            
            // 批量取消订单
            const cancelPromises = orders.map(async (order) => {
                try {
                    await this.services.exchangeService.cancelOrder(order.id, symbol);
                    canceledCount++;
                    Logger.debug(`Canceled order ${order.id} for ${symbol}`);
                } catch (error) {
                    Logger.warn(`Failed to cancel order ${order.id} for ${symbol}:`, error.message);
                }
            });
            
            await Promise.allSettled(cancelPromises);
            
            Logger.info(`Successfully canceled ${canceledCount}/${orders.length} orders for ${symbol}`);
            
            return canceledCount;
            
        } catch (error) {
            Logger.error(`Error canceling orders for ${symbol}:`, error);
            return canceledCount;
        }
    }
    
    /**
     * 重建订单
     * @private
     * @param {string} symbol - 交易对
     * @param {Array} expectedOrders - 期望的订单
     * @returns {Promise<number>}
     */
    async rebuildOrders(symbol, expectedOrders) {
        let rebuiltCount = 0;
        
        try {
            // 这里应该根据实际的交易策略来重建订单
            // 暂时返回0，表示没有重建订单
            Logger.debug(`Order rebuilding for ${symbol} - feature not implemented yet`);
            
            return rebuiltCount;
            
        } catch (error) {
            Logger.error(`Error rebuilding orders for ${symbol}:`, error);
            return rebuiltCount;
        }
    }
    
    /**
     * 更新恢复统计
     * @private
     * @param {boolean} success - 是否成功
     * @param {number} recoveryTime - 恢复时间
     * @param {Object} result - 恢复结果
     */
    updateRecoveryStats(success, recoveryTime, result = {}) {
        this.stats.totalRecoveries++;
        
        if (success) {
            this.stats.successfulRecoveries++;
            this.stats.ordersRecovered += result.ordersRecovered || 0;
            this.stats.ordersCanceled += result.ordersCanceled || 0;
        } else {
            this.stats.failedRecoveries++;
        }
        
        this.stats.lastRecoveryTime = Date.now();
        
        // 计算平均恢复时间
        if (this.stats.totalRecoveries > 0) {
            this.stats.averageRecoveryTime = 
                (this.stats.averageRecoveryTime * (this.stats.totalRecoveries - 1) + recoveryTime) / 
                this.stats.totalRecoveries;
        }
    }
    
    /**
     * 手动触发订单恢复
     * @param {string} symbol - 可选的特定交易对
     * @returns {Promise<Object>}
     */
    async triggerManualRecovery(symbol = null) {
        try {
            Logger.info(`Manual order recovery triggered${symbol ? ` for ${symbol}` : ''}`);
            
            if (symbol) {
                // 恢复特定交易对
                const result = await this.recoverOrdersForSymbol(symbol);
                this.emit('manual_recovery_completed', { symbol, result });
                return { [symbol]: result };
            } else {
                // 恢复所有交易对
                const result = await this.executeOrderRecovery();
                this.emit('manual_recovery_completed', result);
                return result;
            }
            
        } catch (error) {
            Logger.error('Manual recovery failed:', error);
            this.emit('manual_recovery_failed', error);
            throw error;
        }
    }
    
    /**
     * 获取恢复统计信息
     * @returns {Object}
     */
    getRecoveryStats() {
        return {
            ...this.stats,
            isMonitoring: this.isMonitoring,
            isRecovering: this.isRecovering,
            recoveryAttempts: this.recoveryAttempts,
            lastNetworkState: this.lastNetworkState,
            config: {
                autoRecoveryEnabled: this.config.autoRecoveryEnabled,
                conservativeMode: this.config.conservativeMode,
                maxRecoveryAttempts: this.config.maxRecoveryAttempts
            }
        };
    }
    
    /**
     * 更新配置
     * @param {Object} newConfig - 新配置
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        Logger.info('OrderRecoveryManager configuration updated');
        this.emit('config_updated', this.config);
    }
    
    /**
     * 重置统计信息
     */
    resetStats() {
        this.stats = {
            totalRecoveries: 0,
            successfulRecoveries: 0,
            failedRecoveries: 0,
            ordersRecovered: 0,
            ordersCanceled: 0,
            lastRecoveryTime: null,
            averageRecoveryTime: 0
        };
        
        this.recoveryAttempts = 0;
        
        Logger.info('OrderRecoveryManager stats reset');
        this.emit('stats_reset');
    }
    
    /**
     * 销毁恢复管理器
     */
    destroy() {
        this.stopMonitoring();
        this.orderStateCache.clear();
        this.pendingRecoveries.clear();
        this.removeAllListeners();
        
        Logger.info('OrderRecoveryManager destroyed');
    }
}

module.exports = OrderRecoveryManager;