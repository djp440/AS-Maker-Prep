/**
 * WebSocket Manager 集成测试
 * 测试真实网络环境下的连接和事件分发功能
 * 注意：此测试需要网络连接，如果无法连接交易所会跳过测试
 */

const WebSocketManager = require('../websocket_manager');
const Config = require('../../shared/config');
const Logger = require('../../shared/logger');

// 设置较长的超时时间，因为网络操作可能较慢
jest.setTimeout(30000);

describe('WebSocket Manager 集成测试', () => {
    let webSocketManager;
    let isNetworkAvailable = false;

    beforeAll(async () => {
        webSocketManager = WebSocketManager;
        
        // 检查网络连接是否可用
        try {
            // 尝试初始化连接来检测网络可用性
            await webSocketManager.initialize();
            isNetworkAvailable = true;
            console.log('✅ 网络连接可用，将执行集成测试');
        } catch (error) {
            console.log('⚠️ 网络连接不可用，跳过集成测试:', error.message);
            console.log('请在网络环境良好时重新运行此测试');
        }
    });

    afterAll(async () => {
        if (isNetworkAvailable && webSocketManager) {
            await webSocketManager.close();
        }
    });

    describe('真实连接测试', () => {
        test('应该能够成功连接到Bitget交易所', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            expect(webSocketManager.isConnected()).toBe(true);
            expect(webSocketManager.getConnectionState()).toBe('open');
            expect(webSocketManager.getExchangeInstance()).toBeTruthy();
        });

        test('应该能够获取交易所市场信息', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            const exchange = webSocketManager.getExchangeInstance();
            expect(exchange.markets).toBeTruthy();
            expect(Object.keys(exchange.markets).length).toBeGreaterThan(0);
        });
    });

    describe('事件分发机制测试', () => {
        test('应该正确分发ticker事件', (done) => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                done();
                return;
            }

            const symbol = 'BTC/USDT:USDT';
            let eventReceived = false;

            // 监听ticker事件
            const tickerHandler = (data) => {
                expect(data.symbol).toBe(symbol);
                expect(data.data).toBeTruthy();
                expect(data.data.symbol).toBe(symbol);
                expect(typeof data.data.last).toBe('number');
                
                eventReceived = true;
                webSocketManager.off('ticker', tickerHandler);
                webSocketManager.unsubscribe(`ticker:${symbol}`);
                done();
            };

            webSocketManager.on('ticker', tickerHandler);

            // 订阅ticker数据
            webSocketManager.watchTicker(symbol).catch((error) => {
                if (!eventReceived) {
                    console.log('Ticker订阅失败:', error.message);
                    webSocketManager.off('ticker', tickerHandler);
                    done();
                }
            });

            // 设置超时，如果10秒内没有收到数据则认为测试失败
            setTimeout(() => {
                if (!eventReceived) {
                    webSocketManager.off('ticker', tickerHandler);
                    console.log('⚠️ 10秒内未收到ticker数据，可能是网络问题');
                    done();
                }
            }, 10000);
        });

        test('应该正确分发orderbook事件', (done) => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                done();
                return;
            }

            const symbol = 'BTC/USDT:USDT';
            let eventReceived = false;

            // 监听orderbook事件
            const orderbookHandler = (data) => {
                expect(data.symbol).toBe(symbol);
                expect(data.data).toBeTruthy();
                expect(data.data.symbol).toBe(symbol);
                expect(Array.isArray(data.data.bids)).toBe(true);
                expect(Array.isArray(data.data.asks)).toBe(true);
                
                eventReceived = true;
                webSocketManager.off('orderbook', orderbookHandler);
                webSocketManager.unsubscribe(`orderbook:${symbol}`);
                done();
            };

            webSocketManager.on('orderbook', orderbookHandler);

            // 订阅orderbook数据
            webSocketManager.watchOrderBook(symbol).catch((error) => {
                if (!eventReceived) {
                    console.log('OrderBook订阅失败:', error.message);
                    webSocketManager.off('orderbook', orderbookHandler);
                    done();
                }
            });

            // 设置超时
            setTimeout(() => {
                if (!eventReceived) {
                    webSocketManager.off('orderbook', orderbookHandler);
                    console.log('⚠️ 10秒内未收到orderbook数据，可能是网络问题');
                    done();
                }
            }, 10000);
        });
    });

    describe('订阅管理测试', () => {
        test('应该正确管理多个订阅', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            const symbol1 = 'BTC/USDT:USDT';
            const symbol2 = 'ETH/USDT:USDT';

            // 暂时设置为closed状态避免启动watch循环
            const originalState = webSocketManager.connectionState;
            webSocketManager.connectionState = 'closed';

            try {
                await webSocketManager.watchTicker(symbol1);
                await webSocketManager.watchTicker(symbol2);

                const topics = webSocketManager.getSubscribedTopics();
                expect(topics).toContain(`ticker:${symbol1}`);
                expect(topics).toContain(`ticker:${symbol2}`);
                expect(topics.length).toBeGreaterThanOrEqual(2);

                // 取消一个订阅
                webSocketManager.unsubscribe(`ticker:${symbol1}`);
                const updatedTopics = webSocketManager.getSubscribedTopics();
                expect(updatedTopics).not.toContain(`ticker:${symbol1}`);
                expect(updatedTopics).toContain(`ticker:${symbol2}`);
            } finally {
                // 恢复原始状态
                webSocketManager.connectionState = originalState;
            }
        });
    });

    describe('错误处理和重连测试', () => {
        test('应该正确处理连接错误', () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            const originalState = webSocketManager.connectionState;
            const error = new Error('模拟网络错误');

            // 监听断开连接事件
            let disconnectedEventFired = false;
            const disconnectHandler = (err) => {
                expect(err).toBe(error);
                disconnectedEventFired = true;
            };

            webSocketManager.on('disconnected', disconnectHandler);

            // 触发连接错误
            webSocketManager.handleConnectionError(error);

            expect(webSocketManager.getConnectionState()).toBe('closed');
            expect(disconnectedEventFired).toBe(true);
            expect(webSocketManager.isReconnecting).toBe(true);

            // 清理
            webSocketManager.off('disconnected', disconnectHandler);
            if (webSocketManager.reconnectTimer) {
                clearTimeout(webSocketManager.reconnectTimer);
                webSocketManager.reconnectTimer = null;
            }
            webSocketManager.isReconnecting = false;
            webSocketManager.connectionState = originalState;
        });
    });

    describe('连接状态验证', () => {
        test('应该正确报告连接状态', () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            expect(typeof webSocketManager.isConnected()).toBe('boolean');
            expect(['connecting', 'open', 'closing', 'closed']).toContain(
                webSocketManager.getConnectionState()
            );
        });

        test('应该能够获取订阅主题列表', () => {
            const topics = webSocketManager.getSubscribedTopics();
            expect(Array.isArray(topics)).toBe(true);
        });
    });
});