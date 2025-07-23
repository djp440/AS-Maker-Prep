const MarketDataService = require('../market_data_service');
const WebSocketManager = require('../websocket_manager');
const ExchangeService = require('../exchange_service');
const Config = require('../../shared/config');
const Logger = require('../../shared/logger');

// Mock dependencies
jest.mock('../websocket_manager');
jest.mock('../exchange_service');
jest.mock('../../shared/config');
jest.mock('../../shared/logger');

describe('MarketDataService', () => {
    let marketDataService;
    let mockConfig;
    let mockWebSocketManager;
    let mockExchangeService;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Create fresh instance
        MarketDataService.instance = null;
        marketDataService = new MarketDataService();
        
        // Setup mock config
        mockConfig = {
            getSymbols: jest.fn().mockReturnValue([
                {
                    SYMBOL: 'BTC/USDT:USDT',
                    VOLATILITY_LOOKBACK: 14,
                    KLINE_INTERVAL: '15m'
                }
            ])
        };
        
        // Setup mock WebSocketManager
        mockWebSocketManager = {
            on: jest.fn(),
            emit: jest.fn()
        };
        WebSocketManager.on = mockWebSocketManager.on;
        
        // Setup mock ExchangeService
        mockExchangeService = {
            fetchOHLCV: jest.fn()
        };
        ExchangeService.fetchOHLCV = mockExchangeService.fetchOHLCV;
        
        // Setup mock Logger
        Logger.info = jest.fn();
        Logger.warn = jest.fn();
        Logger.error = jest.fn();
        Logger.debug = jest.fn();
    });

    afterEach(() => {
        if (marketDataService && marketDataService.getIsInitialized()) {
            marketDataService.cleanup();
        }
    });

    describe('Singleton Pattern', () => {
        test('应该返回同一个实例', () => {
            const instance1 = MarketDataService.getInstance();
            const instance2 = MarketDataService.getInstance();
            expect(instance1).toBe(instance2);
        });
    });

    describe('Initialization', () => {
        test('应该成功初始化', async () => {
            // Mock OHLCV data for volatility calculation
            const mockOHLCV = [];
            for (let i = 0; i < 15; i++) {
                mockOHLCV.push([Date.now() - i * 900000, 50000 + i * 100, 50100 + i * 100, 49900 + i * 100, 50000 + i * 100, 1000]);
            }
            mockExchangeService.fetchOHLCV.mockResolvedValue(mockOHLCV);
            
            await marketDataService.initialize(mockConfig);
            
            expect(marketDataService.getIsInitialized()).toBe(true);
            expect(mockConfig.getSymbols).toHaveBeenCalled();
            expect(mockWebSocketManager.on).toHaveBeenCalledWith('ticker', expect.any(Function));
            expect(mockWebSocketManager.on).toHaveBeenCalledWith('orderbook', expect.any(Function));
            expect(Logger.info).toHaveBeenCalledWith('MarketDataService初始化完成');
        });

        test('重复初始化应该发出警告', async () => {
            const mockOHLCV = [];
            for (let i = 0; i < 15; i++) {
                mockOHLCV.push([Date.now() - i * 900000, 50000, 50100, 49900, 50000, 1000]);
            }
            mockExchangeService.fetchOHLCV.mockResolvedValue(mockOHLCV);
            
            await marketDataService.initialize(mockConfig);
            await marketDataService.initialize(mockConfig);
            
            expect(Logger.warn).toHaveBeenCalledWith('MarketDataService已经初始化');
        });
    });

    describe('Market Data Management', () => {
        beforeEach(async () => {
            const mockOHLCV = [];
            for (let i = 0; i < 15; i++) {
                mockOHLCV.push([Date.now() - i * 900000, 50000, 50100, 49900, 50000, 1000]);
            }
            mockExchangeService.fetchOHLCV.mockResolvedValue(mockOHLCV);
            await marketDataService.initialize(mockConfig);
        });

        test('应该正确处理ticker数据更新', () => {
            const symbol = 'BTC/USDT:USDT';
            const tickerData = {
                bid: 49950,
                ask: 50050
            };
            
            // Get the ticker event handler
            const tickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
            
            // Simulate ticker event
            tickerHandler({ symbol, data: tickerData });
            
            const midPrice = marketDataService.getMidPrice(symbol);
            const marketData = marketDataService.getMarketData(symbol);
            
            expect(midPrice).toBe(50000);
            expect(marketData.bestBid).toBe(49950);
            expect(marketData.bestAsk).toBe(50050);
            expect(marketData.spread).toBe(100);
            expect(marketData.spreadPct).toBe(0.2);
        });

        test('应该正确处理orderbook数据更新', () => {
            const symbol = 'BTC/USDT:USDT';
            const orderbookData = {
                bids: [[49960, 1.5], [49950, 2.0]],
                asks: [[50040, 1.2], [50050, 1.8]]
            };
            
            // Get the orderbook event handler
            const orderbookHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'orderbook')[1];
            
            // Simulate orderbook event
            orderbookHandler({ symbol, data: orderbookData });
            
            const midPrice = marketDataService.getMidPrice(symbol);
            const marketData = marketDataService.getMarketData(symbol);
            
            expect(midPrice).toBe(50000);
            expect(marketData.bestBid).toBe(49960);
            expect(marketData.bestAsk).toBe(50040);
            expect(marketData.spread).toBe(80);
        });

        test('应该忽略未知交易对的数据', () => {
            const symbol = 'ETH/USDT:USDT';
            const tickerData = {
                bid: 3000,
                ask: 3010
            };
            
            const tickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
            tickerHandler({ symbol, data: tickerData });
            
            expect(Logger.warn).toHaveBeenCalledWith(`收到未知交易对的ticker数据: ${symbol}`);
            expect(marketDataService.getMidPrice(symbol)).toBeNull();
        });
    });

    describe('Volatility Calculation', () => {
        beforeEach(async () => {
            const mockOHLCV = [];
            for (let i = 0; i < 15; i++) {
                const price = 50000 + Math.sin(i * 0.1) * 1000; // 模拟价格波动
                mockOHLCV.push([Date.now() - i * 900000, price, price + 100, price - 100, price, 1000]);
            }
            mockExchangeService.fetchOHLCV.mockResolvedValue(mockOHLCV);
            await marketDataService.initialize(mockConfig);
        });

        test('应该计算并返回波动率', () => {
            const symbol = 'BTC/USDT:USDT';
            const volatility = marketDataService.getVolatility(symbol);
            
            expect(volatility).not.toBeNull();
            expect(typeof volatility).toBe('number');
            expect(volatility).toBeGreaterThan(0);
        });

        test('K线数据不足时应该返回null', async () => {
            // Reset and reinitialize with insufficient data
            marketDataService.cleanup();
            MarketDataService.instance = null;
            marketDataService = new MarketDataService();
            
            const insufficientOHLCV = [
                [Date.now(), 50000, 50100, 49900, 50000, 1000]
            ];
            mockExchangeService.fetchOHLCV.mockResolvedValue(insufficientOHLCV);
            
            await marketDataService.initialize(mockConfig);
            
            const symbol = 'BTC/USDT:USDT';
            const volatility = marketDataService.getVolatility(symbol);
            
            expect(volatility).toBeNull();
            expect(Logger.warn).toHaveBeenCalledWith(`${symbol} K线数据不足，无法计算波动率`);
        });
    });

    describe('Data Validation', () => {
        beforeEach(async () => {
            const mockOHLCV = [];
            for (let i = 0; i < 15; i++) {
                mockOHLCV.push([Date.now() - i * 900000, 50000, 50100, 49900, 50000, 1000]);
            }
            mockExchangeService.fetchOHLCV.mockResolvedValue(mockOHLCV);
            await marketDataService.initialize(mockConfig);
        });

        test('应该检测异常价差', () => {
            const symbol = 'BTC/USDT:USDT';
            const tickerData = {
                bid: 45000,  // 异常大的价差
                ask: 55000
            };
            
            const warningListener = jest.fn();
            marketDataService.on('dataValidationWarning', warningListener);
            
            const tickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
            tickerHandler({ symbol, data: tickerData });
            
            expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('价差异常扩大'));
            expect(warningListener).toHaveBeenCalledWith(expect.objectContaining({
                symbol,
                type: 'spread'
            }));
        });

        test('应该检测异常价格', () => {
            const symbol = 'BTC/USDT:USDT';
            const tickerData = {
                bid: -100,  // 负价格
                ask: 0
            };
            
            const warningListener = jest.fn();
            marketDataService.on('dataValidationWarning', warningListener);
            
            const tickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
            tickerHandler({ symbol, data: tickerData });
            
            expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('价格数据异常'));
            expect(warningListener).toHaveBeenCalledWith(expect.objectContaining({
                symbol,
                type: 'price'
            }));
        });

        test('应该检测买卖价顺序异常', () => {
            const symbol = 'BTC/USDT:USDT';
            const tickerData = {
                bid: 50100,  // 买价高于卖价
                ask: 50000
            };
            
            const warningListener = jest.fn();
            marketDataService.on('dataValidationWarning', warningListener);
            
            const tickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
            tickerHandler({ symbol, data: tickerData });
            
            expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('买卖价顺序异常'));
            expect(warningListener).toHaveBeenCalledWith(expect.objectContaining({
                symbol,
                type: 'order'
            }));
        });
    });

    describe('API Methods', () => {
        beforeEach(async () => {
            const mockOHLCV = [];
            for (let i = 0; i < 15; i++) {
                mockOHLCV.push([Date.now() - i * 900000, 50000, 50100, 49900, 50000, 1000]);
            }
            mockExchangeService.fetchOHLCV.mockResolvedValue(mockOHLCV);
            await marketDataService.initialize(mockConfig);
        });

        test('getMidPrice应该返回正确的中间价', () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 初始状态应该为null
            expect(marketDataService.getMidPrice(symbol)).toBeNull();
            
            // 模拟ticker更新
            const tickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
            tickerHandler({ symbol, data: { bid: 49950, ask: 50050 } });
            
            expect(marketDataService.getMidPrice(symbol)).toBe(50000);
        });

        test('getVolatility应该返回正确的波动率', () => {
            const symbol = 'BTC/USDT:USDT';
            const volatility = marketDataService.getVolatility(symbol);
            
            expect(volatility).not.toBeNull();
            expect(typeof volatility).toBe('number');
        });

        test('getMarketData应该返回完整的市场数据副本', () => {
            const symbol = 'BTC/USDT:USDT';
            const marketData = marketDataService.getMarketData(symbol);
            
            expect(marketData).not.toBeNull();
            expect(marketData.symbol).toBe(symbol);
            expect(marketData).toHaveProperty('midPrice');
            expect(marketData).toHaveProperty('volatility');
            
            // 确保返回的是副本
            marketData.midPrice = 999999;
            const marketData2 = marketDataService.getMarketData(symbol);
            expect(marketData2.midPrice).not.toBe(999999);
        });

        test('getAllMarketData应该返回所有交易对的数据', () => {
            const allData = marketDataService.getAllMarketData();
            
            expect(allData).toBeInstanceOf(Map);
            expect(allData.size).toBe(1);
            expect(allData.has('BTC/USDT:USDT')).toBe(true);
        });

        test('未知交易对应该返回null', () => {
            const unknownSymbol = 'ETH/USDT:USDT';
            
            expect(marketDataService.getMidPrice(unknownSymbol)).toBeNull();
            expect(marketDataService.getVolatility(unknownSymbol)).toBeNull();
            expect(marketDataService.getMarketData(unknownSymbol)).toBeNull();
        });
    });

    describe('Cleanup', () => {
        test('应该正确清理资源', async () => {
            const mockOHLCV = [];
            for (let i = 0; i < 15; i++) {
                mockOHLCV.push([Date.now() - i * 900000, 50000, 50100, 49900, 50000, 1000]);
            }
            mockExchangeService.fetchOHLCV.mockResolvedValue(mockOHLCV);
            
            await marketDataService.initialize(mockConfig);
            expect(marketDataService.getIsInitialized()).toBe(true);
            
            marketDataService.cleanup();
            
            expect(marketDataService.getIsInitialized()).toBe(false);
            expect(Logger.info).toHaveBeenCalledWith('MarketDataService资源清理完成');
        });
    });
});