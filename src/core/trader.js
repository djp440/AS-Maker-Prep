/**
 * @file Trader模块 - 中低频改造版
 * @description GLFT做市策略的中低频改造版交易执行引擎
 * 核心思想从"抢时间"转变为"管库存"
 */

const { EventEmitter } = require('events');
const MidLowFreqGLFTStrategy = require('./mid_low_freq_glft_strategy');
const ExchangeService = require('../services/exchange_service');
const AccountService = require('../services/account_service');
const MarketDataService = require('../services/market_data_service');
const OrderRecoveryManager = require('./order_recovery_manager');
const Logger = require('../shared/logger');
const { getTimestamp, sleep } = require('../shared/utils');

/**
 * @class Trader
 * @description 中低频GLFT策略交易执行引擎
 * 为每个交易对创建一个实例，实现智能交易循环和库存再平衡
 */
class Trader extends EventEmitter {
    /**
     * @param {string} symbol - 交易对符号
     * @param {object} config - 交易配置参数
     */
    constructor(symbol, config) {
        super();
        
        this.symbol = symbol;
        this.config = config;
        
        // 服务实例
        this.exchangeService = ExchangeService;
        this.accountService = AccountService;
        this.marketDataService = MarketDataService;
        
        // 交易状态
        this.isRunning = false;
        this.isPaused = false;
        this.lastUpdateTime = 0;
        this.lastMidPrice = 0;
        this.lastInventory = 0;
        
        // 订单管理
        this.activeOrders = new Map(); // orderId -> orderInfo
        this.lastQuotes = null;
        
        // 订单恢复管理器
        this.orderRecoveryManager = null;
        
        // 定时器
        this.tradingTimer = null;
        this.syncTimer = null;
        
        // 性能统计
        this.stats = {
            totalUpdates: 0,
            successfulUpdates: 0,
            errors: 0,
            lastError: null,
            avgUpdateTime: 0
        };
        
        Logger.info(`Trader initialized for ${symbol}`);
    }
    
    /**
     * 启动交易器
     * @returns {Promise<void>}
     */
    async start() {
        try {
            Logger.info(`Starting trader for ${this.symbol}`);
            
            // 检查服务初始化状态
            if (!this.exchangeService.isInitialized()) {
                throw new Error('ExchangeService not initialized');
            }
            
            if (!this.accountService.isServiceInitialized()) {
                throw new Error('AccountService not initialized');
            }
            
            // 取消所有僵尸订单
            await this.cancelAllZombieOrders();
            
            // 初始化市场数据
            await this.initializeMarketData();
            
            // 启动智能交易循环
            this.isRunning = true;
            this.startIntelligentTradingLoop();
            
            // 启动定期同步
            this.startPeriodicSync();
            
            // 初始化并启动订单恢复管理器
            await this.initializeOrderRecovery();
            
            this.emit('started', { symbol: this.symbol });
            Logger.info(`Trader started successfully for ${this.symbol}`);
            
        } catch (error) {
            Logger.error(`Failed to start trader for ${this.symbol}:`, error);
            this.stats.errors++;
            this.stats.lastError = error.message;
            throw error;
        }
    }
    
    /**
     * 停止交易器
     * @returns {Promise<void>}
     */
    async stop() {
        try {
            Logger.info(`Stopping trader for ${this.symbol}`);
            
            this.isRunning = false;
            
            // 清除定时器
            if (this.tradingTimer) {
                clearTimeout(this.tradingTimer);
                this.tradingTimer = null;
            }
            
            if (this.syncTimer) {
                clearInterval(this.syncTimer);
                this.syncTimer = null;
            }
            
            // 停止订单恢复管理器
            if (this.orderRecoveryManager) {
                this.orderRecoveryManager.stopMonitoring();
                this.orderRecoveryManager.destroy();
                this.orderRecoveryManager = null;
            }
            
            // 取消所有活动订单
            await this.cancelAllActiveOrders();
            
            this.emit('stopped', { symbol: this.symbol });
            Logger.info(`Trader stopped successfully for ${this.symbol}`);
            
        } catch (error) {
            Logger.error(`Error stopping trader for ${this.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * 暂停交易
     */
    pause() {
        this.isPaused = true;
        Logger.info(`Trader paused for ${this.symbol}`);
        this.emit('paused', { symbol: this.symbol });
    }
    
    /**
     * 恢复交易
     */
    resume() {
        this.isPaused = false;
        Logger.info(`Trader resumed for ${this.symbol}`);
        this.emit('resumed', { symbol: this.symbol });
    }
    
    /**
     * 取消所有僵尸订单
     * @returns {Promise<void>}
     */
    async cancelAllZombieOrders() {
        try {
            Logger.info(`Canceling zombie orders for ${this.symbol}`);
            
            const openOrders = await this.exchangeService.fetchOpenOrders(this.symbol);
            
            if (openOrders && openOrders.length > 0) {
                Logger.info(`Found ${openOrders.length} zombie orders for ${this.symbol}`);
                
                const cancelPromises = openOrders.map(order => 
                    this.exchangeService.cancelOrder(order.id, this.symbol)
                        .catch(error => {
                            Logger.warn(`Failed to cancel zombie order ${order.id}:`, error.message);
                        })
                );
                
                await Promise.allSettled(cancelPromises);
                Logger.info(`Zombie orders cleanup completed for ${this.symbol}`);
            }
            
        } catch (error) {
            Logger.error(`Error canceling zombie orders for ${this.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * 初始化市场数据
     * @returns {Promise<void>}
     */
    async initializeMarketData() {
        try {
            const ticker = await this.exchangeService.fetchTicker(this.symbol);
            this.lastMidPrice = (ticker.bid + ticker.ask) / 2;
            this.lastUpdateTime = getTimestamp();
            
            Logger.info(`Market data initialized for ${this.symbol}, mid price: ${this.lastMidPrice}`);
            
        } catch (error) {
            Logger.error(`Failed to initialize market data for ${this.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * 启动智能交易循环
     */
    startIntelligentTradingLoop() {
        const runLoop = async () => {
            if (!this.isRunning) return;
            
            try {
                // 执行交易循环逻辑
                await this.executeTradingCycle();
                
            } catch (error) {
                Logger.error(`Error in trading loop for ${this.symbol}:`, error);
                this.stats.errors++;
                this.stats.lastError = error.message;
                
                // 发出错误事件
                this.emit('error', { symbol: this.symbol, error });
            }
            
            // 计算下次更新间隔
            const updateInterval = this.calculateUpdateInterval();
            
            // 调度下次执行
            if (this.isRunning) {
                this.tradingTimer = setTimeout(runLoop, updateInterval);
            }
        };
        
        // 立即开始第一次循环
        runLoop();
    }
    
    /**
     * 执行交易周期
     * @returns {Promise<void>}
     */
    async executeTradingCycle() {
        const startTime = Date.now();
        
        try {
            // 检查是否暂停
            if (this.isPaused) {
                Logger.debug(`Trading cycle skipped for ${this.symbol} - paused`);
                return;
            }
            
            // 获取当前市场数据
            const marketData = await this.getCurrentMarketData();
            if (!marketData) {
                Logger.warn(`No market data available for ${this.symbol}`);
                return;
            }
            
            // 检查是否需要更新报价
            if (!this.shouldUpdateQuotes(marketData)) {
                return;
            }
            
            // 获取当前库存
            const inventory = this.getCurrentInventory();
            
            // 计算新的报价
            const newQuotes = await this.calculateOptimalQuotes(marketData, inventory);
            
            // 更新订单
            await this.updateOrders(newQuotes);
            
            // 更新状态
            this.lastUpdateTime = getTimestamp();
            this.lastMidPrice = marketData.midPrice;
            this.lastInventory = inventory;
            this.lastQuotes = newQuotes;
            
            // 更新统计
            this.stats.totalUpdates++;
            this.stats.successfulUpdates++;
            
            const updateTime = Date.now() - startTime;
            this.stats.avgUpdateTime = (this.stats.avgUpdateTime * (this.stats.totalUpdates - 1) + updateTime) / this.stats.totalUpdates;
            
            // 发出更新事件
            this.emit('quotesUpdated', {
                symbol: this.symbol,
                quotes: newQuotes,
                inventory,
                updateTime
            });
            
        } catch (error) {
            this.stats.errors++;
            this.stats.lastError = error.message;
            throw error;
        }
    }
    
    /**
     * 获取当前市场数据
     * @returns {Promise<object|null>}
     */
    async getCurrentMarketData() {
        try {
            const ticker = await this.exchangeService.fetchTicker(this.symbol);
            
            return {
                bid: ticker.bid,
                ask: ticker.ask,
                midPrice: (ticker.bid + ticker.ask) / 2,
                spread: ticker.ask - ticker.bid,
                timestamp: ticker.timestamp || getTimestamp()
            };
            
        } catch (error) {
            Logger.error(`Failed to get market data for ${this.symbol}:`, error);
            return null;
        }
    }
    
    /**
     * 获取当前库存
     * @returns {number}
     */
    getCurrentInventory() {
        return this.accountService.getNormalizedInventory(this.symbol);
    }
    
    /**
     * 判断是否需要更新报价
     * @param {object} marketData - 当前市场数据
     * @returns {boolean}
     */
    shouldUpdateQuotes(marketData) {
        const currentTime = getTimestamp();
        const timeSinceLastUpdate = currentTime - this.lastUpdateTime;
        const currentInventory = this.getCurrentInventory();
        
        // 时间触发
        const timeTrigger = timeSinceLastUpdate >= (this.config.REBALANCE_TIME_INTERVAL * 1000);
        
        // 价格变动触发
        const priceChangePct = this.lastMidPrice > 0 ? 
            Math.abs(marketData.midPrice - this.lastMidPrice) / this.lastMidPrice : 0;
        const priceTrigger = priceChangePct >= (this.config.PRICE_MOVE_THRESHOLD_PCT / 100);
        
        // 库存变动触发
        const inventoryChangePct = Math.abs(currentInventory - this.lastInventory);
        const inventoryTrigger = inventoryChangePct >= 0.1; // 10%库存变化
        
        const shouldUpdate = timeTrigger || priceTrigger || inventoryTrigger;
        
        if (shouldUpdate) {
            Logger.debug(`Update triggered for ${this.symbol}: time=${timeTrigger}, price=${priceTrigger}, inventory=${inventoryTrigger}`);
        }
        
        return shouldUpdate;
    }
    
    /**
     * 计算动态更新间隔
     * @returns {number} 更新间隔（毫秒）
     */
    calculateUpdateInterval() {
        const baseInterval = this.config.REBALANCE_TIME_INTERVAL * 1000; // 转换为毫秒
        const inventory = this.getCurrentInventory();
        const inventoryRisk = Math.abs(inventory);
        
        // 根据库存风险调整频率
        if (inventoryRisk < 0.3) {
            return baseInterval; // 低风险，标准间隔
        } else if (inventoryRisk < 0.7) {
            return baseInterval * 0.5; // 中风险，加快50%
        } else {
            return baseInterval * 0.25; // 高风险，加快75%
        }
    }
    
    /**
     * 计算最优报价
     * @param {object} marketData - 市场数据
     * @param {number} inventory - 当前库存
     * @returns {Promise<object>}
     */
    async calculateOptimalQuotes(marketData, inventory) {
        try {
            // 准备策略输入参数
            const strategyInputs = {
                midPrice: marketData.midPrice,
                halfSpreadPct: this.config.HALF_SPREAD_PCT / 100,
                volatility: 0.02, // 这里应该从历史数据计算，暂时使用固定值
                riskAversion: this.config.RISK_AVERSION,
                inventory: inventory,
                useTraditionalGLFT: this.config.USE_TRADITIONAL_GLFT
            };
            
            // 使用策略模块计算报价
            const quotes = MidLowFreqGLFTStrategy.calculateOptimalQuotes(strategyInputs);
            
            // 检查库存限制
            const inventoryCheck = MidLowFreqGLFTStrategy.checkInventoryLimits(
                inventory, 
                this.config.MAX_INVENTORY_Q
            );
            
            // 根据库存限制调整报价
            if (!inventoryCheck.canBuy) {
                quotes.bidPrice = 0; // 禁止买入
            }
            
            if (!inventoryCheck.canSell) {
                quotes.askPrice = Number.MAX_SAFE_INTEGER; // 禁止卖出
            }
            
            return {
                bidPrice: quotes.bidPrice,
                askPrice: quotes.askPrice,
                bidAmount: this.config.ORDER_AMOUNT,
                askAmount: this.config.ORDER_AMOUNT,
                timestamp: getTimestamp(),
                inventoryCheck
            };
            
        } catch (error) {
            Logger.error(`Failed to calculate quotes for ${this.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * 更新订单
     * @param {object} newQuotes - 新的报价
     * @returns {Promise<void>}
     */
    async updateOrders(newQuotes) {
        try {
            // 获取当前活动订单
            const currentOrders = await this.getCurrentActiveOrders();
            
            // 分析需要的操作
            const operations = this.analyzeOrderOperations(currentOrders, newQuotes);
            
            // 执行批量操作
            await this.executeBatchOrderOperations(operations);
            
        } catch (error) {
            Logger.error(`Failed to update orders for ${this.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * 获取当前活动订单
     * @returns {Promise<Array>}
     */
    async getCurrentActiveOrders() {
        try {
            const orders = await this.exchangeService.fetchOpenOrders(this.symbol);
            return orders || [];
        } catch (error) {
            Logger.error(`Failed to fetch active orders for ${this.symbol}:`, error);
            return [];
        }
    }
    
    /**
     * 分析订单操作
     * @param {Array} currentOrders - 当前订单
     * @param {object} newQuotes - 新报价
     * @returns {object}
     */
    analyzeOrderOperations(currentOrders, newQuotes) {
        const operations = {
            toCancel: [],
            toCreate: []
        };
        
        // 找出需要取消的订单
        currentOrders.forEach(order => {
            const shouldCancel = this.shouldCancelOrder(order, newQuotes);
            if (shouldCancel) {
                operations.toCancel.push(order);
            }
        });
        
        // 确定需要创建的新订单
        if (newQuotes.bidPrice > 0 && newQuotes.inventoryCheck.canBuy) {
            operations.toCreate.push({
                side: 'buy',
                type: 'limit',
                amount: newQuotes.bidAmount,
                price: newQuotes.bidPrice
            });
        }
        
        if (newQuotes.askPrice < Number.MAX_SAFE_INTEGER && newQuotes.inventoryCheck.canSell) {
            operations.toCreate.push({
                side: 'sell',
                type: 'limit',
                amount: newQuotes.askAmount,
                price: newQuotes.askPrice
            });
        }
        
        return operations;
    }
    
    /**
     * 判断是否应该取消订单
     * @param {object} order - 订单信息
     * @param {object} newQuotes - 新报价
     * @returns {boolean}
     */
    shouldCancelOrder(order, newQuotes) {
        const minPriceChange = 0.001; // 最小价格变化阈值
        
        if (order.side === 'buy') {
            return Math.abs(order.price - newQuotes.bidPrice) > minPriceChange;
        } else if (order.side === 'sell') {
            return Math.abs(order.price - newQuotes.askPrice) > minPriceChange;
        }
        
        return false;
    }
    
    /**
     * 执行批量订单操作
     * @param {object} operations - 操作列表
     * @returns {Promise<void>}
     */
    async executeBatchOrderOperations(operations) {
        try {
            // 先取消订单
            if (operations.toCancel.length > 0) {
                Logger.debug(`Canceling ${operations.toCancel.length} orders for ${this.symbol}`);
                
                const cancelPromises = operations.toCancel.map(order =>
                    this.exchangeService.cancelOrder(order.id, this.symbol)
                        .catch(error => {
                            Logger.warn(`Failed to cancel order ${order.id}:`, error.message);
                        })
                );
                
                await Promise.allSettled(cancelPromises);
            }
            
            // 等待一小段时间确保取消操作完成
            if (operations.toCancel.length > 0) {
                await sleep(100);
            }
            
            // 创建新订单
            if (operations.toCreate.length > 0) {
                Logger.debug(`Creating ${operations.toCreate.length} orders for ${this.symbol}`);
                
                const createPromises = operations.toCreate.map(orderSpec =>
                    this.exchangeService.createOrder(
                        this.symbol,
                        orderSpec.type,
                        orderSpec.side,
                        orderSpec.amount,
                        orderSpec.price
                    ).catch(error => {
                        Logger.warn(`Failed to create ${orderSpec.side} order:`, error.message);
                    })
                );
                
                await Promise.allSettled(createPromises);
            }
            
        } catch (error) {
            Logger.error(`Error in batch order operations for ${this.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * 取消所有活动订单
     * @returns {Promise<void>}
     */
    async cancelAllActiveOrders() {
        try {
            const orders = await this.getCurrentActiveOrders();
            
            if (orders.length > 0) {
                Logger.info(`Canceling ${orders.length} active orders for ${this.symbol}`);
                
                const cancelPromises = orders.map(order =>
                    this.exchangeService.cancelOrder(order.id, this.symbol)
                        .catch(error => {
                            Logger.warn(`Failed to cancel order ${order.id}:`, error.message);
                        })
                );
                
                await Promise.allSettled(cancelPromises);
            }
            
        } catch (error) {
            Logger.error(`Error canceling active orders for ${this.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * 初始化订单恢复管理器
     * @private
     * @returns {Promise<void>}
     */
    async initializeOrderRecovery() {
        try {
            // 创建订单恢复管理器实例
            this.orderRecoveryManager = new OrderRecoveryManager({
                exchangeService: this.exchangeService,
                accountService: this.accountService,
                websocketManager: this.marketDataService.websocketManager
            }, {
                // 恢复配置
                autoRecoveryEnabled: true,
                conservativeMode: false, // 积极模式：取消并重建订单
                maxRecoveryAttempts: 3,
                orderSyncDelay: 2000,
                
                // 针对当前交易对的配置
                targetSymbol: this.symbol
            });
            
            // 设置事件监听器
            this.setupRecoveryEventListeners();
            
            // 启动监控
            await this.orderRecoveryManager.startMonitoring();
            
            Logger.info(`Order recovery manager initialized for ${this.symbol}`);
            
        } catch (error) {
            Logger.error(`Failed to initialize order recovery for ${this.symbol}:`, error);
            // 不抛出错误，允许交易器继续运行
        }
    }
    
    /**
     * 设置订单恢复事件监听器
     * @private
     */
    setupRecoveryEventListeners() {
        if (!this.orderRecoveryManager) {
            return;
        }
        
        // 监听恢复完成事件
        this.orderRecoveryManager.on('recovery_completed', (result) => {
            Logger.info(`Order recovery completed for ${this.symbol}:`, result);
            this.emit('order_recovery_completed', { symbol: this.symbol, result });
            
            // 恢复完成后，重新启动交易循环
            this.handlePostRecoveryActions(result);
        });
        
        // 监听恢复失败事件
        this.orderRecoveryManager.on('recovery_failed', (error) => {
            Logger.error(`Order recovery failed for ${this.symbol}:`, error);
            this.emit('order_recovery_failed', { symbol: this.symbol, error });
            
            // 恢复失败时的处理
            this.handleRecoveryFailure(error);
        });
        
        // 监听连接丢失事件
        this.orderRecoveryManager.on('connection_lost', () => {
            Logger.warn(`Connection lost detected for ${this.symbol}`);
            
            // 暂停交易循环
            this.pause();
            this.emit('connection_lost', { symbol: this.symbol });
        });
        
        // 监听恢复放弃事件
        this.orderRecoveryManager.on('recovery_abandoned', () => {
            Logger.error(`Order recovery abandoned for ${this.symbol}`);
            this.emit('order_recovery_abandoned', { symbol: this.symbol });
            
            // 可以选择停止交易器或采取其他措施
            this.handleRecoveryAbandoned();
        });
    }
    
    /**
     * 处理恢复后的操作
     * @private
     * @param {Object} result - 恢复结果
     */
    async handlePostRecoveryActions(result) {
        try {
            // 如果交易器被暂停，恢复运行
            if (this.isPaused) {
                Logger.info(`Resuming trader for ${this.symbol} after successful recovery`);
                this.resume();
            }
            
            // 强制同步账户数据
            await this.accountService.forceSyncData();
            
            // 清除本地订单缓存，强制重新获取
            this.activeOrders.clear();
            
            // 触发一次立即的交易周期
            if (this.isRunning && !this.isPaused) {
                setTimeout(() => {
                    this.executeTradingCycle().catch(error => {
                        Logger.error(`Error in post-recovery trading cycle for ${this.symbol}:`, error);
                    });
                }, 1000); // 延迟1秒执行
            }
            
        } catch (error) {
            Logger.error(`Error in post-recovery actions for ${this.symbol}:`, error);
        }
    }
    
    /**
     * 处理恢复失败
     * @private
     * @param {Error} error - 错误信息
     */
    handleRecoveryFailure(error) {
        try {
            // 记录错误统计
            this.stats.errors++;
            this.stats.lastError = error.message;
            
            // 如果交易器正在运行，可以选择暂停或继续
            if (this.isRunning && !this.isPaused) {
                Logger.warn(`Continuing trading for ${this.symbol} despite recovery failure`);
                // 可以选择暂停交易器
                // this.pause();
            }
            
        } catch (err) {
            Logger.error(`Error handling recovery failure for ${this.symbol}:`, err);
        }
    }
    
    /**
     * 处理恢复放弃
     * @private
     */
    handleRecoveryAbandoned() {
        try {
            Logger.warn(`Order recovery abandoned for ${this.symbol}, pausing trader`);
            
            // 暂停交易器
            this.pause();
            
            // 可以选择发送告警或通知
            this.emit('critical_error', {
                symbol: this.symbol,
                type: 'recovery_abandoned',
                message: 'Order recovery has been abandoned after multiple attempts'
            });
            
        } catch (error) {
            Logger.error(`Error handling recovery abandonment for ${this.symbol}:`, error);
        }
    }
    
    /**
     * 手动触发订单恢复
     * @returns {Promise<Object>}
     */
    async triggerOrderRecovery() {
        try {
            if (!this.orderRecoveryManager) {
                throw new Error('Order recovery manager not initialized');
            }
            
            Logger.info(`Manually triggering order recovery for ${this.symbol}`);
            
            const result = await this.orderRecoveryManager.triggerManualRecovery(this.symbol);
            
            Logger.info(`Manual order recovery completed for ${this.symbol}:`, result);
            return result;
            
        } catch (error) {
            Logger.error(`Manual order recovery failed for ${this.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * 获取订单恢复统计信息
     * @returns {Object|null}
     */
    getOrderRecoveryStats() {
        if (!this.orderRecoveryManager) {
            return null;
        }
        
        return this.orderRecoveryManager.getRecoveryStats();
    }
    
    /**
     * 启动定期同步
     */
    startPeriodicSync() {
        this.syncTimer = setInterval(async () => {
            try {
                if (this.isRunning && !this.isPaused) {
                    // 定期同步账户数据
                    await this.accountService.forceSyncData();
                }
            } catch (error) {
                Logger.error(`Error in periodic sync for ${this.symbol}:`, error);
            }
        }, 30000); // 30秒同步一次
    }
    
    /**
     * 获取交易统计
     * @returns {object}
     */
    getStats() {
        return {
            ...this.stats,
            symbol: this.symbol,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            lastUpdateTime: this.lastUpdateTime,
            currentInventory: this.getCurrentInventory()
        };
    }
    
    /**
     * 重置统计
     */
    resetStats() {
        this.stats = {
            totalUpdates: 0,
            successfulUpdates: 0,
            errors: 0,
            lastError: null,
            avgUpdateTime: 0
        };
    }
}

module.exports = Trader;