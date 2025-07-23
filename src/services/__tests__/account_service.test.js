/**
 * AccountService 单元测试
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
    removeAllListeners: jest.fn()
}));

// Mock ExchangeService
jest.mock('../exchange_service', () => ({
    isInitialized: jest.fn().mockReturnValue(true),
    fetchBalance: jest.fn(),
    fetchPositions: jest.fn(),
    fetchOpenOrders: jest.fn()
}));

const AccountService = require('../account_service');
const WebSocketManager = require('../websocket_manager');
const ExchangeService = require('../exchange_service');

describe('AccountService', () => {
    let accountService;

    beforeEach(() => {
        // 重置所有mock
        jest.clearAllMocks();
        
        // 重置mock函数的返回值
        ExchangeService.isInitialized.mockReturnValue(true);
        
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
    });

    describe('初始化', () => {
        test('应该成功初始化AccountService', async () => {
            // 设置mock数据
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);

            await accountService.initialize();

            expect(accountService.isServiceInitialized()).toBe(true);
            expect(WebSocketManager.on).toHaveBeenCalledWith('balance', expect.any(Function));
            expect(WebSocketManager.on).toHaveBeenCalledWith('orders', expect.any(Function));
            expect(WebSocketManager.on).toHaveBeenCalledWith('positions', expect.any(Function));
        });

        test('当ExchangeService未初始化时应该抛出错误', async () => {
            ExchangeService.isInitialized.mockReturnValue(false);

            await expect(accountService.initialize()).rejects.toThrow(
                'ExchangeService未初始化，请先初始化ExchangeService'
            );
        });
    });

    describe('余额管理', () => {
        beforeEach(async () => {
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);
            
            await accountService.initialize();
        });

        test('应该正确获取总资产', () => {
            const totalEquity = accountService.getTotalEquity();
            expect(totalEquity).toBe(1000);
        });

        test('应该正确处理余额更新事件', () => {
            const newBalance = {
                USDT: { total: 1500 },
                info: { totalEquity: '1500' }
            };

            // 模拟余额更新事件
            accountService.handleBalanceUpdate(newBalance);

            expect(accountService.getTotalEquity()).toBe(1500);
        });
    });

    describe('持仓管理', () => {
        beforeEach(async () => {
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);
            
            await accountService.initialize();
        });

        test('应该正确获取持仓信息', () => {
            const position = {
                symbol: 'BTC/USDT:USDT',
                side: 'long',
                contracts: 0.1,
                entryPrice: 50000,
                markPrice: 51000
            };

            // 模拟持仓更新
            accountService.handlePositionsUpdate([position]);

            const retrievedPosition = accountService.getPosition('BTC/USDT:USDT');
            expect(retrievedPosition).toEqual(position);
        });

        test('应该正确计算标准化库存', () => {
            const position = {
                symbol: 'BTC/USDT:USDT',
                side: 'long',
                contracts: 0.1,
                entryPrice: 50000,
                markPrice: 50000
            };

            // 设置余额
            accountService.handleBalanceUpdate({
                USDT: { total: 10000 },
                info: { totalEquity: '10000' }
            });

            // 设置持仓
            accountService.handlePositionsUpdate([position]);

            const normalizedInventory = accountService.getNormalizedInventory('BTC/USDT:USDT');
            
            // 持仓价值 = 0.1 * 50000 = 5000
            // 标准化库存 = 5000 / 10000 = 0.5
            expect(normalizedInventory).toBe(0.5);
        });

        test('空头持仓应该返回负的标准化库存', () => {
            const position = {
                symbol: 'BTC/USDT:USDT',
                side: 'short',
                contracts: 0.1,
                entryPrice: 50000,
                markPrice: 50000
            };

            // 设置余额
            accountService.handleBalanceUpdate({
                USDT: { total: 10000 },
                info: { totalEquity: '10000' }
            });

            // 设置持仓
            accountService.handlePositionsUpdate([position]);

            const normalizedInventory = accountService.getNormalizedInventory('BTC/USDT:USDT');
            expect(normalizedInventory).toBe(-0.5);
        });

        test('无持仓时应该返回0', () => {
            const normalizedInventory = accountService.getNormalizedInventory('BTC/USDT:USDT');
            expect(normalizedInventory).toBe(0);
        });
    });

    describe('订单管理', () => {
        beforeEach(async () => {
            ExchangeService.fetchBalance.mockResolvedValue({
                USDT: { total: 1000 },
                info: { totalEquity: '1000' }
            });
            ExchangeService.fetchPositions.mockResolvedValue([]);
            ExchangeService.fetchOpenOrders.mockResolvedValue([]);
            
            await accountService.initialize();
        });

        test('应该正确管理活动订单', () => {
            const orders = [
                {
                    id: '1',
                    symbol: 'BTC/USDT:USDT',
                    status: 'open',
                    side: 'buy',
                    amount: 0.1
                },
                {
                    id: '2',
                    symbol: 'BTC/USDT:USDT',
                    status: 'filled',
                    side: 'sell',
                    amount: 0.05
                }
            ];

            // 模拟订单更新
            accountService.handleOrdersUpdate(orders);

            const openOrders = accountService.getOpenOrders();
            expect(openOrders).toHaveLength(1);
            expect(openOrders[0].id).toBe('1');
        });

        test('应该能按交易对筛选订单', () => {
            const orders = [
                {
                    id: '1',
                    symbol: 'BTC/USDT:USDT',
                    status: 'open',
                    side: 'buy',
                    amount: 0.1
                },
                {
                    id: '2',
                    symbol: 'ETH/USDT:USDT',
                    status: 'open',
                    side: 'sell',
                    amount: 1.0
                }
            ];

            accountService.handleOrdersUpdate(orders);

            const btcOrders = accountService.getOpenOrders('BTC/USDT:USDT');
            expect(btcOrders).toHaveLength(1);
            expect(btcOrders[0].symbol).toBe('BTC/USDT:USDT');
        });
    });

    describe('数据同步', () => {
        test('应该能执行全量数据同步', async () => {
            const mockBalance = {
                USDT: { total: 2000 },
                info: { totalEquity: '2000' }
            };
            const mockPositions = [
                {
                    symbol: 'BTC/USDT:USDT',
                    side: 'long',
                    contracts: 0.2
                }
            ];
            const mockOrders = [
                {
                    id: '1',
                    symbol: 'BTC/USDT:USDT',
                    status: 'open'
                }
            ];

            ExchangeService.fetchBalance.mockResolvedValue(mockBalance);
            ExchangeService.fetchPositions.mockResolvedValue(mockPositions);
            ExchangeService.fetchOpenOrders.mockResolvedValue(mockOrders);

            await accountService.syncFullData();

            expect(accountService.getTotalEquity()).toBe(2000);
            expect(accountService.getAllPositions()).toHaveLength(1);
            expect(accountService.getOpenOrders()).toHaveLength(1);
        });
    });
});