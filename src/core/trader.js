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
const NetworkRecoveryManager = require('./network_recovery_manager');
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
        this.websocketManager = require('../services/websocket_manager');
        
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
        
        // 网络恢复管理器
        this.networkRecoveryManager = null;
        
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
            
            // 初始化网络恢复管理器
            await this.initializeNetworkRecovery();
            
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
            
            // 停止网络恢复管理器
            if (this.networkRecoveryManager) {
                this.networkRecoveryManager.stop();
                this.networkRecoveryManager.destroy();
                this.networkRecoveryManager = null;
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
                
                const cancelPromises = openOrders.map(async (order) => {
                    try {
                        const result = await this.exchangeService.cancelOrder(order.id, this.symbol);
                        if (result === null) {
                            Logger.debug(`僵尸订单 ${order.id} 已不存在，可能已成交或过期`);
                        } else {
                            Logger.debug(`成功取消僵尸订单 ${order.id}`);
                        }
                        return result;
                    } catch (error) {
                        Logger.warn(`Failed to cancel zombie order ${order.id}:`, error.message);
                        return null;
                    }
                });
                
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
                Logger.error(`[${this.symbol}] 交易循环错误:`, {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                    code: error.code
                });
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
            Logger.info(`[${this.symbol}] 执行交易循环...`);
            
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
            
            Logger.info(`[${this.symbol}] 市场数据: 中间价=${marketData.midPrice}, 买价=${marketData.bid}, 卖价=${marketData.ask}`);
            
            // 检查是否需要更新报价
            const shouldUpdate = this.shouldUpdateQuotes(marketData);
            Logger.info(`[${this.symbol}] 是否需要更新报价: ${shouldUpdate}`);
            
            if (!shouldUpdate) {
                return;
            }
            
            // 获取当前库存
            const inventory = this.getCurrentInventory();
            Logger.info(`[${this.symbol}] 当前库存: ${JSON.stringify(inventory)}`);
            
            // 计算新的报价
            const newQuotes = await this.calculateOptimalQuotes(marketData, inventory);
            Logger.info(`[${this.symbol}] 新报价: 买价=${newQuotes.bidPrice}, 卖价=${newQuotes.askPrice}, 买量=${newQuotes.bidSize}, 卖量=${newQuotes.askSize}`);
            
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
            
            Logger.info(`[${this.symbol}] 交易循环完成，耗时: ${updateTime}ms`);
            
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
            Logger.error(`[${this.symbol}] executeTradingCycle错误:`, {
                message: error.message,
                stack: error.stack,
                name: error.name,
                code: error.code
            });
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
        const currentPosition = this.accountService.getPosition(this.symbol);
        
        // 首次启动触发（如果从未下过单）
        const firstTimeTrigger = !this.lastQuotes;
        
        // 初始化上次持仓记录
        if (!this.lastPosition) {
            this.lastPosition = currentPosition ? { ...currentPosition } : { contracts: 0, side: null };
        }
        
        // 检查是否有挂单被触发（通过比较当前持仓与上次记录的持仓）
        const positionChanged = this.lastPosition && currentPosition &&
            (Math.abs(currentPosition.contracts - this.lastPosition.contracts) > 0.001);
        const orderFilledTrigger = positionChanged;
        
        // 连接中断导致价格完全偏离挂单范围
        const connectionRecoveryTrigger = this.networkRecoveryManager && 
            typeof this.networkRecoveryManager.wasRecentlyRecovered === 'function' &&
            this.networkRecoveryManager.wasRecentlyRecovered();
        
        // 无库存且价差达到初始价差2倍时追单
        let chaseOrderTrigger = false;
        if (Math.abs(currentInventory) < 0.01 && this.lastQuotes) { // 基本无库存
            const initialSpread = this.config.HALF_SPREAD_PCT * 2; // 初始总价差
            const currentSpreadFromBid = this.lastQuotes.bidPrice > 0 ? 
                Math.abs(marketData.midPrice - this.lastQuotes.bidPrice) / marketData.midPrice : 0;
            const currentSpreadFromAsk = this.lastQuotes.askPrice < Number.MAX_SAFE_INTEGER ? 
                Math.abs(marketData.midPrice - this.lastQuotes.askPrice) / marketData.midPrice : 0;
            
            // 如果当前价格与任一挂单的价差达到初始价差的2倍，则触发追单
            chaseOrderTrigger = currentSpreadFromBid >= (initialSpread * 2) || 
                               currentSpreadFromAsk >= (initialSpread * 2);
        }
        
        const shouldUpdate = firstTimeTrigger || orderFilledTrigger || connectionRecoveryTrigger || chaseOrderTrigger;
        
        Logger.info(`[${this.symbol}] 更新触发检查: 首次=${firstTimeTrigger}, 订单成交=${orderFilledTrigger}, 连接恢复=${connectionRecoveryTrigger}, 追单=${chaseOrderTrigger}`);
        
        // 更新上次持仓记录
        this.lastPosition = { ...currentPosition };
        
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
                halfSpreadPct: this.config.HALF_SPREAD_PCT,
                volatility: 0.02, // 这里应该从历史数据计算，暂时使用固定值
                riskAversion: this.config.RISK_AVERSION,
                normalizedInventory: inventory,
                maxInventoryQ: this.config.MAX_INVENTORY_Q,
                useTraditionalGLFT: this.config.USE_TRADITIONAL_GLFT,
                gamma: this.config.RISK_AVERSION,
                orderFlowA: this.config.ORDER_FLOW_A,
                orderFlowK: this.config.ORDER_FLOW_K
            };
            
            // 使用策略模块计算报价
            const quotes = MidLowFreqGLFTStrategy.calculateOptimalQuotes(strategyInputs);
            
            // 如果库存限制导致某个方向被禁用，设置为特殊值
            let bidPrice = quotes.bidPrice;
            let askPrice = quotes.askPrice;
            
            if (bidPrice === null) {
                bidPrice = 0; // 禁止买入
            }
            
            if (askPrice === null) {
                askPrice = Number.MAX_SAFE_INTEGER; // 禁止卖出
            }
            
            // 计算实际下单数量：ORDER_AMOUNT是占总权益的百分比
            const totalEquity = this.accountService.getTotalEquity();
            const orderAmount = totalEquity * this.config.ORDER_AMOUNT;
            
            Logger.debug(`[${this.symbol}] 下单数量计算: 总权益=${totalEquity}, ORDER_AMOUNT=${this.config.ORDER_AMOUNT}, 订单金额=${orderAmount}, 中间价=${marketData.midPrice}`);
            
            // 根据当前价格计算下单数量（合约张数）
            let bidQuantity = orderAmount / marketData.midPrice;
            let askQuantity = orderAmount / marketData.midPrice;
            
            Logger.debug(`[${this.symbol}] 初始计算数量: bidQuantity=${bidQuantity}, askQuantity=${askQuantity}`);
            
            // 获取交易所的最小下单数量和精度
            const market = this.exchangeService.getMarket(this.symbol);
            const minAmount = market?.limits?.amount?.min || 0.01;
            const amountPrecision = market?.precision?.amount || 4;
            
            // 根据最小下单数量计算正确的精度位数
            let precisionDigits = 4; // 默认4位小数
            if (minAmount >= 1) {
                precisionDigits = 0;
            } else if (minAmount >= 0.1) {
                precisionDigits = 1;
            } else if (minAmount >= 0.01) {
                precisionDigits = 2;
            } else if (minAmount >= 0.001) {
                precisionDigits = 3;
            } else if (minAmount >= 0.0001) {
                precisionDigits = 4;
            } else {
                precisionDigits = 8;
            }
            
            Logger.debug(`[${this.symbol}] 市场限制: minAmount=${minAmount}, precisionDigits=${precisionDigits}`);
            
            // 如果计算出的数量小于最小下单数量，则使用最小下单数量
            if (bidQuantity < minAmount) {
                bidQuantity = minAmount;
                Logger.debug(`[${this.symbol}] 买单数量调整为最小下单数量: ${minAmount}`);
            }
            if (askQuantity < minAmount) {
                askQuantity = minAmount;
                Logger.debug(`[${this.symbol}] 卖单数量调整为最小下单数量: ${minAmount}`);
            }
            
            // 根据精度要求进行数量格式化
            bidQuantity = parseFloat(bidQuantity.toFixed(precisionDigits));
            askQuantity = parseFloat(askQuantity.toFixed(precisionDigits));
            
            Logger.debug(`[${this.symbol}] 最终下单数量: bidQuantity=${bidQuantity}, askQuantity=${askQuantity}`);
            
            return {
                bidPrice: bidPrice,
                askPrice: askPrice,
                bidSize: bidQuantity,
                askSize: askQuantity,
                timestamp: getTimestamp(),
                inventoryLimited: quotes.inventoryLimited,
                strategyMode: quotes.strategyMode
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
        
        // 根据交易模式确定需要创建的新订单
        const currentPosition = this.accountService.getPosition(this.symbol);
        const tradeSide = this.config.TRADE_SIDE; // 'long', 'short', 'both'
        
        // 确定需要创建的新订单
        if (newQuotes.bidPrice > 0) {
            const buyOrderType = this.determineBuyOrderType(currentPosition, tradeSide);
            if (buyOrderType) {
                operations.toCreate.push({
                    side: 'buy',
                    type: 'limit',
                    amount: newQuotes.bidSize,
                    price: newQuotes.bidPrice,
                    orderType: buyOrderType // 'open_long' 或 'close_short'
                });
            }
        }
        
        if (newQuotes.askPrice < Number.MAX_SAFE_INTEGER) {
            const sellOrderType = this.determineSellOrderType(currentPosition, tradeSide);
            if (sellOrderType) {
                operations.toCreate.push({
                    side: 'sell',
                    type: 'limit',
                    amount: newQuotes.askSize,
                    price: newQuotes.askPrice,
                    orderType: sellOrderType // 'close_long' 或 'open_short'
                });
            }
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
                
                const cancelPromises = operations.toCancel.map(async (order) => {
                    try {
                        const result = await this.exchangeService.cancelOrder(order.id, this.symbol);
                        if (result === null) {
                            Logger.debug(`订单 ${order.id} 已不存在，可能已成交或过期`);
                        } else {
                            Logger.debug(`成功取消订单 ${order.id}`);
                        }
                        return result;
                    } catch (error) {
                        Logger.warn(`Failed to cancel order ${order.id}:`, error.message);
                        return null;
                    }
                });
                
                await Promise.allSettled(cancelPromises);
            }
            
            // 等待一小段时间确保取消操作完成
            if (operations.toCancel.length > 0) {
                await sleep(100);
            }
            
            // 创建新订单
            if (operations.toCreate.length > 0) {
                Logger.debug(`Creating ${operations.toCreate.length} orders for ${this.symbol}`);
                
                // 获取当前持仓信息以判断是否为平仓操作
                const currentPosition = this.accountService.getPosition(this.symbol);
                
                const createPromises = operations.toCreate.map(orderSpec => {
                    // 构建订单参数
                    const params = {};
                    
                    // 为Bitget添加双向持仓模式所需的参数
                    const exchangeName = this.exchangeService.getExchangeName();
                    if (exchangeName === 'bitget') {
                        // 根据订单类型设置正确的参数
                        if (orderSpec.orderType === 'open_long') {
                            params.positionSide = 'long';
                            params.tradeSide = 'open';
                        } else if (orderSpec.orderType === 'close_long') {
                            params.positionSide = 'long';
                            params.tradeSide = 'close';
                            params.reduceOnly = true;
                        } else if (orderSpec.orderType === 'open_short') {
                            params.positionSide = 'short';
                            params.tradeSide = 'open';
                        } else if (orderSpec.orderType === 'close_short') {
                            params.positionSide = 'short';
                            params.tradeSide = 'close';
                            params.reduceOnly = true;
                        }
                    } else {
                        // 对于其他交易所，使用通用的 reduceOnly 参数
                        const isReduceOrder = this.isReduceOnlyOrder(orderSpec, currentPosition);
                        if (isReduceOrder) {
                            params.reduceOnly = true;
                        }
                    }
                    
                    Logger.debug(`Creating ${orderSpec.orderType || 'unknown'} ${orderSpec.side} order for ${this.symbol}`);
                    
                    return this.exchangeService.createOrder(
                        this.symbol,
                        orderSpec.type,
                        orderSpec.side,
                        orderSpec.amount,
                        orderSpec.price,
                        params
                    ).catch(error => {
                        Logger.warn(`Failed to create ${orderSpec.side} order:`, error.message);
                    });
                });
                
                await Promise.allSettled(createPromises);
            }
            
        } catch (error) {
            Logger.error(`Error in batch order operations for ${this.symbol}:`, error);
            throw error;
        }
    }
    
    /**
     * 判断订单是否为平仓操作
     * @param {object} orderSpec - 订单规格
     * @param {object} currentPosition - 当前持仓信息
     * @returns {boolean} 是否为平仓操作
     */
    /**
     * 判断买单类型（开多 vs 平空）
     * @param {object} currentPosition - 当前持仓
     * @param {string} tradeSide - 交易模式 ('long', 'short', 'both')
     * @returns {string|null} - 'open_long', 'close_short' 或 null
     */
    determineBuyOrderType(currentPosition, tradeSide) {
        const hasShortPosition = currentPosition && currentPosition.side === 'short' && currentPosition.contracts > 0;
        
        if (hasShortPosition) {
            // 有空头持仓，买单用于平空
            return 'close_short';
        } else if (tradeSide === 'long' || tradeSide === 'both') {
            // 无空头持仓且允许做多，买单用于开多
            return 'open_long';
        }
        
        return null; // 不创建买单
    }
    
    /**
     * 判断卖单类型（平多 vs 开空）
     * @param {object} currentPosition - 当前持仓
     * @param {string} tradeSide - 交易模式 ('long', 'short', 'both')
     * @returns {string|null} - 'close_long', 'open_short' 或 null
     */
    determineSellOrderType(currentPosition, tradeSide) {
        const hasLongPosition = currentPosition && currentPosition.side === 'long' && currentPosition.contracts > 0;
        
        if (hasLongPosition) {
            // 有多头持仓，卖单用于平多
            return 'close_long';
        } else if (tradeSide === 'short' || tradeSide === 'both') {
            // 无多头持仓且允许做空，卖单用于开空
            return 'open_short';
        }
        
        return null; // 不创建卖单
    }
    
    /**
     * 判断是否为平仓订单
     * @param {object} orderSpec - 订单规格
     * @param {object} currentPosition - 当前持仓
     * @returns {boolean}
     */
    isReduceOnlyOrder(orderSpec, currentPosition) {
        if (!currentPosition || currentPosition.contracts === 0) {
            return false;
        }
        
        // 根据订单类型判断是否为平仓订单
        return orderSpec.orderType === 'close_long' || orderSpec.orderType === 'close_short';
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
                
                const cancelPromises = orders.map(async (order) => {
                    try {
                        const result = await this.exchangeService.cancelOrder(order.id, this.symbol);
                        if (result === null) {
                            Logger.debug(`活动订单 ${order.id} 已不存在，可能已成交或过期`);
                        } else {
                            Logger.debug(`成功取消活动订单 ${order.id}`);
                        }
                        return result;
                    } catch (error) {
                        Logger.warn(`Failed to cancel order ${order.id}:`, error.message);
                        return null;
                    }
                });
                
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
     * 初始化网络恢复管理器
     * @private
     * @returns {Promise<void>}
     */
    async initializeNetworkRecovery() {
        try {
            // 暂时禁用网络恢复管理器以确保程序正常运行
            Logger.info(`Network recovery manager disabled for ${this.symbol} (temporary)`);
            return;
            
            
        } catch (error) {
            Logger.error(`Failed to initialize network recovery for ${this.symbol}:`, error.message);
            Logger.error(`Network recovery error stack:`, error.stack);
            // 不抛出错误，允许交易器继续运行
        }
    }
    
    /**
     * 设置网络恢复事件监听器
     * @private
     */
    setupNetworkRecoveryEventListeners() {
        if (!this.networkRecoveryManager) {
            return;
        }
        
        // 监听网络连接丢失事件
        this.networkRecoveryManager.on('connection_lost', () => {
            Logger.warn(`Network connection lost for ${this.symbol}`);
            
            // 暂停交易循环
            this.pause();
            this.emit('network_connection_lost', { symbol: this.symbol });
        });
        
        // 监听网络恢复事件
        this.networkRecoveryManager.on('connection_restored', () => {
            Logger.info(`Network connection restored for ${this.symbol}`);
            
            // 恢复交易循环
            if (this.isPaused) {
                this.resume();
            }
            this.emit('network_connection_restored', { symbol: this.symbol });
        });
        
        // 监听网络恢复失败事件
        this.networkRecoveryManager.on('recovery_failed', (error) => {
            Logger.error(`Network recovery failed for ${this.symbol}:`, error);
            this.emit('network_recovery_failed', { symbol: this.symbol, error });
            
            // 网络恢复失败时的处理
            this.handleNetworkRecoveryFailure(error);
        });
    }
    
    /**
     * 处理网络恢复失败
     * @private
     * @param {Error} error - 错误信息
     */
    handleNetworkRecoveryFailure(error) {
        try {
            // 记录错误统计
            this.stats.errors++;
            this.stats.lastError = error.message;
            
            // 暂停交易器
            this.pause();
            
            // 发送告警
            this.emit('critical_error', {
                symbol: this.symbol,
                type: 'network_recovery_failed',
                message: 'Network recovery has failed after multiple attempts'
            });
            
        } catch (err) {
            Logger.error(`Error handling network recovery failure for ${this.symbol}:`, err);
        }
    }
    
    /**
     * 获取网络恢复统计信息
     * @returns {Object|null}
     */
    getNetworkRecoveryStats() {
        if (!this.networkRecoveryManager) {
            return null;
        }
        
        return this.networkRecoveryManager.getStats();
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