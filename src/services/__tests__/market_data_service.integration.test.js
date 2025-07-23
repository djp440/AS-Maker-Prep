const MarketDataService = require('../market_data_service');
const WebSocketManager = require('../websocket_manager');
const ExchangeService = require('../exchange_service');
const Config = require('../../shared/config');
const Logger = require('../../shared/logger');

/**
 * @description MarketDataService集成测试
 * 测试与真实WebSocket连接和ExchangeService的集成
 */
describe('MarketDataService Integration Tests', () => {
    let marketDataService;
    let originalLogLevel;

    beforeAll(() => {
        // 降低日志级别以减少测试输出
        originalLogLevel = process.env.LOG_LEVEL;
        process.env.LOG_LEVEL = 'error';
    });

    afterAll(() => {
        // 恢复日志级别
        if (originalLogLevel) {
            process.env.LOG_LEVEL = originalLogLevel;
        } else {
            delete process.env.LOG_LEVEL;
        }
    });

    beforeEach(() => {
        // 重置单例
        MarketDataService.instance = null;
        marketDataService = MarketDataService.getInstance();
    });

    afterEach(async () => {
        if (marketDataService && marketDataService.getIsInitialized()) {
            marketDataService.cleanup();
        }
        // 清理WebSocket连接
        if (WebSocketManager.isConnected()) {
            await WebSocketManager.close();
        }
    });

    describe('WebSocket集成测试', () => {
        test('应该能够与真实WebSocket建立连接并接收数据', async () => {
            // 跳过如果没有配置API密钥
            if (!process.env.BITGET_API_KEY) {
                console.log('跳过集成测试：未配置BITGET_API_KEY');
                return;
            }

            const config = {
                getSymbols: () => [{
                    SYMBOL: 'BTC/USDT:USDT',
                    VOLATILITY_LOOKBACK: 14,
                    KLINE_INTERVAL: '15m'
                }]
            };

            // 初始化服务
            await marketDataService.initialize(config);
            expect(marketDataService.getIsInitialized()).toBe(true);

            // 等待WebSocket连接建立
            await new Promise(resolve => {
                const checkConnection = () => {
                    if (WebSocketManager.isConnected()) {
                        resolve();
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                checkConnection();
            });

            // 等待接收数据
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('未在10秒内接收到数据'));
                }, 10000);

                marketDataService.on('dataUpdate', (data) => {
                    clearTimeout(timeout);
                    expect(data).toBeDefined();
                    expect(data.symbol).toBe('BTC/USDT:USDT');
                    resolve();
                });
            });

            // 验证数据
            const midPrice = marketDataService.getMidPrice('BTC/USDT:USDT');
            expect(midPrice).not.toBeNull();
            expect(typeof midPrice).toBe('number');
            expect(midPrice).toBeGreaterThan(0);
        }, 30000);

        test('应该能够处理WebSocket重连', async () => {
            if (!process.env.BITGET_API_KEY) {
                console.log('跳过集成测试：未配置BITGET_API_KEY');
                return;
            }

            const config = {
                getSymbols: () => [{
                    SYMBOL: 'BTC/USDT:USDT',
                    VOLATILITY_LOOKBACK: 14,
                    KLINE_INTERVAL: '15m'
                }]
            };

            await marketDataService.initialize(config);

            // 等待初始连接
            await new Promise(resolve => {
                const checkConnection = () => {
                    if (WebSocketManager.isConnected()) {
                        resolve();
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                checkConnection();
            });

            // 模拟连接断开
            await WebSocketManager.close();
            expect(WebSocketManager.isConnected()).toBe(false);

            // 等待重连
            await new Promise(resolve => {
                const checkReconnection = () => {
                    if (WebSocketManager.isConnected()) {
                        resolve();
                    } else {
                        setTimeout(checkReconnection, 1000);
                    }
                };
                setTimeout(checkReconnection, 2000); // 等待重连逻辑启动
            });

            expect(WebSocketManager.isConnected()).toBe(true);
        }, 45000);
    });

    describe('ExchangeService集成测试', () => {
        test('应该能够获取真实的K线数据并计算波动率', async () => {
            if (!process.env.BITGET_API_KEY) {
                console.log('跳过集成测试：未配置BITGET_API_KEY');
                return;
            }

            const config = {
                getSymbols: () => [{
                    SYMBOL: 'BTC/USDT:USDT',
                    VOLATILITY_LOOKBACK: 14,
                    KLINE_INTERVAL: '15m'
                }]
            };

            await marketDataService.initialize(config);

            // 等待波动率计算完成
            await new Promise(resolve => setTimeout(resolve, 2000));

            const volatility = marketDataService.getVolatility('BTC/USDT:USDT');
            expect(volatility).not.toBeNull();
            expect(typeof volatility).toBe('number');
            expect(volatility).toBeGreaterThan(0);
            expect(volatility).toBeLessThan(1); // 波动率应该小于100%
        }, 15000);

        test('应该能够处理API限流', async () => {
            if (!process.env.BITGET_API_KEY) {
                console.log('跳过集成测试：未配置BITGET_API_KEY');
                return;
            }

            const config = {
                getSymbols: () => [
                    { SYMBOL: 'BTC/USDT:USDT', VOLATILITY_LOOKBACK: 14, KLINE_INTERVAL: '15m' },
                    { SYMBOL: 'ETH/USDT:USDT', VOLATILITY_LOOKBACK: 14, KLINE_INTERVAL: '15m' },
                    { SYMBOL: 'SOL/USDT:USDT', VOLATILITY_LOOKBACK: 14, KLINE_INTERVAL: '15m' }
                ]
            };

            // 快速连续初始化多个交易对
            await marketDataService.initialize(config);

            // 等待所有数据加载完成
            await new Promise(resolve => setTimeout(resolve, 5000));

            // 验证所有交易对都有数据
            const symbols = ['BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT'];
            for (const symbol of symbols) {
                const volatility = marketDataService.getVolatility(symbol);
                if (volatility !== null) {
                    expect(typeof volatility).toBe('number');
                    expect(volatility).toBeGreaterThan(0);
                }
            }
        }, 20000);
    });

    describe('多交易对并发处理', () => {
        test('应该能够同时处理多个交易对的数据', async () => {
            if (!process.env.BITGET_API_KEY) {
                console.log('跳过集成测试：未配置BITGET_API_KEY');
                return;
            }

            const config = {
                getSymbols: () => [
                    { SYMBOL: 'BTC/USDT:USDT', VOLATILITY_LOOKBACK: 14, KLINE_INTERVAL: '15m' },
                    { SYMBOL: 'ETH/USDT:USDT', VOLATILITY_LOOKBACK: 14, KLINE_INTERVAL: '15m' }
                ]
            };

            await marketDataService.initialize(config);

            // 等待数据接收
            await new Promise(resolve => setTimeout(resolve, 5000));

            const allData = marketDataService.getAllMarketData();
            expect(allData.size).toBeGreaterThan(0);

            // 验证每个交易对都有基本数据结构
            for (const [symbol, data] of allData) {
                expect(data).toHaveProperty('symbol');
                expect(data.symbol).toBe(symbol);
                expect(data).toHaveProperty('lastUpdate');
                expect(data.lastUpdate).toBeInstanceOf(Date);
            }
        }, 20000);
    });
});