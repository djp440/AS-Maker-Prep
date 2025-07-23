const MarketDataService = require('../market_data_service');
const WebSocketManager = require('../websocket_manager');
const ExchangeService = require('../exchange_service');
const Config = require('../../shared/config');
const Logger = require('../../shared/logger');

// Mock dependencies for performance testing
jest.mock('../websocket_manager');
jest.mock('../exchange_service');
jest.mock('../../shared/config');
jest.mock('../../shared/logger');

/**
 * @description MarketDataService性能测试
 * 测试高频数据处理、内存使用和响应时间
 */
describe('MarketDataService Performance Tests', () => {
    let marketDataService;
    let mockConfig;
    let mockWebSocketManager;
    let mockExchangeService;
    let tickerHandler;
    let orderbookHandler;

    beforeEach(async () => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Create fresh instance
        MarketDataService.instance = null;
        marketDataService = new MarketDataService();
        
        // Setup mock config
        mockConfig = {
            getSymbols: jest.fn().mockReturnValue([
                { SYMBOL: 'BTC/USDT:USDT', VOLATILITY_LOOKBACK: 14, KLINE_INTERVAL: '15m' },
                { SYMBOL: 'ETH/USDT:USDT', VOLATILITY_LOOKBACK: 14, KLINE_INTERVAL: '15m' },
                { SYMBOL: 'SOL/USDT:USDT', VOLATILITY_LOOKBACK: 14, KLINE_INTERVAL: '15m' }
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

        // Mock OHLCV data
        const mockOHLCV = [];
        for (let i = 0; i < 15; i++) {
            mockOHLCV.push([Date.now() - i * 900000, 50000 + i * 100, 50100 + i * 100, 49900 + i * 100, 50000 + i * 100, 1000]);
        }
        mockExchangeService.fetchOHLCV.mockResolvedValue(mockOHLCV);

        // Initialize service
        await marketDataService.initialize(mockConfig);
        
        // Get event handlers
        tickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
        orderbookHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'orderbook')[1];
    });

    afterEach(() => {
        if (marketDataService && marketDataService.getIsInitialized()) {
            marketDataService.cleanup();
        }
    });

    describe('高频数据处理性能', () => {
        test('应该能够处理高频ticker更新', () => {
            const symbol = 'BTC/USDT:USDT';
            const updateCount = 10000;
            const startTime = Date.now();
            
            // 模拟高频ticker更新
            for (let i = 0; i < updateCount; i++) {
                const tickerData = {
                    bid: 50000 + Math.random() * 100,
                    ask: 50100 + Math.random() * 100
                };
                tickerHandler({ symbol, data: tickerData });
            }
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            const updatesPerSecond = updateCount / (duration / 1000);
            
            console.log(`处理 ${updateCount} 次ticker更新耗时: ${duration}ms`);
            console.log(`处理速度: ${updatesPerSecond.toFixed(0)} 更新/秒`);
            
            // 性能要求：应该能够处理至少1000次更新/秒
            expect(updatesPerSecond).toBeGreaterThan(1000);
            
            // 验证最终数据正确性
            const midPrice = marketDataService.getMidPrice(symbol);
            expect(midPrice).not.toBeNull();
            expect(typeof midPrice).toBe('number');
        });

        test('应该能够处理高频orderbook更新', () => {
            const symbol = 'BTC/USDT:USDT';
            const updateCount = 5000;
            const startTime = Date.now();
            
            // 模拟高频orderbook更新
            for (let i = 0; i < updateCount; i++) {
                const orderbookData = {
                    bids: [
                        [50000 + Math.random() * 50, 1.0 + Math.random()],
                        [49950 + Math.random() * 50, 2.0 + Math.random()]
                    ],
                    asks: [
                        [50050 + Math.random() * 50, 1.0 + Math.random()],
                        [50100 + Math.random() * 50, 2.0 + Math.random()]
                    ]
                };
                orderbookHandler({ symbol, data: orderbookData });
            }
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            const updatesPerSecond = updateCount / (duration / 1000);
            
            console.log(`处理 ${updateCount} 次orderbook更新耗时: ${duration}ms`);
            console.log(`处理速度: ${updatesPerSecond.toFixed(0)} 更新/秒`);
            
            // 性能要求：应该能够处理至少500次更新/秒
            expect(updatesPerSecond).toBeGreaterThan(500);
            
            // 验证最终数据正确性
            const marketData = marketDataService.getMarketData(symbol);
            expect(marketData).not.toBeNull();
            expect(marketData.bestBid).toBeDefined();
            expect(marketData.bestAsk).toBeDefined();
        });

        test('应该能够并发处理多个交易对的数据', () => {
            const symbols = ['BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT'];
            const updateCountPerSymbol = 1000;
            const startTime = Date.now();
            
            // 并发处理多个交易对
            for (let i = 0; i < updateCountPerSymbol; i++) {
                symbols.forEach(symbol => {
                    const tickerData = {
                        bid: 50000 + Math.random() * 100,
                        ask: 50100 + Math.random() * 100
                    };
                    tickerHandler({ symbol, data: tickerData });
                });
            }
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            const totalUpdates = updateCountPerSymbol * symbols.length;
            const updatesPerSecond = totalUpdates / (duration / 1000);
            
            console.log(`并发处理 ${totalUpdates} 次更新耗时: ${duration}ms`);
            console.log(`处理速度: ${updatesPerSecond.toFixed(0)} 更新/秒`);
            
            // 性能要求：并发处理应该能够处理至少800次更新/秒
            expect(updatesPerSecond).toBeGreaterThan(800);
            
            // 验证所有交易对都有数据
            symbols.forEach(symbol => {
                const midPrice = marketDataService.getMidPrice(symbol);
                expect(midPrice).not.toBeNull();
            });
        });
    });

    describe('内存使用性能', () => {
        test('应该有效管理内存使用', () => {
            const symbol = 'BTC/USDT:USDT';
            const initialMemory = process.memoryUsage();
            
            // 大量数据更新
            for (let i = 0; i < 50000; i++) {
                const tickerData = {
                    bid: 50000 + Math.random() * 100,
                    ask: 50100 + Math.random() * 100
                };
                tickerHandler({ symbol, data: tickerData });
                
                // 每1000次更新检查一次内存
                if (i % 1000 === 0) {
                    const currentMemory = process.memoryUsage();
                    const memoryIncrease = currentMemory.heapUsed - initialMemory.heapUsed;
                    
                    // 内存增长应该保持在合理范围内（小于50MB）
                    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
                }
            }
            
            // 强制垃圾回收（如果可用）
            if (global.gc) {
                global.gc();
            }
            
            const finalMemory = process.memoryUsage();
            const totalMemoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
            
            console.log(`处理50000次更新后内存增长: ${(totalMemoryIncrease / 1024 / 1024).toFixed(2)}MB`);
            
            // 总内存增长应该小于100MB
            expect(totalMemoryIncrease).toBeLessThan(100 * 1024 * 1024);
        });

        test('应该正确清理定时器和事件监听器', () => {
            const initialTimers = process._getActiveHandles().length;
            const initialListeners = marketDataService.listenerCount('dataUpdate');
            
            // 添加一些监听器
            const listener1 = () => {};
            const listener2 = () => {};
            marketDataService.on('dataUpdate', listener1);
            marketDataService.on('dataValidationWarning', listener2);
            
            expect(marketDataService.listenerCount('dataUpdate')).toBe(initialListeners + 1);
            expect(marketDataService.listenerCount('dataValidationWarning')).toBe(1);
            
            // 清理资源
            marketDataService.cleanup();
            
            // 验证监听器被清理
            expect(marketDataService.listenerCount('dataUpdate')).toBe(0);
            expect(marketDataService.listenerCount('dataValidationWarning')).toBe(0);
            
            // 验证定时器被清理（定时器数量应该不增加或减少）
            const finalTimers = process._getActiveHandles().length;
            expect(finalTimers).toBeLessThanOrEqual(initialTimers);
        });
    });

    describe('响应时间性能', () => {
        test('API方法应该有快速响应时间', () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 先更新一些数据
            tickerHandler({ symbol, data: { bid: 50000, ask: 50100 } });
            
            const iterations = 10000;
            
            // 测试getMidPrice响应时间
            const startTime1 = process.hrtime.bigint();
            for (let i = 0; i < iterations; i++) {
                marketDataService.getMidPrice(symbol);
            }
            const endTime1 = process.hrtime.bigint();
            const avgTime1 = Number(endTime1 - startTime1) / iterations / 1000000; // 转换为毫秒
            
            console.log(`getMidPrice平均响应时间: ${avgTime1.toFixed(6)}ms`);
            expect(avgTime1).toBeLessThan(0.01); // 应该小于0.01ms
            
            // 测试getMarketData响应时间
            const startTime2 = process.hrtime.bigint();
            for (let i = 0; i < iterations; i++) {
                marketDataService.getMarketData(symbol);
            }
            const endTime2 = process.hrtime.bigint();
            const avgTime2 = Number(endTime2 - startTime2) / iterations / 1000000;
            
            console.log(`getMarketData平均响应时间: ${avgTime2.toFixed(6)}ms`);
            expect(avgTime2).toBeLessThan(0.1); // 应该小于0.1ms（因为需要复制对象）
        });

        test('数据验证应该有合理的性能开销', () => {
            const symbol = 'BTC/USDT:USDT';
            const updateCount = 1000;
            
            // 测试正常数据的验证性能
            const startTime = Date.now();
            for (let i = 0; i < updateCount; i++) {
                const tickerData = {
                    bid: 50000 + Math.random() * 10,
                    ask: 50010 + Math.random() * 10
                };
                tickerHandler({ symbol, data: tickerData });
            }
            const endTime = Date.now();
            
            const duration = endTime - startTime;
            const avgValidationTime = duration / updateCount;
            
            console.log(`数据验证平均耗时: ${avgValidationTime.toFixed(3)}ms/次`);
            
            // 数据验证的平均耗时应该小于1ms
            expect(avgValidationTime).toBeLessThan(1);
        });
    });

    describe('压力测试', () => {
        test('应该能够承受持续的高负载', () => {
            const symbols = ['BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT'];
            const duration = 5000; // 5秒压力测试
            const startTime = Date.now();
            let updateCount = 0;
            
            const stressTest = () => {
                const currentTime = Date.now();
                if (currentTime - startTime < duration) {
                    // 随机选择交易对和更新类型
                    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
                    
                    if (Math.random() > 0.5) {
                        // Ticker更新
                        const tickerData = {
                            bid: 50000 + Math.random() * 100,
                            ask: 50100 + Math.random() * 100
                        };
                        tickerHandler({ symbol, data: tickerData });
                    } else {
                        // Orderbook更新
                        const orderbookData = {
                            bids: [[50000 + Math.random() * 50, 1.0 + Math.random()]],
                            asks: [[50050 + Math.random() * 50, 1.0 + Math.random()]]
                        };
                        orderbookHandler({ symbol, data: orderbookData });
                    }
                    
                    updateCount++;
                    setImmediate(stressTest); // 继续压力测试
                }
            };
            
            return new Promise((resolve) => {
                stressTest();
                
                setTimeout(() => {
                    const actualDuration = Date.now() - startTime;
                    const updatesPerSecond = updateCount / (actualDuration / 1000);
                    
                    console.log(`压力测试结果: ${updateCount}次更新，${updatesPerSecond.toFixed(0)}更新/秒`);
                    
                    // 验证服务仍然正常工作
                    symbols.forEach(symbol => {
                        const midPrice = marketDataService.getMidPrice(symbol);
                        expect(midPrice).not.toBeNull();
                    });
                    
                    // 应该能够处理至少500次更新/秒
                    expect(updatesPerSecond).toBeGreaterThan(500);
                    
                    resolve();
                }, duration + 100);
            });
        }, 10000);
    });
});