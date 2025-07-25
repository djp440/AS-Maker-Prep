/**
 * @file main.test.js
 * @description main.js模块的单元测试
 */

const MainApplication = require('../main');
const Config = require('../shared/config');
const Logger = require('../shared/logger');
const ExchangeService = require('../services/exchange_service');
const WebSocketManager = require('../services/websocket_manager');
const MarketDataService = require('../services/market_data_service');
const AccountService = require('../services/account_service');
const Trader = require('../core/trader');

// Mock所有依赖
jest.mock('../shared/config');
jest.mock('../shared/logger');
jest.mock('../services/exchange_service');
jest.mock('../services/websocket_manager');
jest.mock('../services/market_data_service');
jest.mock('../services/account_service');
jest.mock('../core/trader');
jest.mock('../shared/asyncUtils', () => ({
    sleep: jest.fn().mockResolvedValue()
}));

describe('MainApplication', () => {
    let app;
    let mockConfig;
    let mockExchangeService;
    let mockWebSocketManager;
    let mockMarketDataService;
    let mockAccountService;
    let mockTrader;

    beforeEach(() => {
        // 重置所有mock
        jest.clearAllMocks();
        
        // 设置Config mock
        mockConfig = {
            load: jest.fn().mockResolvedValue(),
            getExchange: jest.fn().mockReturnValue('bitget'),
            getSymbols: jest.fn().mockReturnValue([
                {
                    SYMBOL: 'BTC/USDT:USDT',
                    LEVERAGE: 10,
                    RISK_AVERSION: 0.5,
                    ORDER_FLOW: 0.3,
                    MAX_INVENTORY: 1000,
                    ORDER_AMOUNT: 100,
                    VOLATILITY_LOOKBACK: 20,
                    KLINE_INTERVAL: '1m',
                    TRADE_DIRECTION: 'both',
                    MIN_SPREAD_PCT: 0.01,
                    HALF_SPREAD_PCT: 0.005,
                    REBALANCE_INTERVAL: 5000,
                    PRICE_CHANGE_THRESHOLD: 0.001,
                    USE_TRADITIONAL_GLFT: false
                },
                {
                    SYMBOL: 'ETH/USDT:USDT',
                    LEVERAGE: 5,
                    RISK_AVERSION: 0.4,
                    ORDER_FLOW: 0.25,
                    MAX_INVENTORY: 500,
                    ORDER_AMOUNT: 50,
                    VOLATILITY_LOOKBACK: 15,
                    KLINE_INTERVAL: '1m',
                    TRADE_DIRECTION: 'both',
                    MIN_SPREAD_PCT: 0.015,
                    HALF_SPREAD_PCT: 0.0075,
                    REBALANCE_INTERVAL: 6000,
                    PRICE_CHANGE_THRESHOLD: 0.0015,
                    USE_TRADITIONAL_GLFT: false
                }
            ]),
            getApiCredentials: jest.fn().mockReturnValue({
                apiKey: 'test-api-key',
                apiSecret: 'test-api-secret',
                passphrase: 'test-passphrase'
            })
        };
        Config.load = mockConfig.load;
        Config.getExchange = mockConfig.getExchange;
        Config.getSymbols = mockConfig.getSymbols;
        Config.getApiCredentials = mockConfig.getApiCredentials;
        
        // 设置服务mock
        mockExchangeService = {
            initialize: jest.fn().mockResolvedValue(),
            loadMarkets: jest.fn().mockResolvedValue(),
            setLeverage: jest.fn().mockResolvedValue(),
            isInitialized: jest.fn().mockReturnValue(true)
        };
        ExchangeService.initialize = mockExchangeService.initialize;
        ExchangeService.loadMarkets = mockExchangeService.loadMarkets;
        ExchangeService.setLeverage = mockExchangeService.setLeverage;
        ExchangeService.isInitialized = mockExchangeService.isInitialized;
        
        mockWebSocketManager = {
            initialize: jest.fn().mockResolvedValue(),
            isConnected: jest.fn().mockReturnValue(true),
            close: jest.fn().mockResolvedValue()
        };
        WebSocketManager.initialize = mockWebSocketManager.initialize;
        WebSocketManager.isConnected = mockWebSocketManager.isConnected;
        WebSocketManager.close = mockWebSocketManager.close;
        
        mockMarketDataService = {
            initialize: jest.fn().mockResolvedValue(),
            isInitialized: jest.fn().mockReturnValue(true),
            getInstance: jest.fn()
        };
        mockMarketDataService.getInstance.mockReturnValue(mockMarketDataService);
        MarketDataService.getInstance = mockMarketDataService.getInstance;
        MarketDataService.initialize = mockMarketDataService.initialize;
        MarketDataService.isInitialized = mockMarketDataService.isInitialized;
        
        mockAccountService = {
            initialize: jest.fn().mockResolvedValue(),
            forceSyncData: jest.fn().mockResolvedValue(),
            isInitialized: jest.fn().mockReturnValue(true)
        };
        AccountService.initialize = mockAccountService.initialize;
        AccountService.forceSyncData = mockAccountService.forceSyncData;
        AccountService.isInitialized = mockAccountService.isInitialized;
        
        mockTrader = {
            start: jest.fn().mockResolvedValue(),
            stop: jest.fn().mockResolvedValue(),
            getStatus: jest.fn().mockReturnValue({ status: 'running' })
        };
        Trader.mockImplementation(() => mockTrader);
        
        // 设置Logger mock
        Logger.info = jest.fn();
        Logger.error = jest.fn();
        Logger.warn = jest.fn();
        
        // 创建应用实例
        app = new MainApplication();
    });

    describe('构造函数', () => {
        test('应该正确初始化实例属性', () => {
            expect(app.traders).toBeInstanceOf(Map);
            expect(app.isShuttingDown).toBe(false);
            expect(app.services).toEqual({
                config: null,
                exchange: null,
                websocket: null,
                marketData: null,
                account: null
            });
        });
    });

    describe('loadConfiguration', () => {
        test('应该成功加载配置', async () => {
            await app.loadConfiguration();
            
            expect(Config.load).toHaveBeenCalledWith('config.json', '.env');
            expect(app.services.config).toBe(Config);
            expect(mockConfig.getExchange).toHaveBeenCalled();
            expect(mockConfig.getSymbols).toHaveBeenCalled();
            expect(mockConfig.getApiCredentials).toHaveBeenCalled();
        });

        test('应该在交易所配置缺失时抛出错误', async () => {
            mockConfig.getExchange.mockReturnValue(null);
            
            await expect(app.loadConfiguration()).rejects.toThrow('交易所配置缺失');
        });

        test('应该在交易对配置缺失时抛出错误', async () => {
            mockConfig.getSymbols.mockReturnValue([]);
            
            await expect(app.loadConfiguration()).rejects.toThrow('交易对配置缺失');
        });

        test('应该在API凭据缺失时抛出错误', async () => {
            mockConfig.getApiCredentials.mockReturnValue({ apiKey: '', apiSecret: '' });
            
            await expect(app.loadConfiguration()).rejects.toThrow('API凭据配置缺失');
        });
    });

    describe('initializeServices', () => {
        test('应该成功初始化所有服务', async () => {
            await app.initializeServices();
            
            expect(mockExchangeService.initialize).toHaveBeenCalledWith(Config);
            expect(mockWebSocketManager.initialize).toHaveBeenCalledWith(Config);
            expect(mockMarketDataService.initialize).toHaveBeenCalledWith(Config);
            expect(mockAccountService.initialize).toHaveBeenCalledWith({
                exchangeService: ExchangeService,
                websocketManager: WebSocketManager
            });
        });

        test('应该在服务初始化失败时抛出错误', async () => {
            mockExchangeService.initialize.mockRejectedValue(new Error('初始化失败'));
            
            await expect(app.initializeServices()).rejects.toThrow('初始化失败');
        });
    });

    describe('prepareForTrading', () => {
        test('应该成功执行启动前准备', async () => {
            // 先设置服务引用
            app.services.exchange = ExchangeService;
            app.services.websocket = WebSocketManager;
            app.services.account = AccountService;
            
            await app.prepareForTrading();
            
            expect(mockExchangeService.loadMarkets).toHaveBeenCalled();
            expect(mockWebSocketManager.isConnected).toHaveBeenCalled();
            expect(mockAccountService.forceSyncData).toHaveBeenCalled();
        });

        test('应该在WebSocket连接超时时抛出错误', async () => {
            // 先设置服务引用
            app.services.exchange = ExchangeService;
            app.services.websocket = WebSocketManager;
            app.services.account = AccountService;
            
            mockWebSocketManager.isConnected.mockReturnValue(false);
            
            await expect(app.prepareForTrading()).rejects.toThrow('WebSocket连接超时');
        });
    });

    describe('startTradingPairs', () => {
        beforeEach(async () => {
            // 先初始化服务
            app.services.exchange = ExchangeService;
            app.services.websocket = WebSocketManager;
            app.services.marketData = MarketDataService;
            app.services.account = AccountService;
        });

        test('应该成功启动所有交易对', async () => {
            await app.startTradingPairs();
            
            expect(app.traders.size).toBe(2);
            expect(app.traders.has('BTC/USDT:USDT')).toBe(true);
            expect(app.traders.has('ETH/USDT:USDT')).toBe(true);
            expect(mockExchangeService.setLeverage).toHaveBeenCalledWith('BTC/USDT:USDT', 10);
            expect(mockExchangeService.setLeverage).toHaveBeenCalledWith('ETH/USDT:USDT', 5);
            expect(mockTrader.start).toHaveBeenCalledTimes(2);
        });

        test('应该在Trader启动失败时抛出错误', async () => {
            mockTrader.start.mockRejectedValue(new Error('Trader启动失败'));
            
            await expect(app.startTradingPairs()).rejects.toThrow('Trader启动失败');
        });
    });

    describe('shutdown', () => {
        beforeEach(async () => {
            // 设置一些Trader实例
            app.traders.set('BTC/USDT:USDT', mockTrader);
            app.traders.set('ETH/USDT:USDT', mockTrader);
            app.services.websocket = WebSocketManager;
        });

        test('应该成功执行优雅关闭', async () => {
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation();
            
            await app.shutdown(0);
            
            expect(app.isShuttingDown).toBe(true);
            expect(mockTrader.stop).toHaveBeenCalledTimes(2);
            expect(mockWebSocketManager.close).toHaveBeenCalled();
            expect(app.traders.size).toBe(0);
            expect(exitSpy).toHaveBeenCalledWith(0);
            
            exitSpy.mockRestore();
        });

        test('应该防止重复关闭', async () => {
            app.isShuttingDown = true;
            
            await app.shutdown(0);
            
            expect(mockTrader.stop).not.toHaveBeenCalled();
            expect(Logger.warn).toHaveBeenCalledWith('⚠️ 程序已在关闭中，忽略重复关闭请求');
        });
    });

    describe('getStatus', () => {
        test('应该返回正确的状态信息', () => {
            app.traders.set('BTC/USDT:USDT', mockTrader);
            app.services.exchange = ExchangeService;
            app.services.websocket = WebSocketManager;
            app.services.marketData = MarketDataService;
            app.services.account = AccountService;
            
            const status = app.getStatus();
            
            expect(status).toEqual({
                isRunning: true,
                tradersCount: 1,
                traders: {
                    'BTC/USDT:USDT': { status: 'running' }
                },
                services: {
                    exchange: true,
                    websocket: true,
                    marketData: true,
                    account: true
                }
            });
        });
    });

    describe('完整启动流程', () => {
        test('应该成功执行完整的启动流程', async () => {
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation();
            
            await app.start();
            
            // 验证启动流程的各个步骤
            expect(Config.load).toHaveBeenCalled();
            expect(mockExchangeService.initialize).toHaveBeenCalled();
            expect(mockWebSocketManager.initialize).toHaveBeenCalled();
            expect(mockMarketDataService.initialize).toHaveBeenCalled();
            expect(mockAccountService.initialize).toHaveBeenCalled();
            expect(mockExchangeService.loadMarkets).toHaveBeenCalled();
            expect(mockAccountService.forceSyncData).toHaveBeenCalled();
            expect(app.traders.size).toBe(2);
            
            exitSpy.mockRestore();
        });

        test('应该在启动失败时执行关闭流程', async () => {
            const exitSpy = jest.spyOn(process, 'exit').mockImplementation();
            mockConfig.load.mockRejectedValue(new Error('配置加载失败'));
            
            await app.start();
            
            expect(Logger.error).toHaveBeenCalledWith('❌ 程序启动失败:', expect.any(Error));
            expect(exitSpy).toHaveBeenCalledWith(1);
            
            exitSpy.mockRestore();
        });
    });
});