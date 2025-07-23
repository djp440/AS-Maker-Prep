/**
 * AccountService 增强测试
 * 包含边界情况、异常处理和并发测试
 */

// Mock logger first
jest.mock('../../shared/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// Mock WebSocketManager
jest.mock('../websocket_manager', () => ({
    on: jest.fn(),
    removeAllListeners: jest.fn(),
    emit: jest.fn()
}));

// Mock ExchangeService
jest.mock('../exchange_service', () => ({
    isInitialized: jest.fn().mockReturnValue(true),
    fetchBalance: jest.fn(),
    fetchPositions: jest.fn(),
    fetchOpenOrders: jest.fn()
}));

// Mock utils
jest.mock('../../shared/utils', () => ({
    getTimestamp: jest.fn().mockReturnValue(1000)
}));

const AccountService = require('../account_service');
const WebSocketManager = require('../websocket_manager');
const ExchangeService = require('../exchange_service');
const { getTimestamp } = require('../../shared/utils');

describe('AccountService增强测试', () => {
    let accountService;
    let eventHandlers = {};

    beforeEach(() => {
        // 重置所有mock
        jest.clearAllMocks();
        
        // 重置mock函数的返回值
        ExchangeService.isInitialized.mockReturnValue(true);
        
        // 模拟WebSocketManager.on方法来捕获事件处理函数
        WebSocketManager.on.mockImplementation((event, handler) => {
            eventHandlers[event] = handler;
            return WebSocketManager;
        });
        
        // 获取AccountService实例
        accountService = AccountService;
        
        // 重置AccountService状态
        accountService.isInitialized = false;
        accountService.balance = {};
        accountService.positions = new Map();
        accountService.openOrders = new Map();
    });

    afterEach(() => {
        // 清理AccountService状态
        if (accountService && typeof accountService.cleanup === 'function') {
            accountService.cleanup();
        }
        eventHandlers = {};
    });

    describe('事件发射机制测试', () => {
        beforeEach(async () => {
            // 设置基础数据
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);
            
            // 监听AccountService发出的事件
            accountService.emit = jest.fn();
            
            await accountService.initialize();
        });

        test('应该在余额更新时发射balanceUpdated事件', () => {
            const newBalance = {
                USDT: { total: 1500 },
                info: { totalEquity: '1500' }
            };

            accountService.handleBalanceUpdate(newBalance);

            expect(accountService.emit).toHaveBeenCalledWith('balanceUpdated', newBalance);
        });

        test('应该在持仓更新时发射positionsUpdated事件', () => {
            const positions = [
                {
                    symbol: 'BTC/USDT:USDT',
                    side: 'long',
                    contracts: 0.1
                }
            ];

            accountService.handlePositionsUpdate(positions);

            expect(accountService.emit).toHaveBeenCalledWith(
                'positionsUpdated', 
                expect.arrayContaining([expect.objectContaining({symbol: 'BTC/USDT:USDT'})])
            );
        });

        test('应该在订单更新时发射ordersUpdated事件', () => {
            const orders = [
                {
                    id: '1',
                    symbol: 'BTC/USDT:USDT',
                    status: 'open'
                }
            ];

            accountService.handleOrdersUpdate(orders);

            expect(accountService.emit).toHaveBeenCalledWith(
                'ordersUpdated', 
                expect.arrayContaining([expect.objectContaining({id: '1'})])
            );
        });

        test('应该在数据同步完成时发射dataSynced事件', async () => {
            await accountService.syncFullData();

            expect(accountService.emit).toHaveBeenCalledWith(
                'dataSynced', 
                expect.objectContaining({
                    balance: expect.any(Object),
                    positions: expect.any(Array),
                    openOrders: expect.any(Array)
                })
            );
        });
    });

    describe('WebSocket重连处理测试', () => {
        beforeEach(async () => {
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);
            
            await accountService.initialize();
            
            // 清除初始化调用的记录
            ExchangeService.fetchBalance.mockClear();
            ExchangeService.fetchPositions.mockClear();
            ExchangeService.fetchOpenOrders.mockClear();
        });

        test('应该在WebSocket重连后重新同步数据', async () => {
            // 模拟触发reconnected事件
            if (eventHandlers.reconnected) {
                await eventHandlers.reconnected();
            }

            expect(ExchangeService.fetchBalance).toHaveBeenCalled();
            expect(ExchangeService.fetchPositions).toHaveBeenCalled();
            expect(ExchangeService.fetchOpenOrders).toHaveBeenCalled();
        });
    });

    describe('API调用失败处理测试', () => {
        beforeEach(async () => {
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);
            
            await accountService.initialize();
        });

        test('应该处理syncFullData中的API错误', async () => {
            // 模拟API调用失败
            ExchangeService.fetchBalance.mockRejectedValue(new Error('API错误'));

            // 测试错误处理
            await expect(accountService.syncFullData()).rejects.toThrow('API错误');
        });

        test('应该处理handleBalanceUpdate中的错误', () => {
            // 传入无效数据
            accountService.handleBalanceUpdate(null);

            // 确保不会抛出错误
            expect(accountService.getTotalEquity()).toBe(0);
        });

        test('应该处理handleOrdersUpdate中的错误', () => {
            // 传入无效数据
            accountService.handleOrdersUpdate(null);

            // 确保不会抛出错误
            expect(accountService.getOpenOrders()).toHaveLength(0);
        });

        test('应该处理handlePositionsUpdate中的错误', () => {
            // 传入无效数据
            accountService.handlePositionsUpdate(null);

            // 确保不会抛出错误
            expect(accountService.getAllPositions()).toHaveLength(0);
        });
    });

    describe('标准化库存边界值测试', () => {
        beforeEach(async () => {
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);
            
            await accountService.initialize();
        });

        test('持仓价值超过总资产时应该限制在1', () => {
            // 设置余额
            accountService.handleBalanceUpdate({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });

            // 设置超大持仓
            const position = {
                symbol: 'BTC/USDT:USDT',
                side: 'long',
                contracts: 1,
                entryPrice: 50000,
                markPrice: 50000
            };
            accountService.handlePositionsUpdate([position]);

            // 持仓价值 = 1 * 50000 = 50000，超过总资产1000
            const normalizedInventory = accountService.getNormalizedInventory('BTC/USDT:USDT');
            
            // 应该限制在1
            expect(normalizedInventory).toBe(1);
        });

        test('空头持仓价值超过总资产时应该限制在-1', () => {
            // 设置余额
            accountService.handleBalanceUpdate({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });

            // 设置超大空头持仓
            const position = {
                symbol: 'BTC/USDT:USDT',
                side: 'short',
                contracts: 1,
                entryPrice: 50000,
                markPrice: 50000
            };
            accountService.handlePositionsUpdate([position]);

            const normalizedInventory = accountService.getNormalizedInventory('BTC/USDT:USDT');
            
            // 应该限制在-1
            expect(normalizedInventory).toBe(-1);
        });

        test('总资产为0时应该返回0', () => {
            // 设置余额为0
            accountService.handleBalanceUpdate({
                USDT: { total: 0 },
                info: { totalEquity: '0' }
            });

            // 设置持仓
            const position = {
                symbol: 'BTC/USDT:USDT',
                side: 'long',
                contracts: 0.1,
                entryPrice: 50000,
                markPrice: 50000
            };
            accountService.handlePositionsUpdate([position]);

            const normalizedInventory = accountService.getNormalizedInventory('BTC/USDT:USDT');
            
            // 总资产为0时应该返回0
            expect(normalizedInventory).toBe(0);
        });
    });

    describe('资源清理测试', () => {
        beforeEach(async () => {
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);
            
            await accountService.initialize();
        });

        test('cleanup应该正确清理所有资源', () => {
            // 设置一些数据
            accountService.handleBalanceUpdate({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });

            const position = {
                symbol: 'BTC/USDT:USDT',
                side: 'long',
                contracts: 0.1,
                entryPrice: 50000
            };
            accountService.handlePositionsUpdate([position]);

            const order = {
                id: '1',
                symbol: 'BTC/USDT:USDT',
                status: 'open'
            };
            accountService.handleOrdersUpdate([order]);

            // 执行清理
            accountService.cleanup();

            // 验证状态已重置
            expect(accountService.isServiceInitialized()).toBe(false);
            expect(accountService.getTotalEquity()).toBe(0);
            expect(accountService.getAllPositions()).toHaveLength(0);
            expect(accountService.getOpenOrders()).toHaveLength(0);

            // 验证事件监听器已移除
            expect(WebSocketManager.removeAllListeners).toHaveBeenCalledWith('balance');
            expect(WebSocketManager.removeAllListeners).toHaveBeenCalledWith('orders');
            expect(WebSocketManager.removeAllListeners).toHaveBeenCalledWith('positions');
            expect(WebSocketManager.removeAllListeners).toHaveBeenCalledWith('reconnected');
        });
    });

    describe('定期同步机制测试', () => {
        beforeEach(() => {
            // 模拟setInterval
            jest.useFakeTimers();
            
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('应该验证定期同步机制存在', async () => {
            await accountService.initialize();
            
            // 验证AccountService有定期同步相关的属性
            expect(accountService.syncInterval).toBeDefined();
            expect(typeof accountService.syncInterval).toBe('number');
            expect(accountService.syncInterval).toBeGreaterThan(0);
            
            // 验证有强制同步的方法
            expect(typeof accountService.forceSyncData).toBe('function');
        });

        test('应该能手动触发数据同步', async () => {
            await accountService.initialize();
            
            // 清除初始化调用的记录
            ExchangeService.fetchBalance.mockClear();
            ExchangeService.fetchPositions.mockClear();
            ExchangeService.fetchOpenOrders.mockClear();
            
            // 手动触发同步
            await accountService.forceSyncData();
            
            // 验证是否执行了同步
            expect(ExchangeService.fetchBalance).toHaveBeenCalled();
            expect(ExchangeService.fetchPositions).toHaveBeenCalled();
            expect(ExchangeService.fetchOpenOrders).toHaveBeenCalled();
        });
    });
});