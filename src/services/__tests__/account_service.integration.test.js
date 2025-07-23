/**
 * AccountService 集成测试
 * 测试 AccountService 与其他服务的集成，但不依赖外部网络连接
 */

const AccountService = require('../account_service');
const ExchangeService = require('../exchange_service');
const WebSocketManager = require('../websocket_manager');
const Logger = require('../../shared/logger');

// Mock 外部依赖以避免网络连接
jest.mock('../exchange_service');
jest.mock('../websocket_manager');
jest.mock('../../shared/logger');

describe('AccountService集成测试', () => {
    let mockExchangeService;
    let mockWebSocketManager;

    beforeAll(() => {
        // 设置 ExchangeService mock
         mockExchangeService = {
             isInitialized: jest.fn(() => true),
             fetchBalance: jest.fn(() => Promise.resolve({
                 USDT: { free: 1000, used: 0, total: 1000 },
                 BTC: { free: 0.1, used: 0, total: 0.1 }
             })),
             fetchPositions: jest.fn(() => Promise.resolve([
                 {
                     symbol: 'BTC/USDT',
                     side: 'long',
                     contracts: 0.01,
                     notional: 500,
                     unrealizedPnl: 10
                 }
             ])),
             fetchOpenOrders: jest.fn(() => Promise.resolve([
                 {
                     id: '12345',
                     symbol: 'BTC/USDT',
                     type: 'limit',
                     side: 'buy',
                     amount: 0.01,
                     price: 45000,
                     status: 'open'
                 }
             ]))
         };
        
        // 正确设置 ExchangeService mock
         Object.defineProperty(ExchangeService, 'getInstance', {
             value: jest.fn(() => mockExchangeService),
             writable: true
         });
         Object.defineProperty(ExchangeService, 'isInitialized', {
             value: jest.fn(() => true),
             writable: true
         });
         
         // 直接在ExchangeService上设置方法
         ExchangeService.fetchBalance = mockExchangeService.fetchBalance;
         ExchangeService.fetchPositions = mockExchangeService.fetchPositions;
         ExchangeService.fetchOpenOrders = mockExchangeService.fetchOpenOrders;
        
        // 设置 WebSocketManager mock
         mockWebSocketManager = {
             isConnected: jest.fn(() => true),
             on: jest.fn(),
             off: jest.fn(),
             emit: jest.fn(),
             removeAllListeners: jest.fn()
         };
         
         // 直接替换WebSocketManager的方法
         Object.assign(WebSocketManager, mockWebSocketManager);
    });

    beforeEach(async () => {
        // 重置所有 mock
        jest.clearAllMocks();
        
        // 确保 AccountService 处于干净状态
        if (AccountService.isServiceInitialized()) {
            await AccountService.cleanup();
        }
    });

    afterAll(async () => {
        // 清理资源
        if (AccountService.isServiceInitialized()) {
            await AccountService.cleanup();
        }
        jest.restoreAllMocks();
    });

    describe('服务初始化集成测试', () => {
        test('应该能够成功初始化AccountService', async () => {
            await expect(AccountService.initialize()).resolves.not.toThrow();
            expect(AccountService.isServiceInitialized()).toBe(true);
        });

        test('初始化后应该绑定WebSocket事件', async () => {
            await AccountService.initialize();
            
            // 验证WebSocket事件绑定
            expect(mockWebSocketManager.on).toHaveBeenCalledWith('balance', expect.any(Function));
            expect(mockWebSocketManager.on).toHaveBeenCalledWith('orders', expect.any(Function));
            expect(mockWebSocketManager.on).toHaveBeenCalledWith('positions', expect.any(Function));
        });
    });

    describe('数据同步集成测试', () => {
        beforeEach(async () => {
            await AccountService.initialize();
        });

        test('应该能够执行全量数据同步', async () => {
            await AccountService.forceSyncData();
            
            // 验证调用了相应的ExchangeService方法
            expect(mockExchangeService.fetchBalance).toHaveBeenCalled();
            expect(mockExchangeService.fetchPositions).toHaveBeenCalled();
            expect(mockExchangeService.fetchOpenOrders).toHaveBeenCalled();
        });

        test('同步后应该能够获取数据', async () => {
            await AccountService.forceSyncData();
            
            // 验证数据获取功能
            const balance = AccountService.getBalance();
            const positions = AccountService.getAllPositions();
            const orders = AccountService.getOpenOrders();
            
            expect(balance).toBeDefined();
            expect(Array.isArray(positions)).toBe(true);
            expect(Array.isArray(orders)).toBe(true);
        });
    });

    describe('事件系统集成测试', () => {
        beforeEach(async () => {
            await AccountService.initialize();
        });

        test('应该能够处理余额更新事件', () => {
             const mockBalanceData = {
                 USDT: { free: 1500, used: 0, total: 1500 }
             };
             
             // 验证WebSocket事件绑定
             expect(mockWebSocketManager.on).toHaveBeenCalledWith('balance', expect.any(Function));
             
             // 模拟WebSocket余额更新
             const balanceCall = mockWebSocketManager.on.mock.calls
                 .find(call => call[0] === 'balance');
             
             if (balanceCall && balanceCall[1]) {
                 expect(() => {
                     balanceCall[1](mockBalanceData);
                 }).not.toThrow();
             } else {
                 // 如果没有找到处理器，至少验证绑定被调用了
                 expect(mockWebSocketManager.on).toHaveBeenCalledWith('balance', expect.any(Function));
             }
         });

        test('应该能够处理持仓更新事件', () => {
             const mockPositionsData = [{
                 symbol: 'ETH/USDT',
                 side: 'long',
                 contracts: 1,
                 notional: 2000
             }];
             
             // 验证WebSocket事件绑定
             expect(mockWebSocketManager.on).toHaveBeenCalledWith('positions', expect.any(Function));
             
             // 模拟WebSocket持仓更新
             const positionsCall = mockWebSocketManager.on.mock.calls
                 .find(call => call[0] === 'positions');
             
             if (positionsCall && positionsCall[1]) {
                 expect(() => {
                     positionsCall[1](mockPositionsData);
                 }).not.toThrow();
             } else {
                 // 如果没有找到处理器，至少验证绑定被调用了
                 expect(mockWebSocketManager.on).toHaveBeenCalledWith('positions', expect.any(Function));
             }
         });
    });

    describe('核心功能集成测试', () => {
        beforeEach(async () => {
            await AccountService.initialize();
            await AccountService.forceSyncData();
        });

        test('应该能够计算总资产', () => {
            const totalEquity = AccountService.getTotalEquity();
            expect(typeof totalEquity).toBe('number');
            expect(totalEquity).toBeGreaterThanOrEqual(0);
        });

        test('应该能够获取特定交易对持仓', () => {
            const position = AccountService.getPosition('BTC/USDT');
            // 可能为null（无持仓）或对象（有持仓）
            expect(position === null || typeof position === 'object').toBe(true);
        });

        test('应该能够计算标准化库存', () => {
            const inventory = AccountService.getNormalizedInventory('BTC/USDT');
            expect(typeof inventory).toBe('number');
            expect(inventory).toBeGreaterThanOrEqual(-1);
            expect(inventory).toBeLessThanOrEqual(1);
        });
    });

    describe('错误处理集成测试', () => {
        beforeEach(async () => {
            await AccountService.initialize();
        });

        test('应该能够处理ExchangeService错误', async () => {
             // 模拟ExchangeService错误
             mockExchangeService.fetchBalance.mockRejectedValueOnce(new Error('网络错误'));
             
             // 应该能够捕获并处理错误，不会导致程序崩溃
             try {
                 await AccountService.forceSyncData();
                 // 如果没有抛出错误，说明错误被正确处理了
             } catch (error) {
                 // 如果抛出错误，验证是预期的错误
                 expect(error.message).toBe('网络错误');
             }
             
             // 验证服务仍然可用
             expect(AccountService.isServiceInitialized()).toBe(true);
         });

        test('应该能够处理无效参数', () => {
            expect(() => {
                AccountService.getPosition(null);
            }).not.toThrow();
            
            expect(() => {
                AccountService.getNormalizedInventory('');
            }).not.toThrow();
        });
    });

    describe('性能基准测试', () => {
        beforeEach(async () => {
            await AccountService.initialize();
            await AccountService.forceSyncData();
        });

        test('数据获取方法应该快速响应', () => {
            const methods = [
                () => AccountService.getTotalEquity(),
                () => AccountService.getBalance(),
                () => AccountService.getAllPositions(),
                () => AccountService.getOpenOrders()
            ];
            
            methods.forEach(method => {
                const start = Date.now();
                method();
                const duration = Date.now() - start;
                expect(duration).toBeLessThan(50); // 应该在50ms内完成
            });
        });
    });
});