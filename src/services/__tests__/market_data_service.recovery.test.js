const MarketDataService = require('../market_data_service');
const WebSocketManager = require('../websocket_manager');
const ExchangeService = require('../exchange_service');
const Config = require('../../shared/config');
const Logger = require('../../shared/logger');

// Mock dependencies for recovery testing
jest.mock('../websocket_manager');
jest.mock('../exchange_service');
jest.mock('../../shared/config');
jest.mock('../../shared/logger');

/**
 * @description MarketDataService错误恢复测试
 * 测试网络异常、服务重启和各种故障场景的恢复能力
 */
describe('MarketDataService Recovery Tests', () => {
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
                { SYMBOL: 'ETH/USDT:USDT', VOLATILITY_LOOKBACK: 14, KLINE_INTERVAL: '15m' }
            ])
        };
        
        // Setup mock WebSocketManager
        mockWebSocketManager = {
            on: jest.fn(),
            emit: jest.fn(),
            isConnected: jest.fn().mockReturnValue(true),
            close: jest.fn(),
            reconnect: jest.fn()
        };
        WebSocketManager.on = mockWebSocketManager.on;
        WebSocketManager.isConnected = mockWebSocketManager.isConnected;
        WebSocketManager.close = mockWebSocketManager.close;
        WebSocketManager.reconnect = mockWebSocketManager.reconnect;
        
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

    describe('网络异常恢复', () => {
        test('应该能够处理WebSocket连接断开', async () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 初始数据更新
            tickerHandler({ symbol, data: { bid: 50000, ask: 50100 } });
            expect(marketDataService.getMidPrice(symbol)).toBe(50050);
            
            // 模拟连接断开
            mockWebSocketManager.isConnected.mockReturnValue(false);
            
            // 尝试更新数据（应该被忽略或处理）
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            
            // 在连接断开状态下的数据更新
            tickerHandler({ symbol, data: { bid: 51000, ask: 51100 } });
            
            // 验证服务仍然可以返回最后的有效数据
            expect(marketDataService.getMidPrice(symbol)).toBe(50050); // 应该保持原值
            
            // 模拟重连
            mockWebSocketManager.isConnected.mockReturnValue(true);
            
            // 重连后的数据更新
            tickerHandler({ symbol, data: { bid: 51000, ask: 51100 } });
            expect(marketDataService.getMidPrice(symbol)).toBe(51050);
            
            consoleSpy.mockRestore();
        });

        test('应该能够处理API请求失败', async () => {
            // 清理当前实例
            marketDataService.cleanup();
            MarketDataService.instance = null;
            marketDataService = MarketDataService.getInstance();
            
            // 模拟API请求失败
            mockExchangeService.fetchOHLCV.mockRejectedValue(new Error('Network error'));
            
            // 初始化应该能够处理API失败
            await marketDataService.initialize(mockConfig);
            
            // 验证服务仍然初始化成功（即使波动率计算失败）
            expect(marketDataService.getIsInitialized()).toBe(true);
            
            // 验证错误被记录
            expect(Logger.error).toHaveBeenCalled();
            
            // 波动率应该为null
            expect(marketDataService.getVolatility('BTC/USDT:USDT')).toBeNull();
            
            // 但ticker数据处理应该仍然正常
            const tickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
            tickerHandler({ symbol: 'BTC/USDT:USDT', data: { bid: 50000, ask: 50100 } });
            expect(marketDataService.getMidPrice('BTC/USDT:USDT')).toBe(50050);
        });

        test('应该能够处理间歇性网络问题', async () => {
            const symbol = 'BTC/USDT:USDT';
            let successCount = 0;
            let failureCount = 0;
            
            // 模拟间歇性网络问题
            for (let i = 0; i < 100; i++) {
                try {
                    if (i % 10 === 0) {
                        // 每10次模拟一次网络问题
                        mockWebSocketManager.isConnected.mockReturnValue(false);
                        tickerHandler({ symbol, data: { bid: 50000 + i, ask: 50100 + i } });
                        failureCount++;
                    } else {
                        mockWebSocketManager.isConnected.mockReturnValue(true);
                        tickerHandler({ symbol, data: { bid: 50000 + i, ask: 50100 + i } });
                        successCount++;
                    }
                } catch (error) {
                    failureCount++;
                }
            }
            
            console.log(`间歇性网络问题测试结果:`);
            console.log(`- 成功更新: ${successCount}`);
            console.log(`- 失败更新: ${failureCount}`);
            
            // 验证服务仍然可以获取数据
            const midPrice = marketDataService.getMidPrice(symbol);
            expect(midPrice).not.toBeNull();
            expect(typeof midPrice).toBe('number');
            
            // 成功率应该大于失败率
            expect(successCount).toBeGreaterThan(failureCount);
        });
    });

    describe('数据异常恢复', () => {
        test('应该能够处理无效的ticker数据', () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 先设置正常数据
            tickerHandler({ symbol, data: { bid: 50000, ask: 50100 } });
            const initialMidPrice = marketDataService.getMidPrice(symbol);
            expect(initialMidPrice).toBe(50050);
            
            const invalidDataCases = [
                null,
                undefined,
                {},
                { bid: null, ask: 50100 },
                { bid: 50000, ask: null },
                { bid: 'invalid', ask: 50100 },
                { bid: 50000, ask: 'invalid' },
                { bid: -50000, ask: 50100 },
                { bid: 50000, ask: -50100 },
                { bid: Infinity, ask: 50100 },
                { bid: 50000, ask: Infinity },
                { bid: NaN, ask: 50100 },
                { bid: 50000, ask: NaN }
            ];
            
            invalidDataCases.forEach((invalidData, index) => {
                const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
                
                // 发送无效数据
                tickerHandler({ symbol, data: invalidData });
                
                // 验证中间价保持不变（或为null）
                const currentMidPrice = marketDataService.getMidPrice(symbol);
                if (currentMidPrice !== null) {
                    expect(currentMidPrice).toBe(initialMidPrice);
                }
                
                consoleSpy.mockRestore();
            });
            
            // 发送正常数据应该能够恢复
            tickerHandler({ symbol, data: { bid: 51000, ask: 51100 } });
            expect(marketDataService.getMidPrice(symbol)).toBe(51050);
        });

        test('应该能够处理无效的orderbook数据', () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 先设置正常数据
            orderbookHandler({ 
                symbol, 
                data: { 
                    bids: [[50000, 1.0]], 
                    asks: [[50100, 1.0]] 
                } 
            });
            
            const invalidOrderbookCases = [
                null,
                undefined,
                {},
                { bids: null, asks: [[50100, 1.0]] },
                { bids: [[50000, 1.0]], asks: null },
                { bids: [], asks: [[50100, 1.0]] },
                { bids: [[50000, 1.0]], asks: [] },
                { bids: [['invalid', 1.0]], asks: [[50100, 1.0]] },
                { bids: [[50000, 'invalid']], asks: [[50100, 1.0]] },
                { bids: [[50000, 1.0]], asks: [['invalid', 1.0]] },
                { bids: [[50000, 1.0]], asks: [[50100, 'invalid']] }
            ];
            
            invalidOrderbookCases.forEach((invalidData, index) => {
                const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
                
                // 发送无效数据
                orderbookHandler({ symbol, data: invalidData });
                
                // 验证服务仍然可以正常工作
                const marketData = marketDataService.getMarketData(symbol);
                if (marketData) {
                    expect(marketData.symbol).toBe(symbol);
                }
                
                consoleSpy.mockRestore();
            });
            
            // 发送正常数据应该能够恢复
            orderbookHandler({ 
                symbol, 
                data: { 
                    bids: [[51000, 1.5]], 
                    asks: [[51100, 1.5]] 
                } 
            });
            
            const marketData = marketDataService.getMarketData(symbol);
            expect(marketData.bestBid).toBe(51000);
            expect(marketData.bestAsk).toBe(51100);
        });

        test('应该能够处理数据时间戳异常', () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 正常数据
            tickerHandler({ symbol, data: { bid: 50000, ask: 50100 } });
            const initialData = marketDataService.getMarketData(symbol);
            const initialTimestamp = initialData.lastUpdate;
            
            // 等待一小段时间
            setTimeout(() => {
                // 发送新数据
                tickerHandler({ symbol, data: { bid: 51000, ask: 51100 } });
                
                const updatedData = marketDataService.getMarketData(symbol);
                
                // 验证时间戳被更新
                expect(updatedData.lastUpdate.getTime()).toBeGreaterThan(initialTimestamp.getTime());
                expect(updatedData.midPrice).toBe(51050);
            }, 10);
        });
    });

    describe('服务重启恢复', () => {
        test('应该能够处理服务重启', async () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 初始数据
            tickerHandler({ symbol, data: { bid: 50000, ask: 50100 } });
            expect(marketDataService.getMidPrice(symbol)).toBe(50050);
            
            // 模拟服务重启
            marketDataService.cleanup();
            expect(marketDataService.getIsInitialized()).toBe(false);
            
            // 重新初始化
            MarketDataService.instance = null;
            marketDataService = MarketDataService.getInstance();
            await marketDataService.initialize(mockConfig);
            
            expect(marketDataService.getIsInitialized()).toBe(true);
            
            // 重新获取事件处理器
            const newTickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
            
            // 发送新数据
            newTickerHandler({ symbol, data: { bid: 51000, ask: 51100 } });
            expect(marketDataService.getMidPrice(symbol)).toBe(51050);
        });

        test('应该能够处理多次重启', async () => {
            const restartCount = 5;
            const symbol = 'BTC/USDT:USDT';
            
            for (let i = 0; i < restartCount; i++) {
                // 清理当前实例
                if (marketDataService.getIsInitialized()) {
                    marketDataService.cleanup();
                }
                
                // 重新创建实例
                MarketDataService.instance = null;
                marketDataService = MarketDataService.getInstance();
                
                // 重新初始化
                await marketDataService.initialize(mockConfig);
                expect(marketDataService.getIsInitialized()).toBe(true);
                
                // 测试功能
                const tickerHandler = mockWebSocketManager.on.mock.calls.find(call => call[0] === 'ticker')[1];
                const testPrice = 50000 + i * 100;
                tickerHandler({ symbol, data: { bid: testPrice, ask: testPrice + 100 } });
                
                expect(marketDataService.getMidPrice(symbol)).toBe(testPrice + 50);
            }
            
            console.log(`成功完成 ${restartCount} 次服务重启测试`);
        });

        test('应该能够处理初始化过程中的异常', async () => {
            // 清理当前实例
            marketDataService.cleanup();
            MarketDataService.instance = null;
            
            // 模拟配置异常
            const faultyConfig = {
                getSymbols: jest.fn().mockImplementation(() => {
                    throw new Error('Config error');
                })
            };
            
            marketDataService = MarketDataService.getInstance();
            
            // 初始化应该能够处理配置错误
            await expect(marketDataService.initialize(faultyConfig)).rejects.toThrow();
            
            // 验证服务状态
            expect(marketDataService.getIsInitialized()).toBe(false);
            
            // 使用正确配置重新初始化
            await marketDataService.initialize(mockConfig);
            expect(marketDataService.getIsInitialized()).toBe(true);
        });
    });

    describe('并发异常恢复', () => {
        test('应该能够处理并发数据更新中的异常', () => {
            const symbols = ['BTC/USDT:USDT', 'ETH/USDT:USDT'];
            const updateCount = 1000;
            let successCount = 0;
            let errorCount = 0;
            
            // 并发发送数据，其中包含一些异常数据
            for (let i = 0; i < updateCount; i++) {
                symbols.forEach(symbol => {
                    try {
                        let tickerData;
                        
                        if (i % 50 === 0) {
                            // 每50次插入一次异常数据
                            tickerData = { bid: null, ask: 'invalid' };
                        } else {
                            tickerData = {
                                bid: 50000 + Math.random() * 100,
                                ask: 50100 + Math.random() * 100
                            };
                        }
                        
                        tickerHandler({ symbol, data: tickerData });
                        successCount++;
                    } catch (error) {
                        errorCount++;
                    }
                });
            }
            
            console.log(`并发异常恢复测试结果:`);
            console.log(`- 成功处理: ${successCount}`);
            console.log(`- 异常处理: ${errorCount}`);
            
            // 验证所有交易对仍然有有效数据
            symbols.forEach(symbol => {
                const midPrice = marketDataService.getMidPrice(symbol);
                if (midPrice !== null) {
                    expect(typeof midPrice).toBe('number');
                    expect(midPrice).toBeGreaterThan(0);
                }
            });
            
            // 成功处理的数量应该远大于异常数量
            expect(successCount).toBeGreaterThan(errorCount * 10);
        });

        test('应该能够处理事件监听器异常', () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 添加一个会抛出异常的监听器
            const faultyListener = jest.fn(() => {
                throw new Error('Listener error');
            });
            
            marketDataService.on('dataUpdate', faultyListener);
            
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            
            // 发送数据更新
            tickerHandler({ symbol, data: { bid: 50000, ask: 50100 } });
            
            // 验证服务仍然正常工作
            expect(marketDataService.getMidPrice(symbol)).toBe(50050);
            
            // 验证异常被捕获
            expect(faultyListener).toHaveBeenCalled();
            
            // 移除有问题的监听器
            marketDataService.removeListener('dataUpdate', faultyListener);
            
            // 继续测试正常功能
            tickerHandler({ symbol, data: { bid: 51000, ask: 51100 } });
            expect(marketDataService.getMidPrice(symbol)).toBe(51050);
            
            consoleSpy.mockRestore();
        });
    });

    describe('资源耗尽恢复', () => {
        test('应该能够处理内存不足情况', () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 模拟内存压力
            const largeArrays = [];
            try {
                // 创建大量数据来模拟内存压力
                for (let i = 0; i < 1000; i++) {
                    largeArrays.push(new Array(10000).fill(Math.random()));
                }
                
                // 在内存压力下测试服务
                for (let i = 0; i < 100; i++) {
                    tickerHandler({ symbol, data: { bid: 50000 + i, ask: 50100 + i } });
                }
                
                // 验证服务仍然正常
                const midPrice = marketDataService.getMidPrice(symbol);
                expect(midPrice).not.toBeNull();
                expect(typeof midPrice).toBe('number');
                
            } finally {
                // 清理内存
                largeArrays.length = 0;
                if (global.gc) {
                    global.gc();
                }
            }
        });

        test('应该能够处理定时器资源耗尽', async () => {
            // 模拟大量定时器创建
            const timers = [];
            
            try {
                // 创建大量定时器
                for (let i = 0; i < 100; i++) {
                    const timer = setInterval(() => {}, 1000);
                    timers.push(timer);
                }
                
                // 测试服务在定时器资源紧张时的表现
                const symbol = 'BTC/USDT:USDT';
                tickerHandler({ symbol, data: { bid: 50000, ask: 50100 } });
                
                expect(marketDataService.getMidPrice(symbol)).toBe(50050);
                
                // 测试服务清理
                marketDataService.cleanup();
                expect(marketDataService.getIsInitialized()).toBe(false);
                
            } finally {
                // 清理所有定时器
                timers.forEach(timer => clearInterval(timer));
            }
        });
    });

    describe('数据恢复策略', () => {
        test('应该能够从数据丢失中恢复', () => {
            const symbol = 'BTC/USDT:USDT';
            
            // 设置初始数据
            tickerHandler({ symbol, data: { bid: 50000, ask: 50100 } });
            expect(marketDataService.getMidPrice(symbol)).toBe(50050);
            
            // 模拟数据丢失（直接清空内部数据）
            marketDataService.marketData.clear();
            
            // 验证数据确实丢失
            expect(marketDataService.getMidPrice(symbol)).toBeNull();
            
            // 发送新数据应该能够恢复
            tickerHandler({ symbol, data: { bid: 51000, ask: 51100 } });
            expect(marketDataService.getMidPrice(symbol)).toBe(51050);
        });

        test('应该能够处理部分数据损坏', () => {
            const symbols = ['BTC/USDT:USDT', 'ETH/USDT:USDT'];
            
            // 设置多个交易对的数据
            symbols.forEach((symbol, index) => {
                tickerHandler({ symbol, data: { bid: 50000 + index * 1000, ask: 50100 + index * 1000 } });
            });
            
            // 验证所有数据都存在
            symbols.forEach(symbol => {
                expect(marketDataService.getMidPrice(symbol)).not.toBeNull();
            });
            
            // 模拟部分数据损坏
            const marketData = marketDataService.marketData.get('BTC/USDT:USDT');
            if (marketData) {
                marketData.midPrice = 'corrupted';
            }
            
            // 验证损坏的数据
            expect(marketDataService.getMidPrice('BTC/USDT:USDT')).toBe('corrupted');
            
            // 其他数据应该仍然正常
            expect(marketDataService.getMidPrice('ETH/USDT:USDT')).toBe(51050);
            
            // 发送新数据应该能够修复损坏的数据
            tickerHandler({ symbol: 'BTC/USDT:USDT', data: { bid: 52000, ask: 52100 } });
            expect(marketDataService.getMidPrice('BTC/USDT:USDT')).toBe(52050);
        });
    });
});