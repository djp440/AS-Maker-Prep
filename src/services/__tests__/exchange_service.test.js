const ExchangeService = require('../exchange_service');
const Config = require('../../shared/config');
const ccxt = require('ccxt');

// Mock ccxt
jest.mock('ccxt');

// Mock Config
jest.mock('../../shared/config', () => ({
    getExchange: jest.fn(() => 'bitget'),
    getApiCredentials: jest.fn(() => ({
        API_KEY: 'test_key',
        API_SECRET: 'test_secret',
        API_PASSWORD: 'test_password'
    })),
    isPaperTrading: jest.fn(() => false)
}));

// Mock Logger
jest.mock('../../shared/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

describe('ExchangeService', () => {
    let exchangeService;
    let mockExchange;

    beforeEach(() => {
        // 重置所有mock
        jest.clearAllMocks();
        
        // 重置Config的mock
        Config.getExchange.mockReturnValue('bitget');
        Config.getApiCredentials.mockReturnValue({
            API_KEY: 'test_key',
            API_SECRET: 'test_secret',
            API_PASSWORD: 'test_password'
        });
        Config.isPaperTrading.mockReturnValue(false);
        
        // 创建mock交易所实例
        mockExchange = {
            loadMarkets: jest.fn(),
            fetchBalance: jest.fn(),
            fetchPositions: jest.fn(),
            createOrder: jest.fn(),
            cancelOrder: jest.fn(),
            fetchOpenOrders: jest.fn(),
            setLeverage: jest.fn(),
            fetchOHLCV: jest.fn(),
            fetchTicker: jest.fn()
        };

        // Mock ccxt交易所类和错误类
        ccxt.bitget = jest.fn(() => mockExchange);
        ccxt.NetworkError = class extends Error { constructor(message) { super(message); this.name = 'NetworkError'; } };
        ccxt.RequestTimeout = class extends Error { constructor(message) { super(message); this.name = 'RequestTimeout'; } };
        ccxt.ExchangeNotAvailable = class extends Error { constructor(message) { super(message); this.name = 'ExchangeNotAvailable'; } };
        ccxt.ExchangeError = class extends Error { constructor(message) { super(message); this.name = 'ExchangeError'; } };
        ccxt.AuthenticationError = class extends Error { constructor(message) { super(message); this.name = 'AuthenticationError'; } };
        ccxt.InvalidOrder = class extends Error { constructor(message) { super(message); this.name = 'InvalidOrder'; } };
        
        // 获取ExchangeService实例
        exchangeService = ExchangeService;
        
        // 重置实例状态
        exchangeService.exchange = null;
        exchangeService.markets = null;
    });

    describe('单例模式', () => {
        test('应该返回同一个实例', () => {
            const instance1 = ExchangeService;
            const instance2 = ExchangeService;
            expect(instance1).toBe(instance2);
        });
    });

    describe('initialize', () => {
        test('应该成功初始化实盘模式', async () => {
            Config.isPaperTrading.mockReturnValue(false);
            mockExchange.loadMarkets.mockResolvedValue({});

            await exchangeService.initialize();

            expect(ccxt.bitget).toHaveBeenCalledWith({
                apiKey: 'test_key',
                secret: 'test_secret',
                password: 'test_password',
                enableRateLimit: true,
                sandbox: false
            });
            expect(mockExchange.loadMarkets).toHaveBeenCalled();
        });

        test('应该成功初始化模拟盘模式', async () => {
            Config.isPaperTrading.mockReturnValue(true);
            mockExchange.loadMarkets.mockResolvedValue({});

            await exchangeService.initialize();

            expect(ccxt.bitget).toHaveBeenCalledWith(expect.objectContaining({
                sandbox: true,
                options: { papertrading: true }
            }));
        });

        test('应该处理不支持的交易所', async () => {
            Config.getExchange.mockReturnValue('unsupported_exchange');
            delete ccxt.unsupported_exchange;

            await expect(exchangeService.initialize()).rejects.toThrow('不支持的交易所: unsupported_exchange');
        });
    });

    describe('loadMarkets', () => {
        beforeEach(async () => {
            mockExchange.loadMarkets.mockResolvedValue({});
            await exchangeService.initialize();
        });

        test('应该成功加载市场信息', async () => {
            const mockMarkets = {
                'BTC/USDT:USDT': { symbol: 'BTC/USDT:USDT', precision: { amount: 8, price: 2 } },
                'ETH/USDT:USDT': { symbol: 'ETH/USDT:USDT', precision: { amount: 8, price: 2 } }
            };
            mockExchange.loadMarkets.mockResolvedValue(mockMarkets);

            await exchangeService.loadMarkets();

            expect(exchangeService.markets).toEqual(mockMarkets);
        });
    });

    describe('getMarket', () => {
        beforeEach(async () => {
            mockExchange.loadMarkets.mockResolvedValue({});
            await exchangeService.initialize();
        });

        test('应该返回正确的市场信息', async () => {
            const mockMarkets = {
                'BTC/USDT:USDT': { symbol: 'BTC/USDT:USDT', precision: { amount: 8, price: 2 } }
            };
            exchangeService.markets = mockMarkets;

            const market = exchangeService.getMarket('BTC/USDT:USDT');
            expect(market).toEqual(mockMarkets['BTC/USDT:USDT']);
        });

        test('应该在市场信息未加载时抛出错误', () => {
            exchangeService.markets = null;
            expect(() => exchangeService.getMarket('BTC/USDT:USDT'))
                .toThrow('市场信息未加载，请先调用 loadMarkets()');
        });

        test('应该在交易对不存在时抛出错误', () => {
            exchangeService.markets = {};
            expect(() => exchangeService.getMarket('INVALID/SYMBOL'))
                .toThrow('未找到交易对: INVALID/SYMBOL');
        });
    });

    describe('executeWithRetry', () => {
        beforeEach(async () => {
            mockExchange.loadMarkets.mockResolvedValue({});
            await exchangeService.initialize();
            
            // Mock ccxt错误类
            ccxt.NetworkError = class extends Error { constructor(message) { super(message); this.name = 'NetworkError'; } };
            ccxt.AuthenticationError = class extends Error { constructor(message) { super(message); this.name = 'AuthenticationError'; } };
        });

        test('应该在第一次尝试成功时返回结果', async () => {
            const mockResult = { success: true };
            mockExchange.fetchBalance.mockResolvedValue(mockResult);

            const result = await exchangeService.executeWithRetry(
                mockExchange.fetchBalance,
                '测试操作'
            );

            expect(result).toEqual(mockResult);
            expect(mockExchange.fetchBalance).toHaveBeenCalledTimes(1);
        });

        test('应该在可重试错误时进行重试', async () => {
            const networkError = new ccxt.NetworkError('网络错误');
            const mockResult = { success: true };
            
            mockExchange.fetchBalance
                .mockRejectedValueOnce(networkError)
                .mockResolvedValue(mockResult);

            const result = await exchangeService.executeWithRetry(
                mockExchange.fetchBalance,
                '测试操作'
            );

            expect(result).toEqual(mockResult);
            expect(mockExchange.fetchBalance).toHaveBeenCalledTimes(2);
        });

        test('应该在不可重试错误时立即抛出', async () => {
            const authError = new ccxt.AuthenticationError('认证失败');
            mockExchange.fetchBalance.mockRejectedValue(authError);

            await expect(exchangeService.executeWithRetry(
                mockExchange.fetchBalance,
                '测试操作'
            )).rejects.toThrow('认证失败');

            expect(mockExchange.fetchBalance).toHaveBeenCalledTimes(1);
        });
    });

    describe('API方法', () => {
        beforeEach(async () => {
            mockExchange.loadMarkets.mockResolvedValue({});
            await exchangeService.initialize();
        });

        test('fetchBalance应该调用交易所的fetchBalance方法', async () => {
            const mockBalance = { USDT: { free: 1000, used: 0, total: 1000 } };
            mockExchange.fetchBalance.mockResolvedValue(mockBalance);

            const result = await exchangeService.fetchBalance();

            expect(result).toEqual(mockBalance);
            expect(mockExchange.fetchBalance).toHaveBeenCalled();
        });

        test('fetchPositions应该调用交易所的fetchPositions方法', async () => {
            const mockPositions = [{ symbol: 'BTC/USDT:USDT', size: 0.1 }];
            mockExchange.fetchPositions.mockResolvedValue(mockPositions);

            const result = await exchangeService.fetchPositions();

            expect(result).toEqual(mockPositions);
            expect(mockExchange.fetchPositions).toHaveBeenCalledWith(undefined);
        });

        test('createOrder应该调用交易所的createOrder方法', async () => {
            const mockOrder = { id: '12345', symbol: 'BTC/USDT:USDT' };
            mockExchange.createOrder.mockResolvedValue(mockOrder);

            const result = await exchangeService.createOrder(
                'BTC/USDT:USDT',
                'limit',
                'buy',
                0.1,
                50000
            );

            expect(result).toEqual(mockOrder);
            expect(mockExchange.createOrder).toHaveBeenCalledWith(
                'BTC/USDT:USDT',
                'limit',
                'buy',
                0.1,
                50000,
                {}
            );
        });

        test('cancelOrder应该调用交易所的cancelOrder方法', async () => {
            const mockResult = { id: '12345', status: 'canceled' };
            mockExchange.cancelOrder.mockResolvedValue(mockResult);

            const result = await exchangeService.cancelOrder('12345', 'BTC/USDT:USDT');

            expect(result).toEqual(mockResult);
            expect(mockExchange.cancelOrder).toHaveBeenCalledWith('12345', 'BTC/USDT:USDT', {});
        });

        test('fetchOpenOrders应该调用交易所的fetchOpenOrders方法', async () => {
            const mockOrders = [{ id: '12345', symbol: 'BTC/USDT:USDT' }];
            mockExchange.fetchOpenOrders.mockResolvedValue(mockOrders);

            const result = await exchangeService.fetchOpenOrders('BTC/USDT:USDT');

            expect(result).toEqual(mockOrders);
            expect(mockExchange.fetchOpenOrders).toHaveBeenCalledWith(
                'BTC/USDT:USDT',
                undefined,
                undefined,
                {}
            );
        });

        test('setLeverage应该调用交易所的setLeverage方法', async () => {
            const mockResult = { symbol: 'BTC/USDT:USDT', leverage: 10 };
            mockExchange.setLeverage.mockResolvedValue(mockResult);

            const result = await exchangeService.setLeverage('BTC/USDT:USDT', 10);

            expect(result).toEqual(mockResult);
            expect(mockExchange.setLeverage).toHaveBeenCalledWith(10, 'BTC/USDT:USDT', {});
        });

        test('fetchOHLCV应该调用交易所的fetchOHLCV方法', async () => {
            const mockOHLCV = [[1640995200000, 50000, 51000, 49000, 50500, 100]];
            mockExchange.fetchOHLCV.mockResolvedValue(mockOHLCV);

            const result = await exchangeService.fetchOHLCV('BTC/USDT:USDT', '1h');

            expect(result).toEqual(mockOHLCV);
            expect(mockExchange.fetchOHLCV).toHaveBeenCalledWith(
                'BTC/USDT:USDT',
                '1h',
                undefined,
                undefined,
                {}
            );
        });

        test('fetchTicker应该调用交易所的fetchTicker方法', async () => {
            const mockTicker = { symbol: 'BTC/USDT:USDT', bid: 50000, ask: 50100 };
            mockExchange.fetchTicker.mockResolvedValue(mockTicker);

            const result = await exchangeService.fetchTicker('BTC/USDT:USDT');

            expect(result).toEqual(mockTicker);
            expect(mockExchange.fetchTicker).toHaveBeenCalledWith('BTC/USDT:USDT');
        });
    });

    describe('isRetryableError', () => {
        beforeEach(async () => {
            mockExchange.loadMarkets.mockResolvedValue({});
            await exchangeService.initialize();
        });

        test('应该识别可重试的错误', () => {
            // Mock ccxt错误类
            ccxt.NetworkError = class extends Error { constructor(message) { super(message); this.name = 'NetworkError'; } };
            ccxt.RequestTimeout = class extends Error { constructor(message) { super(message); this.name = 'RequestTimeout'; } };
            ccxt.ExchangeNotAvailable = class extends Error { constructor(message) { super(message); this.name = 'ExchangeNotAvailable'; } };
            ccxt.ExchangeError = class extends Error { constructor(message) { super(message); this.name = 'ExchangeError'; } };

            const networkError = new ccxt.NetworkError('网络错误');
            const timeoutError = new ccxt.RequestTimeout('请求超时');
            const unavailableError = new ccxt.ExchangeNotAvailable('交易所不可用');
            const busyError = new ccxt.ExchangeError('exchange is busy');

            expect(exchangeService.isRetryableError(networkError)).toBe(true);
            expect(exchangeService.isRetryableError(timeoutError)).toBe(true);
            expect(exchangeService.isRetryableError(unavailableError)).toBe(true);
            expect(exchangeService.isRetryableError(busyError)).toBe(true);
        });

        test('应该识别不可重试的错误', () => {
            // Mock ccxt错误类
            ccxt.AuthenticationError = class extends Error { constructor(message) { super(message); this.name = 'AuthenticationError'; } };
            ccxt.InvalidOrder = class extends Error { constructor(message) { super(message); this.name = 'InvalidOrder'; } };

            const authError = new ccxt.AuthenticationError('认证失败');
            const invalidOrderError = new ccxt.InvalidOrder('无效订单');
            const genericError = new Error('普通错误');

            expect(exchangeService.isRetryableError(authError)).toBe(false);
            expect(exchangeService.isRetryableError(invalidOrderError)).toBe(false);
            expect(exchangeService.isRetryableError(genericError)).toBe(false);
        });
    });

    describe('工具方法', () => {
        test('isInitialized应该正确返回初始化状态', async () => {
            // 重置状态
            exchangeService.exchange = null;
            expect(exchangeService.isInitialized()).toBe(false);
            
            mockExchange.loadMarkets.mockResolvedValue({});
            await exchangeService.initialize();
            
            expect(exchangeService.isInitialized()).toBe(true);
        });

        test('getExchangeInstance应该返回交易所实例', async () => {
            mockExchange.loadMarkets.mockResolvedValue({});
            await exchangeService.initialize();
            
            const instance = exchangeService.getExchangeInstance();
            expect(instance).toBe(mockExchange);
        });

        test('getExchangeInstance应该在未初始化时抛出错误', () => {
            exchangeService.exchange = null;
            expect(() => exchangeService.getExchangeInstance())
                .toThrow('交易所未初始化');
        });
    });
});