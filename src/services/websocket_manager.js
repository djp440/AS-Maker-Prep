const ccxt = require('ccxt').pro;
const { EventEmitter } = require('events');
const Config = require('../shared/config');
const Logger = require('../shared/logger');

/**
 * @class WebSocketManager
 * @description 管理与Bitget交易所的WebSocket连接，处理实时数据流
 * 支持实盘/模拟盘切换、自动重连、订阅管理等功能
 */
class WebSocketManager extends EventEmitter {
    /**
     * @private
     * @type {WebSocketManager | null}
     */
    static instance = null;

    /**
     * @private
     * @type {ccxt.Exchange | null}
     */
    exchange = null;

    /**
     * @private
     * @type {string}
     */
    connectionState = 'closed'; // connecting, open, closing, closed

    /**
     * @private
     * @type {Set<string>}
     */
    subscribedTopics = new Set();

    /**
     * @private
     * @type {number}
     */
    reconnectAttempts = 0;

    /**
     * @private
     * @type {number}
     */
    maxReconnectAttempts = 10;

    /**
     * @private
     * @type {number[]}
     */
    reconnectDelays = [1000, 2000, 4000, 8000, 16000, 32000, 60000]; // 指数退避，最大60秒

    /**
     * @private
     * @type {NodeJS.Timeout | null}
     */
    reconnectTimer = null;

    /**
     * @private
     * @type {boolean}
     */
    isReconnecting = false;

    /**
     * @private
     * @type {Map<string, Function>}
     */
    watchHandlers = new Map();

    /**
     * @private
     * @constructor
     */
    constructor() {
        super();
        // 私有构造函数，防止外部实例化
        
        // 连接健康检查定时器
        this.healthCheckTimer = null;
        this.healthCheckInterval = 30000; // 30秒检查一次
        this.lastDataReceived = Date.now();
        this.maxSilentTime = 60000; // 60秒无数据则认为连接异常
        
        // 连接质量监控
        this.connectionQuality = {
            latency: 0,
            dataReceiveRate: 0,
            errorCount: 0,
            lastErrorTime: 0
        };
        this.qualityCheckInterval = 10000; // 10秒检查一次连接质量
        this.qualityCheckTimer = null;
    }

    /**
     * @description 获取WebSocketManager的单例实例
     * @returns {WebSocketManager}
     */
    static getInstance() {
        if (!WebSocketManager.instance) {
            WebSocketManager.instance = new WebSocketManager();
        }
        return WebSocketManager.instance;
    }

    /**
     * @description 初始化WebSocket连接
     * @param {object} [config=Config] - 配置对象
     */
    async initialize(config = Config) {
        try {
            const exchangeName = config.getExchange();
            const credentials = config.getApiCredentials();
            const isPaperTrading = config.isPaperTrading();

            Logger.info(`初始化WebSocket连接: ${exchangeName}, 模式: ${isPaperTrading ? '模拟盘' : '实盘'}`);

            // 创建交易所实例
            const ExchangeClass = ccxt[exchangeName];
            if (!ExchangeClass) {
                throw new Error(`不支持的交易所: ${exchangeName}`);
            }

            const options = {
                apiKey: credentials.apiKey,
                secret: credentials.apiSecret,
                password: credentials.passphrase,
                enableRateLimit: true,
                sandbox: false, // Bitget没有沙盒环境
            };

            // 针对Bitget的配置
            if (exchangeName === 'bitget') {
                // 根据CCXT Pro指南，简化配置
                options.options = {
                    defaultType: 'swap'
                };
                
                // 根据模拟盘/实盘模式设置WebSocket URL
                if (isPaperTrading) {
                    // 模拟盘WebSocket配置
                    options.urls = {
                        api: {
                            ws: {
                                public: 'wss://wspap.bitget.com/v2/ws/public',
                                private: 'wss://wspap.bitget.com/v2/ws/private'
                            }
                        }
                    };
                    Logger.info('使用模拟盘WebSocket端点');
                } else {
                    // 实盘WebSocket配置（使用默认URL）
                    Logger.info('使用实盘WebSocket端点');
                }
                
                // 添加连接超时和重连配置
                options.options.watchOrderBookLimit = 1000; // 订单簿深度限制
                options.options.tradesLimit = 1000; // 交易记录限制
                options.timeout = 30000; // 30秒超时
            }

            this.exchange = new ExchangeClass(options);
            
            // 加载市场信息
            await this.exchange.loadMarkets();
            
            this.connectionState = 'open';
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            this.lastDataReceived = Date.now();
            
            // 启动连接健康检查和质量监控
            this.startHealthCheck();
            this.startQualityMonitoring();
            
            Logger.info('WebSocket连接初始化成功');
            this.emit('connected');

        } catch (error) {
            Logger.error('WebSocket初始化失败:', error);
            this.connectionState = 'closed';
            throw error;
        }
    }

    /**
     * @description 订阅Ticker数据
     * @param {string} symbol - 交易对符号，如 'BTC/USDT:USDT'
     * @returns {Promise<void>}
     */
    async watchTicker(symbol) {
        try {
            if (!this.exchange) {
                throw new Error('WebSocket未初始化');
            }

            // 检查交易所是否支持watchTicker
            if (!this.exchange.has['watchTicker']) {
                Logger.warn(`交易所 ${this.exchange.id} 不支持 watchTicker，跳过订阅`);
                return;
            }

            const topicKey = `ticker:${symbol}`;
            this.subscribedTopics.add(topicKey);

            Logger.info(`订阅Ticker数据: ${symbol}`);

            const handler = async () => {
                try {
                    while (this.connectionState === 'open') {
                        const ticker = await this.exchange.watchTicker(symbol);
                        this.lastDataReceived = Date.now(); // 更新数据接收时间
                        this.emit('ticker', { symbol, data: ticker });
                    }
                } catch (error) {
                    // 只有在非重连状态下才处理连接错误
                    if (!this.isReconnecting && this.connectionState === 'open') {
                        Logger.error(`Ticker订阅错误 ${symbol}:`, error);
                        this.handleConnectionError(error);
                    }
                }
            };

            this.watchHandlers.set(topicKey, handler);
            
            // 只有在连接状态为open时才启动监听
            if (this.connectionState === 'open') {
                handler(); // 启动监听
            }

        } catch (error) {
            Logger.error(`订阅Ticker失败 ${symbol}:`, error);
            throw error;
        }
    }

    /**
     * @description 订阅订单簿数据
     * @param {string} symbol - 交易对符号，如 'BTC/USDT:USDT'
     * @returns {Promise<void>}
     */
    async watchOrderBook(symbol) {
        try {
            if (!this.exchange) {
                throw new Error('WebSocket未初始化');
            }

            // 检查交易所是否支持watchOrderBook
            if (!this.exchange.has['watchOrderBook']) {
                Logger.warn(`交易所 ${this.exchange.id} 不支持 watchOrderBook，跳过订阅`);
                return;
            }

            const topicKey = `orderbook:${symbol}`;
            this.subscribedTopics.add(topicKey);

            Logger.info(`订阅订单簿数据: ${symbol}`);

            const handler = async () => {
                try {
                    while (this.connectionState === 'open') {
                        const orderbook = await this.exchange.watchOrderBook(symbol);
                        this.lastDataReceived = Date.now(); // 更新数据接收时间
                        this.emit('orderbook', { symbol, data: orderbook });
                    }
                } catch (error) {
                    // 只有在非重连状态下才处理连接错误
                    if (!this.isReconnecting && this.connectionState === 'open') {
                        Logger.error(`订单簿订阅错误 ${symbol}:`, error);
                        this.handleConnectionError(error);
                    }
                }
            };

            this.watchHandlers.set(topicKey, handler);
            
            // 只有在连接状态为open时才启动监听
            if (this.connectionState === 'open') {
                handler(); // 启动监听
            }

        } catch (error) {
            Logger.error(`订阅订单簿失败 ${symbol}:`, error);
            throw error;
        }
    }

    /**
     * @description 订阅订单更新
     * @param {string} [symbol] - 交易对符号，如 'BTC/USDT:USDT'，不传则订阅所有
     * @returns {Promise<void>}
     */
    async watchOrders(symbol = undefined) {
        try {
            if (!this.exchange) {
                throw new Error('WebSocket未初始化');
            }

            // 检查交易所是否支持watchOrders
            if (!this.exchange.has['watchOrders']) {
                Logger.warn(`交易所 ${this.exchange.id} 不支持 watchOrders，跳过订阅`);
                return;
            }

            const topicKey = `orders:${symbol || 'all'}`;
            this.subscribedTopics.add(topicKey);

            Logger.info(`订阅订单更新: ${symbol || '所有交易对'}`);

            const handler = async () => {
                try {
                    while (this.connectionState === 'open') {
                        const orders = await this.exchange.watchOrders(symbol);
                        this.lastDataReceived = Date.now(); // 更新数据接收时间
                        this.emit('orders', { symbol, data: orders });
                    }
                } catch (error) {
                    // 只有在非重连状态下才处理连接错误
                    if (!this.isReconnecting && this.connectionState === 'open') {
                        Logger.error(`订单订阅错误 ${symbol || 'all'}:`, error);
                        this.handleConnectionError(error);
                    }
                }
            };

            this.watchHandlers.set(topicKey, handler);
            
            // 只有在连接状态为open时才启动监听
            if (this.connectionState === 'open') {
                handler(); // 启动监听
            }

        } catch (error) {
            Logger.error(`订阅订单失败 ${symbol || 'all'}:`, error);
            throw error;
        }
    }

    /**
     * @description 订阅账户余额变化
     * @returns {Promise<void>}
     */
    async watchBalance() {
        try {
            if (!this.exchange) {
                throw new Error('WebSocket未初始化');
            }

            // 检查交易所是否支持watchBalance
            if (!this.exchange.has['watchBalance']) {
                Logger.warn(`交易所 ${this.exchange.id} 不支持 watchBalance，跳过订阅`);
                return;
            }

            const topicKey = 'balance';
            this.subscribedTopics.add(topicKey);

            Logger.info('订阅账户余额变化');

            const handler = async () => {
                try {
                    while (this.connectionState === 'open') {
                        const balance = await this.exchange.watchBalance();
                        this.lastDataReceived = Date.now(); // 更新数据接收时间
                        this.emit('balance', { data: balance });
                    }
                } catch (error) {
                    // 只有在非重连状态下才处理连接错误
                    if (!this.isReconnecting && this.connectionState === 'open') {
                        Logger.error('余额订阅错误:', error);
                        this.handleConnectionError(error);
                    }
                }
            };

            this.watchHandlers.set(topicKey, handler);
            
            // 只有在连接状态为open时才启动监听
            if (this.connectionState === 'open') {
                handler(); // 启动监听
            }

        } catch (error) {
            Logger.error('订阅余额失败:', error);
            throw error;
        }
    }

    /**
     * @description 订阅持仓变化
     * @param {string} [symbol] - 交易对符号，如 'BTC/USDT:USDT'，不传则订阅所有
     * @returns {Promise<void>}
     */
    async watchPositions(symbol = undefined) {
        try {
            if (!this.exchange) {
                throw new Error('WebSocket未初始化');
            }

            // 检查交易所是否支持watchPositions
            if (!this.exchange.has['watchPositions']) {
                Logger.warn(`交易所 ${this.exchange.id} 不支持 watchPositions，跳过订阅`);
                return;
            }

            const topicKey = `positions:${symbol || 'all'}`;
            this.subscribedTopics.add(topicKey);

            Logger.info(`订阅持仓变化: ${symbol || '所有交易对'}`);

            const handler = async () => {
                try {
                    while (this.connectionState === 'open') {
                        const positions = await this.exchange.watchPositions(symbol ? [symbol] : undefined);
                        this.lastDataReceived = Date.now(); // 更新数据接收时间
                        this.emit('positions', { symbol, data: positions });
                    }
                } catch (error) {
                    // 只有在非重连状态下才处理连接错误
                    if (!this.isReconnecting && this.connectionState === 'open') {
                        Logger.error(`持仓订阅错误 ${symbol || 'all'}:`, error);
                        this.handleConnectionError(error);
                    }
                }
            };

            this.watchHandlers.set(topicKey, handler);
            
            // 只有在连接状态为open时才启动监听
            if (this.connectionState === 'open') {
                handler(); // 启动监听
            }

        } catch (error) {
            Logger.error(`订阅持仓失败 ${symbol || 'all'}:`, error);
            throw error;
        }
    }

    /**
     * @description 处理连接错误，触发重连机制
     * @private
     * @param {Error} error - 错误对象
     */
    handleConnectionError(error) {
        if (this.isReconnecting) {
            return; // 已在重连中，避免重复触发
        }

        // 更新连接质量统计
        this.connectionQuality.errorCount++;
        this.connectionQuality.lastErrorTime = Date.now();
        
        // 根据CCXT错误类型进行分类处理
        const isRetryableError = this.isRetryableError(error);
        
        if (isRetryableError) {
            Logger.warn('WebSocket连接错误（可重试）:', error.message);
            this.connectionState = 'closed';
            this.emit('disconnected', error);
            this.scheduleReconnect();
        } else {
            Logger.error('WebSocket连接错误（不可重试）:', error.message);
            this.connectionState = 'closed';
            this.emit('error', error);
            // 对于不可重试的错误，不自动重连
        }
    }

    /**
     * @description 判断错误是否可重试
     * @private
     * @param {Error} error - 错误对象
     * @returns {boolean} 是否可重试
     */
    isRetryableError(error) {
        // 网络错误、超时错误、交易所临时繁忙等可重试
        return (
            error instanceof ccxt.NetworkError ||
            error instanceof ccxt.RequestTimeout ||
            error instanceof ccxt.ExchangeNotAvailable ||
            error instanceof ccxt.RateLimitExceeded || // 速率限制错误
            error instanceof ccxt.DDoSProtection ||    // DDoS保护错误
            (error instanceof ccxt.ExchangeError && 
             (error.message.includes('busy') || 
              error.message.includes('timeout') ||
              error.message.includes('connection') ||
              error.message.includes('network')))
        );
    }

    /**
     * @description 安排重连
     * @private
     */
    scheduleReconnect() {
        if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                Logger.error('达到最大重连次数，停止重连');
                this.emit('maxReconnectAttemptsReached');
            }
            return;
        }

        this.isReconnecting = true;
        const delayIndex = Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1);
        const delay = this.reconnectDelays[delayIndex];

        Logger.info(`${delay / 1000}秒后尝试第${this.reconnectAttempts + 1}次重连`);

        this.reconnectTimer = setTimeout(async () => {
            try {
                this.reconnectAttempts++;
                await this.reconnect();
            } catch (error) {
                Logger.error('重连失败:', error);
                this.isReconnecting = false;
                this.scheduleReconnect(); // 继续尝试重连
            }
        }, delay);
    }

    /**
     * @description 执行重连
     * @private
     */
    async reconnect() {
        try {
            Logger.info('开始重连WebSocket...');
            this.connectionState = 'connecting';

            // 清理旧的连接和处理器
            this.cleanup();

            // 重新初始化连接
            await this.initialize();

            // 重新订阅所有主题
            await this.resubscribeAll();

            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            this.lastDataReceived = Date.now();
            
            // 重新启动健康检查和质量监控
            this.startHealthCheck();
            this.startQualityMonitoring();
            
            Logger.info('WebSocket重连成功');
            this.emit('reconnected');

        } catch (error) {
            this.connectionState = 'closed';
            this.isReconnecting = false;
            throw error;
        }
    }

    /**
     * @description 重新订阅所有主题
     * @private
     */
    async resubscribeAll() {
        Logger.info('重新订阅所有主题...');
        
        const topics = Array.from(this.subscribedTopics);
        this.watchHandlers.clear();

        // 暂时设置为重连状态，避免在重新订阅过程中触发错误处理
        const wasReconnecting = this.isReconnecting;
        this.isReconnecting = true;

        for (const topic of topics) {
            try {
                const [type, symbol] = topic.split(':');
                
                // 从subscribedTopics中移除，让watch方法重新添加
                this.subscribedTopics.delete(topic);
                
                switch (type) {
                    case 'ticker':
                        await this.watchTicker(symbol);
                        break;
                    case 'orderbook':
                        await this.watchOrderBook(symbol);
                        break;
                    case 'orders':
                        await this.watchOrders(symbol === 'all' ? undefined : symbol);
                        break;
                    case 'balance':
                        await this.watchBalance();
                        break;
                    case 'positions':
                        await this.watchPositions(symbol === 'all' ? undefined : symbol);
                        break;
                    default:
                        Logger.warn(`未知的订阅类型: ${type}`);
                }
            } catch (error) {
                Logger.error(`重新订阅失败 ${topic}:`, error);
                // 重新订阅失败时，将topic重新加入到subscribedTopics中
                this.subscribedTopics.add(topic);
            }
        }

        // 恢复重连状态
        this.isReconnecting = wasReconnecting;

        // 通知AccountService进行状态校准
        this.emit('reconnected:calibrate');
    }

    /**
     * @description 清理资源
     * @private
     */
    cleanup() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // 停止健康检查和质量监控
        this.stopHealthCheck();
        this.stopQualityMonitoring();
        
        // 停止所有watch处理器
        for (const handler of this.watchHandlers.values()) {
            // 由于handler是异步函数，我们通过改变connectionState来停止它们
        }
        this.watchHandlers.clear();

        if (this.exchange) {
            try {
                // 关闭WebSocket连接
                if (typeof this.exchange.close === 'function') {
                    this.exchange.close();
                }
            } catch (error) {
                Logger.warn('关闭交易所连接时出错:', error);
            }
        }
    }

    /**
     * @description 取消订阅指定主题
     * @param {string} topic - 主题标识
     */
    unsubscribe(topic) {
        this.subscribedTopics.delete(topic);
        this.watchHandlers.delete(topic);
        Logger.info(`取消订阅: ${topic}`);
    }

    /**
     * @description 获取连接状态
     * @returns {string} 连接状态
     */
    getConnectionState() {
        return this.connectionState;
    }

    /**
     * @description 获取已订阅的主题列表
     * @returns {string[]} 主题列表
     */
    getSubscribedTopics() {
        return Array.from(this.subscribedTopics);
    }

    /**
     * @description 检查是否已连接
     * @returns {boolean} 是否已连接
     */
    isConnected() {
        return this.connectionState === 'open';
    }

    /**
     * @description 关闭WebSocket连接
     */
    async close() {
        Logger.info('关闭WebSocket连接...');
        this.connectionState = 'closing';
        
        this.cleanup();
        
        this.connectionState = 'closed';
        this.emit('closed');
        
        Logger.info('WebSocket连接已关闭');
    }

    /**
     * @description 启动连接健康检查
     * @private
     */
    startHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        this.healthCheckTimer = setInterval(() => {
            const now = Date.now();
            const timeSinceLastData = now - this.lastDataReceived;
            
            if (timeSinceLastData > this.maxSilentTime && this.connectionState === 'open') {
                Logger.warn(`连接健康检查失败: ${timeSinceLastData}ms 无数据接收`);
                this.handleConnectionError(new Error('Connection health check failed: no data received'));
            }
        }, this.healthCheckInterval);
    }

    /**
      * @description 停止连接健康检查
      * @private
      */
     stopHealthCheck() {
         if (this.healthCheckTimer) {
             clearInterval(this.healthCheckTimer);
             this.healthCheckTimer = null;
         }
     }

     /**
      * @description 启动连接质量监控
      * @private
      */
     startQualityMonitoring() {
         if (this.qualityCheckTimer) {
             clearInterval(this.qualityCheckTimer);
         }
         
         this.qualityCheckTimer = setInterval(() => {
             this.updateConnectionQuality();
         }, this.qualityCheckInterval);
     }

     /**
      * @description 停止连接质量监控
      * @private
      */
     stopQualityMonitoring() {
         if (this.qualityCheckTimer) {
             clearInterval(this.qualityCheckTimer);
             this.qualityCheckTimer = null;
         }
     }

     /**
      * @description 更新连接质量指标
      * @private
      */
     updateConnectionQuality() {
         const now = Date.now();
         
         // 计算数据接收率（每秒接收数据次数的估算）
         const timeSinceLastData = now - this.lastDataReceived;
         this.connectionQuality.dataReceiveRate = timeSinceLastData < 5000 ? 1 : 0;
         
         // 计算延迟（基于数据接收间隔的估算）
         this.connectionQuality.latency = Math.min(timeSinceLastData, 5000);
         
         // 如果连接质量较差，记录警告
         if (this.connectionQuality.errorCount > 5 && 
             (now - this.connectionQuality.lastErrorTime) < 60000) {
             Logger.warn('连接质量较差，错误频率过高');
         }
         
         // 发出连接质量事件
         this.emit('connectionQuality', this.connectionQuality);
     }

     /**
      * @description 获取连接质量信息
      * @returns {Object} 连接质量指标
      */
     getConnectionQuality() {
         return { ...this.connectionQuality };
     }

    /**
     * @description 获取交易所实例
     * @returns {ccxt.Exchange | null}
     */
    getExchangeInstance() {
        return this.exchange;
    }
}

module.exports = WebSocketManager.getInstance();