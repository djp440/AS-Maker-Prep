const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');

/**
 * @class Config
 * @description 加载、解析和验证配置文件的单例类。
 */
class Config {
    /**
     * @private
     * @type {Config | null}
     */
    static instance = null;

    /**
     * @private
     * @type {object | null}
     */
    config = null;

    /**
     * @private
     * @constructor
     */
    constructor() {
        // 私有构造函数，防止外部实例化
    }

    /**
     * @description 获取 Config 的单例实例。
     * @returns {Config}
     */
    static getInstance() {
        if (!Config.instance) {
            Config.instance = new Config();
        }
        return Config.instance;
    }

    /**
     * @description 异步加载和验证配置。
     * @param {string} [configPath='config.json'] - config.json 文件的路径。
     * @param {string} [envPath='.env'] - .env 文件的路径。
     */
    async load(configPath = 'config.json', envPath = '.env') {
        if (this.config) {
            return; // 配置已加载
        }

        // 加载 .env 文件
        dotenv.config({ path: path.resolve(process.cwd(), envPath) });

        // 加载 config.json 文件
        const resolvedConfigPath = path.resolve(process.cwd(), configPath);
        const configFile = await fs.readFile(resolvedConfigPath, 'utf8');
        this.config = JSON.parse(configFile);

        this.validate();
    }

    /**
     * @private
     * @description 验证加载的配置是否有效。
     */
    validate() {
        const { EXCHANGE, SYMBOLS } = this.config;
        const { API_KEY, API_SECRET } = this.getApiCredentials();

        if (!EXCHANGE) {
            throw new Error('Config Error: EXCHANGE is not defined in config.json');
        }

        if (!API_KEY || !API_SECRET) {
            throw new Error('Config Error: API_KEY or API_SECRET is not defined in .env');
        }

        if (!Array.isArray(SYMBOLS) || SYMBOLS.length === 0) {
            throw new Error('Config Error: SYMBOLS must be a non-empty array in config.json');
        }

        for (const symbolConfig of SYMBOLS) {
            if (!symbolConfig.SYMBOL || typeof symbolConfig.SYMBOL !== 'string') {
                throw new Error('Config Error: Invalid SYMBOL in config.json');
            }
            // ... 可添加更多针对每个交易对的详细验证
            if (typeof symbolConfig.LEVERAGE !== 'number') {
                throw new Error(`Config Error: LEVERAGE for ${symbolConfig.SYMBOL} must be a number.`);
            }
            if (!['long', 'short', 'both'].includes(symbolConfig.TRADE_SIDE)) {
                throw new Error(`Config Error: TRADE_SIDE for ${symbolConfig.SYMBOL} must be 'long', 'short', or 'both'.`);
            }
        }
    }

    /**
     * @description 获取API密钥信息。
     * @returns {{API_KEY: string, API_SECRET: string, API_PASSWORD?: string}}
     */
    getApiCredentials() {
        const isPaper = process.env.PAPER_TRADING === 'true';
        return {
            API_KEY: isPaper ? process.env.PAPER_API_KEY : process.env.API_KEY,
            API_SECRET: isPaper ? process.env.PAPER_API_SECRET : process.env.API_SECRET,
            API_PASSWORD: isPaper ? process.env.PAPER_API_PASSWORD : process.env.API_PASSWORD,
        };
    }

    /**
     * @description 获取交易所名称。
     * @returns {string}
     */
    getExchange() {
        return this.config.EXCHANGE;
    }

    /**
     * @description 获取所有交易对的配置列表。
     * @returns {Array<object>}
     */
    getSymbols() {
        return this.config.SYMBOLS;
    }

    /**
     * @description 根据交易对符号获取特定策略参数。
     * @param {string} symbol - 交易对符号, e.g., 'BTC/USDT:USDT'.
     * @returns {object | undefined}
     */
    getStrategyParams(symbol) {
        return this.config.SYMBOLS.find(s => s.SYMBOL === symbol);
    }

     /**
     * @description 检查是否启用模拟盘
     * @returns {boolean}
     */
    isPaperTrading() {
        return process.env.PAPER_TRADING === 'true';
    }
}

module.exports = Config.getInstance();