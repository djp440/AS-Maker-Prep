const Trader = require('../trader');
const ExchangeService = require('../../services/exchange_service');
const AccountService = require('../../services/account_service');
const Config = require('../../shared/config');
const Logger = require('../../shared/logger');

// Mock dependencies
jest.mock('../../services/exchange_service');
jest.mock('../../services/account_service');
jest.mock('../../shared/config');
jest.mock('../../shared/logger');

describe('Trader - Bitget双向持仓模式测试', () => {
    let trader;
    let mockConfig;
    
    beforeEach(() => {
        // 重置所有mock
        jest.clearAllMocks();
        
        // Mock配置
        mockConfig = {
            SYMBOLS: {
                'BTC/USDT:USDT': {
                    TRADE_SIDE: 'both',
                    INVENTORY_TARGET: 0,
                    MAX_INVENTORY: 0.8,
                    QUOTE_AMOUNT: 100
                }
            }
        };
        
        Config.getStrategyParams = jest.fn().mockReturnValue(mockConfig.SYMBOLS['BTC/USDT:USDT']);
        
        // Mock ExchangeService
        ExchangeService.createOrder = jest.fn().mockResolvedValue({ id: 'test-order-id' });
        ExchangeService.cancelOrder = jest.fn().mockResolvedValue({ id: 'cancelled-order-id' });
        ExchangeService.getExchangeName = jest.fn().mockReturnValue('bitget');
        
        // Mock AccountService
        AccountService.getPosition = jest.fn();
        AccountService.getTotalEquity = jest.fn().mockReturnValue(10000);
        AccountService.getNormalizedInventory = jest.fn().mockReturnValue(0);
        
        // Mock Logger
        Logger.debug = jest.fn();
        Logger.info = jest.fn();
        Logger.warn = jest.fn();
        Logger.error = jest.fn();
        
        trader = new Trader('BTC/USDT:USDT', mockConfig);
        trader.accountService = AccountService;
        trader.exchangeService = ExchangeService;
    });
    
    describe('executeBatchOrderOperations - 双向持仓模式参数', () => {
        test('应该为买单设置正确的positionSide参数', async () => {
            const operations = {
                toCancel: [],
                toCreate: [
                    {
                        type: 'limit',
                        side: 'buy',
                        amount: 0.01,
                        price: 50000
                    }
                ]
            };
            
            // Mock无持仓
            AccountService.getPosition.mockReturnValue(null);
            
            await trader.executeBatchOrderOperations(operations);
            
            expect(ExchangeService.createOrder).toHaveBeenCalledWith(
                'BTC/USDT:USDT',
                'limit',
                'buy',
                0.01,
                50000,
                { positionSide: 'long' }
            );
        });
        
        test('应该为卖单设置正确的positionSide参数', async () => {
            const operations = {
                toCancel: [],
                toCreate: [
                    {
                        type: 'limit',
                        side: 'sell',
                        amount: 0.01,
                        price: 51000
                    }
                ]
            };
            
            // Mock无持仓
            AccountService.getPosition.mockReturnValue(null);
            
            await trader.executeBatchOrderOperations(operations);
            
            expect(ExchangeService.createOrder).toHaveBeenCalledWith(
                'BTC/USDT:USDT',
                'limit',
                'sell',
                0.01,
                51000,
                { positionSide: 'short' }
            );
        });
    });
    
    describe('isReduceOnlyOrder - 平仓逻辑判断', () => {
        test('无持仓时应该返回false', () => {
            const orderSpec = { side: 'buy', amount: 0.01 };
            const result = trader.isReduceOnlyOrder(orderSpec, null);
            expect(result).toBe(false);
        });
        
        test('持仓为0时应该返回false', () => {
            const orderSpec = { side: 'buy', amount: 0.01 };
            const position = { contracts: 0, side: 'long', markPrice: 50000 };
            const result = trader.isReduceOnlyOrder(orderSpec, position);
            expect(result).toBe(false);
        });
        
        test('多头持仓且卖单且持仓比例大于50%时应该返回true', () => {
            const orderSpec = { side: 'sell', amount: 0.01 };
            const position = {
                contracts: 0.2, // 0.2 BTC
                side: 'long',
                markPrice: 50000 // 价值10000 USDT
            };
            
            // 总资产10000，持仓价值10000，比例100% > 50%
            AccountService.getTotalEquity.mockReturnValue(10000);
            
            const result = trader.isReduceOnlyOrder(orderSpec, position);
            expect(result).toBe(true);
        });
        
        test('空头持仓且买单且持仓比例大于50%时应该返回true', () => {
            const orderSpec = { side: 'buy', amount: 0.01 };
            const position = {
                contracts: 0.15, // 0.15 BTC
                side: 'short',
                markPrice: 50000 // 价值7500 USDT
            };
            
            // 总资产10000，持仓价值7500，比例75% > 50%
            AccountService.getTotalEquity.mockReturnValue(10000);
            
            const result = trader.isReduceOnlyOrder(orderSpec, position);
            expect(result).toBe(true);
        });
        
        test('持仓比例小于50%时应该返回false', () => {
            const orderSpec = { side: 'sell', amount: 0.01 };
            const position = {
                contracts: 0.05, // 0.05 BTC
                side: 'long',
                markPrice: 50000 // 价值2500 USDT
            };
            
            // 总资产10000，持仓价值2500，比例25% < 50%
            AccountService.getTotalEquity.mockReturnValue(10000);
            
            const result = trader.isReduceOnlyOrder(orderSpec, position);
            expect(result).toBe(false);
        });
        
        test('订单方向与持仓方向相同时应该返回false', () => {
            const orderSpec = { side: 'buy', amount: 0.01 }; // 买单
            const position = {
                contracts: 0.2,
                side: 'long', // 多头持仓
                markPrice: 50000
            };
            
            AccountService.getTotalEquity.mockReturnValue(10000);
            
            const result = trader.isReduceOnlyOrder(orderSpec, position);
            expect(result).toBe(false); // 买单不能平多头持仓
        });
    });
    
    describe('executeBatchOrderOperations - 平仓逻辑集成测试', () => {
        test('大持仓平仓时应该添加reduceOnly参数', async () => {
            const operations = {
                toCancel: [],
                toCreate: [
                    {
                        type: 'limit',
                        side: 'sell', // 卖单平多头持仓
                        amount: 0.01,
                        price: 51000
                    }
                ]
            };
            
            // Mock大持仓
            const position = {
                contracts: 0.2, // 0.2 BTC
                side: 'long',
                markPrice: 50000 // 价值10000 USDT，占总资产100%
            };
            AccountService.getPosition.mockReturnValue(position);
            AccountService.getTotalEquity.mockReturnValue(10000);
            
            await trader.executeBatchOrderOperations(operations);
            
            expect(ExchangeService.createOrder).toHaveBeenCalledWith(
                'BTC/USDT:USDT',
                'limit',
                'sell',
                0.01,
                51000,
                { 
                    positionSide: 'short',
                    reduceOnly: true 
                }
            );
            
            expect(Logger.debug).toHaveBeenCalledWith(
                'Creating reduce-only sell order for BTC/USDT:USDT'
            );
        });
        
        test('小持仓时不应该添加reduceOnly参数', async () => {
            const operations = {
                toCancel: [],
                toCreate: [
                    {
                        type: 'limit',
                        side: 'sell',
                        amount: 0.01,
                        price: 51000
                    }
                ]
            };
            
            // Mock小持仓
            const position = {
                contracts: 0.05, // 0.05 BTC
                side: 'long',
                markPrice: 50000 // 价值2500 USDT，占总资产25%
            };
            AccountService.getPosition.mockReturnValue(position);
            AccountService.getTotalEquity.mockReturnValue(10000);
            
            await trader.executeBatchOrderOperations(operations);
            
            expect(ExchangeService.createOrder).toHaveBeenCalledWith(
                'BTC/USDT:USDT',
                'limit',
                'sell',
                0.01,
                51000,
                { positionSide: 'short' } // 没有reduceOnly
            );
        });
    });
    
    describe('错误处理', () => {
        test('创建订单失败时应该记录警告日志', async () => {
            const operations = {
                toCancel: [],
                toCreate: [
                    {
                        type: 'limit',
                        side: 'buy',
                        amount: 0.01,
                        price: 50000
                    }
                ]
            };
            
            ExchangeService.createOrder.mockRejectedValue(new Error('API错误'));
            AccountService.getPosition.mockReturnValue(null);
            
            await trader.executeBatchOrderOperations(operations);
            
            expect(Logger.warn).toHaveBeenCalledWith(
                'Failed to create buy order:',
                'API错误'
            );
        });
    });
});