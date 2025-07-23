const { EventEmitter } = require('events');
const WebSocketManager = require('./websocket_manager');
const ExchangeService = require('./exchange_service');
const Config = require('../shared/config');
const Logger = require('../shared/logger');

/**
 * @class MarketDataService
 * @description 为策略模块提供统一、实时的市场数据接口
 * 整合WebSocket实时数据和REST API历史数据，计算并缓存衍生数据
 */
class MarketDataService extends EventEmitter {
    /**
     * @private
     * @type {MarketDataService | null}
     */
    static instance = null;

    /**
     * @private
     * @type {Map<string, object>}
     * @description 存储每个交易对的市场数据
     */
    marketData = new Map();

    /**
     * @private
     * @type {Map<string, number>}
     * @description 存储每个交易对的波动率更新定时器
     */
    volatilityTimers = new Map();

    /**
     * @private
     * @type {boolean}
     */
    isInitialized = false;

    /**
     * @constructor
     */
    constructor() {
        super();
        // 构造函数
    }

    /**
     * @description 获取MarketDataService的单例实例
     * @returns {MarketDataService}
     */
    static getInstance() {
        if (!MarketDataService.instance) {
            MarketDataService.instance = new MarketDataService();
        }
        return MarketDataService.instance;
    }

    /**
     * @description 初始化市场数据服务
     * @param {object} config - 配置对象
     * @returns {Promise<void>}
     */
    async initialize(config = Config) {
        if (this.isInitialized) {
            Logger.warn('MarketDataService已经初始化');
            return;
        }

        try {
            Logger.info('初始化MarketDataService...');

            // 获取配置的交易对
            const symbols = config.getSymbols();
            
            // 为每个交易对初始化数据结构
            for (const symbolConfig of symbols) {
                const symbol = symbolConfig.SYMBOL;
                this.marketData.set(symbol, {
                    symbol,
                    midPrice: null,
                    bestBid: null,
                    bestAsk: null,
                    spread: null,
                    spreadPct: null,
                    volatility: null,
                    lastTickerUpdate: null,
                    lastOrderbookUpdate: null,
                    lastVolatilityUpdate: null,
                    config: symbolConfig
                });

                // 初始化波动率
                await this.initializeVolatility(symbol, symbolConfig);

                // 启动波动率定期更新
                this.startVolatilityUpdates(symbol, symbolConfig);
            }

            // 监听WebSocketManager的事件
            this.setupWebSocketListeners();

            this.isInitialized = true;
            Logger.info('MarketDataService初始化完成');

        } catch (error) {
            Logger.error('MarketDataService初始化失败:', error);
            throw error;
        }
    }

    /**
     * @description 设置WebSocket事件监听器
     * @private
     */
    setupWebSocketListeners() {
        // 监听ticker事件
        WebSocketManager.on('ticker', (data) => {
            this.handleTickerUpdate(data.symbol, data.data);
        });

        // 监听orderbook事件
        WebSocketManager.on('orderbook', (data) => {
            this.handleOrderbookUpdate(data.symbol, data.data);
        });

        Logger.info('WebSocket事件监听器已设置');
    }

    /**
     * @description 处理ticker数据更新
     * @private
     * @param {string} symbol - 交易对符号
     * @param {object} ticker - ticker数据
     */
    handleTickerUpdate(symbol, ticker) {
        const data = this.marketData.get(symbol);
        if (!data) {
            Logger.warn(`收到未知交易对的ticker数据: ${symbol}`);
            return;
        }

        try {
            // 更新最佳买卖价
            if (ticker.bid !== undefined && ticker.ask !== undefined) {
                data.bestBid = ticker.bid;
                data.bestAsk = ticker.ask;
                
                // 计算中间价
                data.midPrice = (ticker.bid + ticker.ask) / 2;
                
                // 计算价差
                data.spread = ticker.ask - ticker.bid;
                data.spreadPct = data.spread / data.midPrice * 100;
                
                data.lastTickerUpdate = Date.now();

                // 数据验证
                this.validateMarketData(symbol, data);

                // 发射数据更新事件
                this.emit('midPriceUpdate', {
                    symbol,
                    midPrice: data.midPrice,
                    bestBid: data.bestBid,
                    bestAsk: data.bestAsk,
                    spread: data.spread,
                    spreadPct: data.spreadPct
                });

                Logger.debug(`${symbol} 中间价更新: ${data.midPrice}, 价差: ${data.spreadPct.toFixed(4)}%`);
            }
        } catch (error) {
            Logger.error(`处理ticker数据失败 ${symbol}:`, error);
        }
    }

    /**
     * @description 处理orderbook数据更新
     * @private
     * @param {string} symbol - 交易对符号
     * @param {object} orderbook - orderbook数据
     */
    handleOrderbookUpdate(symbol, orderbook) {
        const data = this.marketData.get(symbol);
        if (!data) {
            Logger.warn(`收到未知交易对的orderbook数据: ${symbol}`);
            return;
        }

        try {
            // 从orderbook获取最佳买卖价
            if (orderbook.bids && orderbook.bids.length > 0 && 
                orderbook.asks && orderbook.asks.length > 0) {
                
                const bestBid = orderbook.bids[0][0];
                const bestAsk = orderbook.asks[0][0];
                
                data.bestBid = bestBid;
                data.bestAsk = bestAsk;
                
                // 计算中间价
                data.midPrice = (bestBid + bestAsk) / 2;
                
                // 计算价差
                data.spread = bestAsk - bestBid;
                data.spreadPct = data.spread / data.midPrice * 100;
                
                data.lastOrderbookUpdate = Date.now();

                // 数据验证
                this.validateMarketData(symbol, data);

                // 发射数据更新事件
                this.emit('midPriceUpdate', {
                    symbol,
                    midPrice: data.midPrice,
                    bestBid: data.bestBid,
                    bestAsk: data.bestAsk,
                    spread: data.spread,
                    spreadPct: data.spreadPct
                });

                Logger.debug(`${symbol} 中间价更新(orderbook): ${data.midPrice}, 价差: ${data.spreadPct.toFixed(4)}%`);
            }
        } catch (error) {
            Logger.error(`处理orderbook数据失败 ${symbol}:`, error);
        }
    }

    /**
     * @description 初始化交易对的波动率
     * @private
     * @param {string} symbol - 交易对符号
     * @param {object} symbolConfig - 交易对配置
     * @returns {Promise<void>}
     */
    async initializeVolatility(symbol, symbolConfig) {
        try {
            Logger.info(`初始化 ${symbol} 的波动率...`);
            
            const volatility = await this.calculateVolatility(symbol, symbolConfig);
            const data = this.marketData.get(symbol);
            
            if (data && volatility !== null) {
                data.volatility = volatility;
                data.lastVolatilityUpdate = Date.now();
                
                Logger.info(`${symbol} 初始波动率: ${(volatility * 100).toFixed(4)}%`);
                
                // 发射波动率更新事件
                this.emit('volatilityUpdate', {
                    symbol,
                    volatility
                });
            }
        } catch (error) {
            Logger.error(`初始化 ${symbol} 波动率失败:`, error);
        }
    }

    /**
     * @description 启动波动率定期更新
     * @private
     * @param {string} symbol - 交易对符号
     * @param {object} symbolConfig - 交易对配置
     */
    startVolatilityUpdates(symbol, symbolConfig) {
        // 每15分钟更新一次波动率
        const updateInterval = 15 * 60 * 1000; // 15分钟
        
        const timer = setInterval(async () => {
            try {
                const volatility = await this.calculateVolatility(symbol, symbolConfig);
                const data = this.marketData.get(symbol);
                
                if (data && volatility !== null) {
                    data.volatility = volatility;
                    data.lastVolatilityUpdate = Date.now();
                    
                    Logger.info(`${symbol} 波动率更新: ${(volatility * 100).toFixed(4)}%`);
                    
                    // 发射波动率更新事件
                    this.emit('volatilityUpdate', {
                        symbol,
                        volatility
                    });
                }
            } catch (error) {
                Logger.error(`更新 ${symbol} 波动率失败:`, error);
            }
        }, updateInterval);
        
        this.volatilityTimers.set(symbol, timer);
        Logger.info(`${symbol} 波动率定期更新已启动，间隔: ${updateInterval / 1000}秒`);
    }

    /**
     * @description 计算交易对的波动率
     * @private
     * @param {string} symbol - 交易对符号
     * @param {object} symbolConfig - 交易对配置
     * @returns {Promise<number|null>} 波动率值
     */
    async calculateVolatility(symbol, symbolConfig) {
        try {
            const lookback = symbolConfig.VOLATILITY_LOOKBACK || 14;
            const timeframe = symbolConfig.KLINE_INTERVAL || '15m';
            
            // 获取K线数据
            const ohlcv = await ExchangeService.fetchOHLCV(symbol, timeframe, undefined, lookback + 1);
            
            if (!ohlcv || ohlcv.length < lookback + 1) {
                Logger.warn(`${symbol} K线数据不足，无法计算波动率`);
                return null;
            }
            
            // 计算对数收益率
            const returns = [];
            for (let i = 1; i < ohlcv.length; i++) {
                const prevClose = ohlcv[i - 1][4]; // 前一根K线的收盘价
                const currentClose = ohlcv[i][4];  // 当前K线的收盘价
                
                if (prevClose > 0 && currentClose > 0) {
                    const logReturn = Math.log(currentClose / prevClose);
                    returns.push(logReturn);
                }
            }
            
            if (returns.length < lookback) {
                Logger.warn(`${symbol} 有效收益率数据不足，无法计算波动率`);
                return null;
            }
            
            // 计算标准差
            const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
            const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
            const volatility = Math.sqrt(variance);
            
            return volatility;
            
        } catch (error) {
            Logger.error(`计算 ${symbol} 波动率失败:`, error);
            return null;
        }
    }

    /**
     * @description 验证市场数据
     * @private
     * @param {string} symbol - 交易对符号
     * @param {object} data - 市场数据
     */
    validateMarketData(symbol, data) {
        try {
            // 检查价差是否异常
            if (data.spreadPct > 5.0) { // 价差超过5%认为异常
                Logger.warn(`${symbol} 价差异常扩大: ${data.spreadPct.toFixed(4)}%`);
                this.emit('dataValidationWarning', {
                    symbol,
                    type: 'spread',
                    value: data.spreadPct,
                    message: '价差异常扩大'
                });
            }
            
            // 检查价格是否合理
            if (data.midPrice <= 0 || data.bestBid <= 0 || data.bestAsk <= 0) {
                Logger.warn(`${symbol} 价格数据异常: midPrice=${data.midPrice}, bid=${data.bestBid}, ask=${data.bestAsk}`);
                this.emit('dataValidationWarning', {
                    symbol,
                    type: 'price',
                    message: '价格数据异常'
                });
            }
            
            // 检查买卖价顺序
            if (data.bestBid >= data.bestAsk) {
                Logger.warn(`${symbol} 买卖价顺序异常: bid=${data.bestBid} >= ask=${data.bestAsk}`);
                this.emit('dataValidationWarning', {
                    symbol,
                    type: 'order',
                    message: '买卖价顺序异常'
                });
            }
            
        } catch (error) {
            Logger.error(`验证 ${symbol} 市场数据失败:`, error);
        }
    }

    /**
     * @description 获取交易对的实时中间价
     * @param {string} symbol - 交易对符号
     * @returns {number|null} 中间价
     */
    getMidPrice(symbol) {
        const data = this.marketData.get(symbol);
        return data ? data.midPrice : null;
    }

    /**
     * @description 获取交易对的波动率
     * @param {string} symbol - 交易对符号
     * @returns {number|null} 波动率
     */
    getVolatility(symbol) {
        const data = this.marketData.get(symbol);
        return data ? data.volatility : null;
    }

    /**
     * @description 获取交易对的完整市场数据
     * @param {string} symbol - 交易对符号
     * @returns {object|null} 市场数据对象
     */
    getMarketData(symbol) {
        const data = this.marketData.get(symbol);
        return data ? { ...data } : null; // 返回副本避免外部修改
    }

    /**
     * @description 获取所有交易对的市场数据
     * @returns {Map<string, object>} 所有市场数据
     */
    getAllMarketData() {
        const result = new Map();
        for (const [symbol, data] of this.marketData) {
            result.set(symbol, { ...data }); // 返回副本
        }
        return result;
    }

    /**
     * @description 检查服务是否已初始化
     * @returns {boolean} 是否已初始化
     */
    getIsInitialized() {
        return this.isInitialized;
    }

    /**
     * @description 清理资源
     */
    cleanup() {
        Logger.info('清理MarketDataService资源...');
        
        // 清理定时器
        for (const [symbol, timer] of this.volatilityTimers) {
            clearInterval(timer);
            Logger.debug(`清理 ${symbol} 波动率更新定时器`);
        }
        this.volatilityTimers.clear();
        
        // 清理数据
        this.marketData.clear();
        
        // 移除事件监听器
        this.removeAllListeners();
        
        this.isInitialized = false;
        Logger.info('MarketDataService资源清理完成');
    }
}

module.exports = MarketDataService;