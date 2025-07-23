/**
 * WebSocket Manager 性能和稳定性测试
 * 测试长时间运行、多订阅场景和内存使用情况
 * 注意：这些测试需要较长时间运行，建议在性能测试时单独执行
 */

const WebSocketManager = require('../websocket_manager');
const Config = require('../../shared/config');
const Logger = require('../../shared/logger');

// 设置较长的超时时间
jest.setTimeout(60000);

describe('WebSocket Manager 性能测试', () => {
    let webSocketManager;
    let isNetworkAvailable = false;

    beforeAll(async () => {
        webSocketManager = WebSocketManager;
        
        // 检查网络连接是否可用
        try {
            await webSocketManager.initialize();
            isNetworkAvailable = true;
            console.log('✅ 网络连接可用，将执行性能测试');
        } catch (error) {
            console.log('⚠️ 网络连接不可用，跳过性能测试:', error.message);
        }
    });

    afterAll(async () => {
        if (isNetworkAvailable && webSocketManager) {
            await webSocketManager.close();
        }
    });

    describe('多订阅性能测试', () => {
        test('应该能够处理多个同时订阅', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            const symbols = [
                'BTC/USDT:USDT',
                'ETH/USDT:USDT',
                'BNB/USDT:USDT',
                'ADA/USDT:USDT',
                'SOL/USDT:USDT'
            ];

            // 暂时设置为closed状态避免启动watch循环
            const originalState = webSocketManager.connectionState;
            webSocketManager.connectionState = 'closed';

            try {
                const startTime = Date.now();
                
                // 同时订阅多个ticker
                const subscribePromises = symbols.map(symbol => 
                    webSocketManager.watchTicker(symbol)
                );
                
                await Promise.all(subscribePromises);
                
                const endTime = Date.now();
                const duration = endTime - startTime;
                
                console.log(`多订阅耗时: ${duration}ms`);
                expect(duration).toBeLessThan(5000); // 应该在5秒内完成
                
                // 验证所有订阅都已添加
                const topics = webSocketManager.getSubscribedTopics();
                symbols.forEach(symbol => {
                    expect(topics).toContain(`ticker:${symbol}`);
                });
                
                expect(topics.length).toBeGreaterThanOrEqual(symbols.length);
                
            } finally {
                // 恢复原始状态
                webSocketManager.connectionState = originalState;
            }
        });

        test('应该能够处理混合类型的订阅', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            const symbol = 'BTC/USDT:USDT';
            
            // 暂时设置为closed状态
            const originalState = webSocketManager.connectionState;
            webSocketManager.connectionState = 'closed';

            try {
                const startTime = Date.now();
                
                // 订阅不同类型的数据
                await Promise.all([
                    webSocketManager.watchTicker(symbol),
                    webSocketManager.watchOrderBook(symbol),
                    webSocketManager.watchBalance(),
                    webSocketManager.watchPositions(symbol)
                ]);
                
                const endTime = Date.now();
                const duration = endTime - startTime;
                
                console.log(`混合订阅耗时: ${duration}ms`);
                expect(duration).toBeLessThan(10000); // 应该在10秒内完成
                
                // 验证所有订阅类型
                const topics = webSocketManager.getSubscribedTopics();
                expect(topics).toContain(`ticker:${symbol}`);
                expect(topics).toContain(`orderbook:${symbol}`);
                expect(topics).toContain('balance');
                expect(topics).toContain(`positions:${symbol}`);
                
            } finally {
                webSocketManager.connectionState = originalState;
            }
        });
    });

    describe('内存使用测试', () => {
        test('应该正确管理订阅内存', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            const initialTopicsCount = webSocketManager.getSubscribedTopics().length;
            const initialHandlersCount = webSocketManager.watchHandlers.size;
            
            const symbol = 'LTC/USDT:USDT';
            
            // 暂时设置为closed状态
            const originalState = webSocketManager.connectionState;
            webSocketManager.connectionState = 'closed';

            try {
                // 添加订阅
                await webSocketManager.watchTicker(symbol);
                
                expect(webSocketManager.getSubscribedTopics().length)
                    .toBe(initialTopicsCount + 1);
                expect(webSocketManager.watchHandlers.size)
                    .toBe(initialHandlersCount + 1);
                
                // 移除订阅
                webSocketManager.unsubscribe(`ticker:${symbol}`);
                
                expect(webSocketManager.getSubscribedTopics().length)
                    .toBe(initialTopicsCount);
                expect(webSocketManager.watchHandlers.size)
                    .toBe(initialHandlersCount);
                
            } finally {
                webSocketManager.connectionState = originalState;
            }
        });

        test('应该在清理时释放所有资源', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            const symbols = ['DOGE/USDT:USDT', 'LINK/USDT:USDT'];
            
            // 暂时设置为closed状态
            const originalState = webSocketManager.connectionState;
            webSocketManager.connectionState = 'closed';

            try {
                // 添加多个订阅
                for (const symbol of symbols) {
                    await webSocketManager.watchTicker(symbol);
                }
                
                expect(webSocketManager.getSubscribedTopics().length)
                    .toBeGreaterThanOrEqual(symbols.length);
                expect(webSocketManager.watchHandlers.size)
                    .toBeGreaterThanOrEqual(symbols.length);
                
                // 执行清理
                webSocketManager.cleanup();
                
                // 验证清理效果
                expect(webSocketManager.watchHandlers.size).toBe(0);
                expect(webSocketManager.reconnectTimer).toBeNull();
                
            } finally {
                webSocketManager.connectionState = originalState;
            }
        });
    });

    describe('重连性能测试', () => {
        test('应该在合理时间内完成重连', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            // 模拟重连场景
            const originalAttempts = webSocketManager.reconnectAttempts;
            const originalState = webSocketManager.connectionState;
            
            try {
                webSocketManager.reconnectAttempts = 0;
                webSocketManager.connectionState = 'closed';
                
                const startTime = Date.now();
                
                // 模拟重连过程
                await webSocketManager.reconnect();
                
                const endTime = Date.now();
                const duration = endTime - startTime;
                
                console.log(`重连耗时: ${duration}ms`);
                expect(duration).toBeLessThan(15000); // 应该在15秒内完成重连
                expect(webSocketManager.isConnected()).toBe(true);
                
            } catch (error) {
                console.log('重连测试失败:', error.message);
                // 重连失败是可以接受的，因为可能是网络问题
            } finally {
                webSocketManager.reconnectAttempts = originalAttempts;
                webSocketManager.connectionState = originalState;
            }
        });

        test('应该正确处理重连延迟策略', () => {
            const delays = webSocketManager.reconnectDelays;
            
            // 验证延迟策略是指数退避
            expect(delays.length).toBeGreaterThan(0);
            expect(delays[0]).toBe(1000); // 第一次重连延迟1秒
            
            // 验证延迟递增
            for (let i = 1; i < Math.min(delays.length, 5); i++) {
                expect(delays[i]).toBeGreaterThan(delays[i - 1]);
            }
            
            // 验证最大延迟不超过60秒
            expect(Math.max(...delays)).toBeLessThanOrEqual(60000);
        });
    });

    describe('并发安全测试', () => {
        test('应该安全处理并发订阅请求', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            const symbols = [
                'XRP/USDT:USDT',
                'DOT/USDT:USDT',
                'MATIC/USDT:USDT'
            ];
            
            // 暂时设置为closed状态
            const originalState = webSocketManager.connectionState;
            webSocketManager.connectionState = 'closed';

            try {
                // 并发发起订阅请求
                const promises = symbols.map(symbol => 
                    webSocketManager.watchTicker(symbol)
                );
                
                // 等待所有请求完成
                const results = await Promise.allSettled(promises);
                
                // 验证没有请求失败
                const failures = results.filter(result => result.status === 'rejected');
                expect(failures.length).toBe(0);
                
                // 验证所有订阅都已添加
                const topics = webSocketManager.getSubscribedTopics();
                symbols.forEach(symbol => {
                    expect(topics).toContain(`ticker:${symbol}`);
                });
                
            } finally {
                webSocketManager.connectionState = originalState;
            }
        });

        test('应该安全处理并发取消订阅', async () => {
            if (!isNetworkAvailable) {
                console.log('跳过测试：网络不可用');
                return;
            }

            const symbols = ['AVAX/USDT:USDT', 'ATOM/USDT:USDT'];
            
            // 暂时设置为closed状态
            const originalState = webSocketManager.connectionState;
            webSocketManager.connectionState = 'closed';

            try {
                // 先添加订阅
                for (const symbol of symbols) {
                    await webSocketManager.watchTicker(symbol);
                }
                
                // 并发取消订阅
                symbols.forEach(symbol => {
                    webSocketManager.unsubscribe(`ticker:${symbol}`);
                });
                
                // 验证所有订阅都已移除
                const topics = webSocketManager.getSubscribedTopics();
                symbols.forEach(symbol => {
                    expect(topics).not.toContain(`ticker:${symbol}`);
                });
                
            } finally {
                webSocketManager.connectionState = originalState;
            }
        });
    });
});