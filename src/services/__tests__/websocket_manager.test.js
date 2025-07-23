// Mock dependencies first
jest.mock('ccxt');
jest.mock('../../shared/config');
jest.mock('../../shared/logger');

const ccxt = require('ccxt');
const Config = require('../../shared/config');
const Logger = require('../../shared/logger');
const WebSocketManager = require('../websocket_manager');

describe('WebSocketManager', () => {
    let webSocketManager;
    let mockExchange;

    beforeEach(() => {
        // Get the singleton instance
        webSocketManager = WebSocketManager;
        
        // Mock exchange instance
        mockExchange = {
            loadMarkets: jest.fn().mockResolvedValue({}),
            watchTicker: jest.fn(),
            watchOrderBook: jest.fn(),
            watchOrders: jest.fn(),
            watchBalance: jest.fn(),
            watchPositions: jest.fn(),
            close: jest.fn()
        };

        // Mock ccxt
        ccxt.bitget = jest.fn().mockImplementation(() => mockExchange);

        // Mock Config
        Config.getExchange = jest.fn().mockReturnValue('bitget');
        Config.getApiCredentials = jest.fn().mockReturnValue({
            apiKey: 'test-key',
            apiSecret: 'test-secret',
            passphrase: 'test-passphrase'
        });
        Config.isPaperTrading = jest.fn().mockReturnValue(false);

        // Mock Logger
        Logger.info = jest.fn();
        Logger.error = jest.fn();
        Logger.warn = jest.fn();
        
        // Reset internal state
        webSocketManager.exchange = null;
        webSocketManager.connectionState = 'closed';
        webSocketManager.subscribedTopics = new Set();
        webSocketManager.reconnectAttempts = 0;
        webSocketManager.isReconnecting = false;
        webSocketManager.watchHandlers = new Map();
        webSocketManager.reconnectTimer = null;
    });

    afterEach(() => {
        jest.clearAllMocks();
        if (webSocketManager && webSocketManager.reconnectTimer) {
            clearTimeout(webSocketManager.reconnectTimer);
            webSocketManager.reconnectTimer = null;
        }
    });

    describe('单例模式', () => {
        test('应该返回同一个实例', () => {
            const instance1 = require('../websocket_manager');
            const instance2 = require('../websocket_manager');
            expect(instance1).toBe(instance2);
        });
    });

    describe('初始化', () => {
        test('应该成功初始化实盘连接', async () => {
            Config.isPaperTrading.mockReturnValue(false);

            await webSocketManager.initialize();

            expect(ccxt.bitget).toHaveBeenCalledWith({
                apiKey: 'test-key',
                secret: 'test-secret',
                password: 'test-passphrase',
                enableRateLimit: true,
                sandbox: false,
                options: {
                    defaultType: 'swap'
                }
            });

            expect(mockExchange.loadMarkets).toHaveBeenCalled();
            expect(webSocketManager.getConnectionState()).toBe('open');
            expect(Logger.info).toHaveBeenCalledWith('WebSocket连接初始化成功');
        });

        test('应该成功初始化模拟盘连接', async () => {
            Config.isPaperTrading.mockReturnValue(true);

            await webSocketManager.initialize();

            expect(ccxt.bitget).toHaveBeenCalledWith({
                apiKey: 'test-key',
                secret: 'test-secret',
                password: 'test-passphrase',
                enableRateLimit: true,
                sandbox: true,
                urls: {
                    api: {
                        ws: {
                            public: 'wss://wspap.bitget.com/v2/ws/public',
                            private: 'wss://wspap.bitget.com/v2/ws/private'
                        }
                    }
                },
                options: {
                    defaultType: 'swap',
                    papertrading: true
                }
            });

            expect(webSocketManager.getConnectionState()).toBe('open');
        });

        test('应该处理不支持的交易所', async () => {
            Config.getExchange.mockReturnValue('unsupported');
            ccxt.unsupported = undefined;

            await expect(webSocketManager.initialize()).rejects.toThrow('不支持的交易所: unsupported');
            expect(webSocketManager.getConnectionState()).toBe('closed');
        });

        test('应该处理初始化错误', async () => {
            mockExchange.loadMarkets.mockRejectedValue(new Error('网络错误'));

            await expect(webSocketManager.initialize()).rejects.toThrow('网络错误');
            expect(webSocketManager.getConnectionState()).toBe('closed');
            expect(Logger.error).toHaveBeenCalledWith('WebSocket初始化失败:', expect.any(Error));
        });
    });

    describe('订阅功能', () => {
        beforeEach(async () => {
            await webSocketManager.initialize();
            // 立即设置为关闭状态，避免启动watch循环
            webSocketManager.connectionState = 'closed';
        });

        test('应该设置Ticker订阅', async () => {
            const symbol = 'BTC/USDT:USDT';
            
            await webSocketManager.watchTicker(symbol);

            expect(webSocketManager.getSubscribedTopics()).toContain(`ticker:${symbol}`);
            expect(Logger.info).toHaveBeenCalledWith(`订阅Ticker数据: ${symbol}`);
        });

        test('应该设置订单簿订阅', async () => {
            const symbol = 'BTC/USDT:USDT';
            
            await webSocketManager.watchOrderBook(symbol);

            expect(webSocketManager.getSubscribedTopics()).toContain(`orderbook:${symbol}`);
            expect(Logger.info).toHaveBeenCalledWith(`订阅订单簿数据: ${symbol}`);
        });

        test('应该设置订单订阅', async () => {
            const symbol = 'BTC/USDT:USDT';
            
            await webSocketManager.watchOrders(symbol);

            expect(webSocketManager.getSubscribedTopics()).toContain(`orders:${symbol}`);
            expect(Logger.info).toHaveBeenCalledWith(`订阅订单更新: ${symbol}`);
        });

        test('应该设置余额订阅', async () => {
            await webSocketManager.watchBalance();

            expect(webSocketManager.getSubscribedTopics()).toContain('balance');
            expect(Logger.info).toHaveBeenCalledWith('订阅账户余额变化');
        });

        test('应该设置持仓订阅', async () => {
            const symbol = 'BTC/USDT:USDT';
            
            await webSocketManager.watchPositions(symbol);

            expect(webSocketManager.getSubscribedTopics()).toContain(`positions:${symbol}`);
            expect(Logger.info).toHaveBeenCalledWith(`订阅持仓变化: ${symbol}`);
        });

        test('应该处理未初始化的订阅请求', async () => {
            webSocketManager.exchange = null;

            await expect(webSocketManager.watchTicker('BTC/USDT:USDT'))
                .rejects.toThrow('WebSocket未初始化');
        });
    });

    describe('连接管理', () => {
        beforeEach(async () => {
            await webSocketManager.initialize();
        });

        test('应该正确报告连接状态', () => {
            expect(webSocketManager.isConnected()).toBe(true);
            expect(webSocketManager.getConnectionState()).toBe('open');
        });

        test('应该处理连接错误', () => {
            const error = new Error('连接断开');
            
            webSocketManager.handleConnectionError(error);

            expect(webSocketManager.getConnectionState()).toBe('closed');
            expect(Logger.warn).toHaveBeenCalledWith('WebSocket连接错误，准备重连:', error.message);
        });

        test('应该安排重连', (done) => {
            webSocketManager.handleConnectionError(new Error('测试错误'));
            
            expect(webSocketManager.isReconnecting).toBe(true);
            expect(webSocketManager.reconnectTimer).toBeTruthy();
            
            // 清理定时器
            clearTimeout(webSocketManager.reconnectTimer);
            webSocketManager.isReconnecting = false;
            done();
        });

        test('应该在达到最大重连次数时停止重连', () => {
            webSocketManager.reconnectAttempts = webSocketManager.maxReconnectAttempts;
            
            webSocketManager.scheduleReconnect();

            expect(webSocketManager.reconnectTimer).toBeNull();
        });
    });

    describe('取消订阅和清理', () => {
        beforeEach(async () => {
            await webSocketManager.initialize();
            webSocketManager.connectionState = 'closed';
            await webSocketManager.watchTicker('BTC/USDT:USDT');
        });

        test('应该成功取消订阅', () => {
            const topic = 'ticker:BTC/USDT:USDT';
            
            webSocketManager.unsubscribe(topic);
            
            expect(webSocketManager.getSubscribedTopics()).not.toContain(topic);
            expect(Logger.info).toHaveBeenCalledWith(`取消订阅: ${topic}`);
        });

        test('应该成功关闭连接', async () => {
            await webSocketManager.close();

            expect(webSocketManager.getConnectionState()).toBe('closed');
            expect(mockExchange.close).toHaveBeenCalled();
            expect(Logger.info).toHaveBeenCalledWith('WebSocket连接已关闭');
        });
    });

    describe('工具方法', () => {
        beforeEach(async () => {
            await webSocketManager.initialize();
        });

        test('应该返回交易所实例', () => {
            expect(webSocketManager.getExchangeInstance()).toBe(mockExchange);
        });

        test('应该返回订阅主题列表', async () => {
            webSocketManager.connectionState = 'closed';
            await webSocketManager.watchTicker('BTC/USDT:USDT');
            await webSocketManager.watchOrderBook('ETH/USDT:USDT');

            const topics = webSocketManager.getSubscribedTopics();
            expect(topics).toContain('ticker:BTC/USDT:USDT');
            expect(topics).toContain('orderbook:ETH/USDT:USDT');
        });
    });
});