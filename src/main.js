/**
 * @file main.js
 * @description GLFT做市策略程序主入口
 * 负责初始化所有服务、启动交易实例、处理异常和优雅退出
 */

const Config = require('./shared/config');
const Logger = require('./shared/logger');
const ExchangeService = require('./services/exchange_service');
const WebSocketManager = require('./services/websocket_manager');
const MarketDataService = require('./services/market_data_service');
const AccountService = require('./services/account_service');
const Trader = require('./core/trader');
const { sleep } = require('./shared/asyncUtils');

/**
 * @class MainApplication
 * @description GLFT做市应用程序主控制器
 */
class MainApplication {
    constructor() {
        this.traders = new Map(); // 存储所有交易对的Trader实例
        this.isShuttingDown = false;
        this.services = {
            config: null,
            exchange: null,
            websocket: null,
            marketData: null,
            account: null
        };
    }

    /**
     * @description 应用程序启动入口
     */
    async start() {
        try {
            Logger.info('🚀 GLFT做市程序启动中...');
            
            // 1. 加载配置
            await this.loadConfiguration();
            
            // 2. 初始化核心服务
            await this.initializeServices();
            
            // 3. 启动前准备
            await this.prepareForTrading();
            
            // 4. 创建并启动交易对实例
            await this.startTradingPairs();
            
            // 5. 设置异常处理和优雅退出
            this.setupExceptionHandling();
            this.setupGracefulShutdown();
            
            Logger.info('✅ GLFT做市程序启动完成');
            Logger.info(`📊 当前运行交易对数量: ${this.traders.size}`);
            
        } catch (error) {
            Logger.error('❌ 程序启动失败:', error);
            await this.shutdown(1);
        }
    }

    /**
     * @description 加载和验证配置
     */
    async loadConfiguration() {
        try {
            Logger.info('📋 加载配置文件...');
            
            // 加载配置文件
            await Config.load('config.json', '.env');
            this.services.config = Config;
            
            // 验证关键配置
            const exchange = Config.getExchange();
            const symbols = Config.getSymbols();
            const credentials = Config.getApiCredentials();
            
            if (!exchange) {
                throw new Error('交易所配置缺失');
            }
            
            if (!symbols || symbols.length === 0) {
                throw new Error('交易对配置缺失');
            }
            
            if (!credentials.apiKey || !credentials.apiSecret) {
                throw new Error('API凭据配置缺失');
            }
            
            Logger.info(`✅ 配置加载成功 - 交易所: ${exchange}, 交易对数量: ${symbols.length}`);
            
        } catch (error) {
            Logger.error('❌ 配置加载失败:', error.message);
            throw error;
        }
    }

    /**
     * @description 初始化所有核心服务
     */
    async initializeServices() {
        try {
            Logger.info('🔧 初始化核心服务...');
            
            // 初始化交易所服务
            Logger.info('初始化交易所服务...');
            this.services.exchange = ExchangeService;
            await this.services.exchange.initialize(Config);
            Logger.info('✅ 交易所服务初始化完成');
            
            // 初始化WebSocket管理器
            Logger.info('初始化WebSocket管理器...');
            this.services.websocket = WebSocketManager;
            await this.services.websocket.initialize(Config);
            Logger.info('✅ WebSocket管理器初始化完成');
            
            // 初始化市场数据服务
            Logger.info('初始化市场数据服务...');
            this.services.marketData = MarketDataService.getInstance();
            await this.services.marketData.initialize(Config);
            Logger.info('✅ 市场数据服务初始化完成');
            
            // 初始化账户服务
            Logger.info('初始化账户服务...');
            this.services.account = AccountService;
            await this.services.account.initialize({
                exchangeService: this.services.exchange,
                websocketManager: this.services.websocket
            });
            Logger.info('✅ 账户服务初始化完成');
            
        } catch (error) {
            Logger.error('❌ 服务初始化失败:', error.message);
            throw error;
        }
    }

    /**
     * @description 启动前准备工作
     */
    async prepareForTrading() {
        try {
            Logger.info('🔄 执行启动前准备...');
            
            // 加载市场信息
            Logger.info('加载交易所市场信息...');
            await this.services.exchange.loadMarkets();
            Logger.info('✅ 市场信息加载完成');
            
            // 等待WebSocket连接稳定
            Logger.info('等待WebSocket连接稳定...');
            let retries = 0;
            const maxRetries = 10;
            while (!this.services.websocket.isConnected() && retries < maxRetries) {
                await sleep(1000);
                retries++;
            }
            
            if (!this.services.websocket.isConnected()) {
                throw new Error('WebSocket连接超时');
            }
            Logger.info('✅ WebSocket连接已建立');
            
            // 执行初始账户同步
            Logger.info('执行初始账户同步...');
            await this.services.account.forceSyncData();
            Logger.info('✅ 账户同步完成');
            
        } catch (error) {
            Logger.error('❌ 启动前准备失败:', error.message);
            throw error;
        }
    }

    /**
     * @description 创建并启动所有交易对的Trader实例
     */
    async startTradingPairs() {
        try {
            Logger.info('🎯 启动交易对实例...');
            
            const symbols = Config.getSymbols();
            
            for (const symbolConfig of symbols) {
                await this.startTradingPair(symbolConfig);
            }
            
            Logger.info(`✅ 所有交易对启动完成，共 ${this.traders.size} 个`);
            
        } catch (error) {
            Logger.error('❌ 交易对启动失败:', error.message);
            throw error;
        }
    }

    /**
     * @description 启动单个交易对的Trader实例
     * @param {Object} symbolConfig - 交易对配置
     */
    async startTradingPair(symbolConfig) {
        const symbol = symbolConfig.SYMBOL;
        
        try {
            Logger.info(`🔧 启动交易对: ${symbol}`);
            
            // 设置杠杆
            if (symbolConfig.LEVERAGE && symbolConfig.LEVERAGE > 1) {
                Logger.info(`设置 ${symbol} 杠杆: ${symbolConfig.LEVERAGE}x`);
                await this.services.exchange.setLeverage(symbol, symbolConfig.LEVERAGE);
            }
            
            // 创建Trader实例
            const trader = new Trader(symbol, symbolConfig, {
                exchangeService: this.services.exchange,
                websocketManager: this.services.websocket,
                marketDataService: this.services.marketData,
                accountService: this.services.account
            });
            
            // 启动Trader
            await trader.start();
            
            // 存储Trader实例
            this.traders.set(symbol, trader);
            
            Logger.info(`✅ ${symbol} Trader启动成功`);
            
        } catch (error) {
            Logger.error(`❌ ${symbol} Trader启动失败:`, error.message);
            throw error;
        }
    }

    /**
     * @description 设置全局异常处理
     */
    setupExceptionHandling() {
        // 捕获未处理的异常
        process.on('uncaughtException', async (error) => {
            Logger.error('💥 未捕获的异常:', error);
            await this.shutdown(1);
        });
        
        // 捕获未处理的Promise拒绝
        process.on('unhandledRejection', async (reason, promise) => {
            Logger.error('💥 未处理的Promise拒绝:', reason);
            Logger.error('Promise:', promise);
            await this.shutdown(1);
        });
        
        Logger.info('✅ 全局异常处理已设置');
    }

    /**
     * @description 设置优雅退出处理
     */
    setupGracefulShutdown() {
        // 监听退出信号
        process.on('SIGINT', async () => {
            Logger.info('📡 接收到SIGINT信号，开始优雅退出...');
            await this.shutdown(0);
        });
        
        process.on('SIGTERM', async () => {
            Logger.info('📡 接收到SIGTERM信号，开始优雅退出...');
            await this.shutdown(0);
        });
        
        Logger.info('✅ 优雅退出处理已设置');
    }

    /**
     * @description 优雅关闭应用程序
     * @param {number} exitCode - 退出代码
     */
    async shutdown(exitCode = 0) {
        if (this.isShuttingDown) {
            Logger.warn('⚠️ 程序已在关闭中，忽略重复关闭请求');
            return;
        }
        
        this.isShuttingDown = true;
        Logger.info('🔄 开始优雅关闭程序...');
        
        try {
            // 停止所有Trader实例
            if (this.traders.size > 0) {
                Logger.info('停止所有交易实例...');
                const stopPromises = [];
                
                for (const [symbol, trader] of this.traders) {
                    Logger.info(`停止 ${symbol} 交易实例...`);
                    stopPromises.push(
                        trader.stop().catch(error => {
                            Logger.error(`停止 ${symbol} 交易实例失败:`, error.message);
                        })
                    );
                }
                
                await Promise.all(stopPromises);
                Logger.info('✅ 所有交易实例已停止');
            }
            
            // 关闭WebSocket连接
            if (this.services.websocket) {
                Logger.info('关闭WebSocket连接...');
                await this.services.websocket.close();
                Logger.info('✅ WebSocket连接已关闭');
            }
            
            // 清理资源
            this.traders.clear();
            
            Logger.info('✅ 程序优雅关闭完成');
            
        } catch (error) {
            Logger.error('❌ 关闭过程中发生错误:', error.message);
        } finally {
            // 等待日志写入完成
            await sleep(1000);
            process.exit(exitCode);
        }
    }

    /**
     * @description 获取程序运行状态
     * @returns {Object} 运行状态信息
     */
    getStatus() {
        const traderStatus = {};
        for (const [symbol, trader] of this.traders) {
            traderStatus[symbol] = trader.getStatus();
        }
        
        return {
            isRunning: !this.isShuttingDown,
            tradersCount: this.traders.size,
            traders: traderStatus,
            services: {
                exchange: this.services.exchange?.isInitialized() || false,
                websocket: this.services.websocket?.isConnected() || false,
                marketData: this.services.marketData?.isInitialized() || false,
                account: this.services.account?.isInitialized() || false
            }
        };
    }
}

// 创建并启动应用程序
if (require.main === module) {
    const app = new MainApplication();
    app.start().catch(error => {
        console.error('程序启动失败:', error);
        process.exit(1);
    });
}

module.exports = MainApplication;