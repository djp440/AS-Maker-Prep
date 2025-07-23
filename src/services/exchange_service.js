const ccxt = require('ccxt');
const Config = require('../shared/config');
const Logger = require('../shared/logger');

/**
 * @class ExchangeService
 * @description 封装CCXT库，为上层应用提供统一、简化的交易所接口
 * 支持实盘与模拟盘模式切换，包含API速率限制和错误重试逻辑
 */
class ExchangeService {
    /**
     * @private
     * @type {ExchangeService | null}
     */
    static instance = null;

    /**
     * @private
     * @type {ccxt.Exchange | null}
     */
    exchange = null;

    /**
     * @private
     * @type {object | null}
     */
    markets = null;

    /**
     * @private
     * @type {number}
     */
    maxRetries = 3;

    /**
     * @private
     * @constructor
     */
    constructor() {
        // 私有构造函数，防止外部实例化
    }

    /**
     * @description 获取ExchangeService的单例实例
     * @returns {ExchangeService}
     */
    static getInstance() {
        if (!ExchangeService.instance) {
            ExchangeService.instance = new ExchangeService();
        }
        return ExchangeService.instance;
    }

    /**
     * @description 初始化交易所连接
     * @param {Config} config - 配置实例
     */
    async initialize(config = Config) {
        try {
            const exchangeName = config.getExchange();
            const credentials = config.getApiCredentials();
            const isPaperTrading = config.isPaperTrading();

            Logger.info(`初始化交易所: ${exchangeName}, 模式: ${isPaperTrading ? '模拟盘' : '实盘'}`);

            // 创建交易所实例
            const ExchangeClass = ccxt[exchangeName];
            if (!ExchangeClass) {
                throw new Error(`不支持的交易所: ${exchangeName}`);
            }

            const options = {
                apiKey: credentials.apiKey,
                secret: credentials.apiSecret,
                password: credentials.passphrase,
                enableRateLimit: true, // 启用内置速率限制
                sandbox: isPaperTrading, // 模拟盘模式
            };

            // 针对不同交易所的特殊配置
            if (exchangeName === 'bitget') {
                if (isPaperTrading) {
                    // Bitget模拟盘特殊配置
                    options.urls = {
                        api: {
                            public: 'https://api.bitget.com',
                            private: 'https://api.bitget.com'
                        }
                    };
                    options.options = { 
                        defaultType: 'swap',  // 合约模式
                        papertrading: true 
                    };
                } else {
                    // Bitget实盘配置
                    options.options = {
                        defaultType: 'swap'  // 合约模式
                    };
                }
            }

            this.exchange = new ExchangeClass(options);

            // 验证连接
            await this.exchange.loadMarkets();
            Logger.info('交易所连接成功');

        } catch (error) {
            Logger.error('交易所初始化失败:', error);
            throw error;
        }
    }

    /**
     * @description 加载并缓存市场信息
     */
    async loadMarkets() {
        try {
            Logger.info('加载市场信息...');
            this.markets = await this.exchange.loadMarkets();
            Logger.info(`成功加载 ${Object.keys(this.markets).length} 个交易对`);
        } catch (error) {
            Logger.error('加载市场信息失败:', error);
            throw error;
        }
    }

    /**
     * @description 获取指定交易对的市场信息
     * @param {string} symbol - 交易对符号
     * @returns {object} 市场信息，包含精度和限制
     */
    getMarket(symbol) {
        if (!this.markets) {
            throw new Error('市场信息未加载，请先调用 loadMarkets()');
        }
        
        const market = this.markets[symbol];
        if (!market) {
            throw new Error(`未找到交易对: ${symbol}`);
        }
        
        return market;
    }

    /**
     * @description 执行带重试逻辑的API调用
     * @param {Function} apiCall - API调用函数
     * @param {string} operation - 操作名称，用于日志
     * @param {...any} args - API调用参数
     * @returns {Promise<any>} API调用结果
     */
    async executeWithRetry(apiCall, operation, ...args) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const result = await apiCall.apply(this.exchange, args);
                if (attempt > 1) {
                    Logger.info(`${operation} 重试成功 (第${attempt}次尝试)`);
                }
                return result;
            } catch (error) {
                lastError = error;
                
                // 检查是否为可重试的错误
                if (this.isRetryableError(error) && attempt < this.maxRetries) {
                    const delay = Math.pow(2, attempt - 1) * 1000; // 指数退避: 1s, 2s, 4s
                    Logger.warn(`${operation} 失败，${delay}ms后重试 (第${attempt}/${this.maxRetries}次): ${error.message}`);
                    await this.sleep(delay);
                    continue;
                }
                
                // 不可重试的错误或达到最大重试次数
                Logger.error(`${operation} 最终失败: ${error.message}`);
                throw error;
            }
        }
        
        throw lastError;
    }

    /**
     * @description 判断错误是否可重试
     * @param {Error} error - 错误对象
     * @returns {boolean} 是否可重试
     */
    isRetryableError(error) {
        // 网络错误、超时错误、交易所临时繁忙等可重试
        return error instanceof ccxt.NetworkError ||
               error instanceof ccxt.RequestTimeout ||
               error instanceof ccxt.ExchangeNotAvailable ||
               (error instanceof ccxt.ExchangeError && error.message.includes('busy'));
    }

    /**
     * @description 延迟函数
     * @param {number} ms - 延迟毫秒数
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * @description 获取账户余额
     * @returns {Promise<object>} 账户余额信息
     */
    async fetchBalance() {
        return await this.executeWithRetry(
            this.exchange.fetchBalance,
            '获取账户余额'
        );
    }

    /**
     * @description 获取当前持仓信息
     * @param {Array<string>} [symbols] - 可选的交易对列表
     * @returns {Promise<Array>} 持仓信息列表
     */
    async fetchPositions(symbols = undefined) {
        return await this.executeWithRetry(
            this.exchange.fetchPositions,
            '获取持仓信息',
            symbols
        );
    }

    /**
     * @description 创建订单
     * @param {string} symbol - 交易对符号
     * @param {string} type - 订单类型 (market, limit)
     * @param {string} side - 买卖方向 (buy, sell)
     * @param {number} amount - 数量
     * @param {number} [price] - 价格 (限价单必需)
     * @param {object} [params] - 额外参数
     * @returns {Promise<object>} 订单信息
     */
    async createOrder(symbol, type, side, amount, price = undefined, params = {}) {
        return await this.executeWithRetry(
            this.exchange.createOrder,
            `创建订单 ${symbol} ${side} ${amount}`,
            symbol,
            type,
            side,
            amount,
            price,
            params
        );
    }

    /**
     * @description 取消订单
     * @param {string} id - 订单ID
     * @param {string} symbol - 交易对符号
     * @param {object} [params] - 额外参数
     * @returns {Promise<object>} 取消结果
     */
    async cancelOrder(id, symbol, params = {}) {
        return await this.executeWithRetry(
            this.exchange.cancelOrder,
            `取消订单 ${id}`,
            id,
            symbol,
            params
        );
    }

    /**
     * @description 获取未成交订单
     * @param {string} [symbol] - 交易对符号
     * @param {number} [since] - 起始时间戳
     * @param {number} [limit] - 限制数量
     * @param {object} [params] - 额外参数
     * @returns {Promise<Array>} 订单列表
     */
    async fetchOpenOrders(symbol = undefined, since = undefined, limit = undefined, params = {}) {
        return await this.executeWithRetry(
            this.exchange.fetchOpenOrders,
            '获取未成交订单',
            symbol,
            since,
            limit,
            params
        );
    }

    /**
     * @description 设置杠杆
     * @param {string} symbol - 交易对符号
     * @param {number} leverage - 杠杆倍数
     * @param {object} [params] - 额外参数
     * @returns {Promise<object>} 设置结果
     */
    async setLeverage(symbol, leverage, params = {}) {
        return await this.executeWithRetry(
            this.exchange.setLeverage,
            `设置杠杆 ${symbol} ${leverage}x`,
            leverage,
            symbol,
            params
        );
    }

    /**
     * @description 获取K线数据
     * @param {string} symbol - 交易对符号
     * @param {string} timeframe - 时间周期 (1m, 5m, 1h, 1d等)
     * @param {number} [since] - 起始时间戳
     * @param {number} [limit] - 限制数量
     * @param {object} [params] - 额外参数
     * @returns {Promise<Array>} K线数据
     */
    async fetchOHLCV(symbol, timeframe, since = undefined, limit = undefined, params = {}) {
        return await this.executeWithRetry(
            this.exchange.fetchOHLCV,
            `获取K线数据 ${symbol} ${timeframe}`,
            symbol,
            timeframe,
            since,
            limit,
            params
        );
    }

    /**
     * @description 获取最新市场行情
     * @param {string} symbol - 交易对符号
     * @returns {Promise<object>} 行情数据
     */
    async fetchTicker(symbol) {
        return await this.executeWithRetry(
            this.exchange.fetchTicker,
            `获取行情 ${symbol}`,
            symbol
        );
    }

    /**
     * @description 获取交易所实例 (谨慎使用，避免抽象泄漏)
     * @returns {ccxt.Exchange} 交易所实例
     */
    getExchangeInstance() {
        if (!this.exchange) {
            throw new Error('交易所未初始化');
        }
        return this.exchange;
    }

    /**
     * @description 检查交易所是否已初始化
     * @returns {boolean} 是否已初始化
     */
    isInitialized() {
        return this.exchange !== null;
    }
}

module.exports = ExchangeService.getInstance();