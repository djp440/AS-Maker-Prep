/**
 * @file Trader模块测试
 * @description 测试中低频GLFT策略交易执行引擎的核心功能
 */

const Trader = require('../trader');
const MidLowFreqGLFTStrategy = require('../mid_low_freq_glft_strategy');
const ExchangeService = require('../../services/exchange_service');
const AccountService = require('../../services/account_service');
const Logger = require('../../shared/logger');

// Mock所有依赖服务
jest.mock('../../services/exchange_service');
jest.mock('../../services/account_service');
jest.mock('../../shared/logger');
jest.mock('../mid_low_freq_glft_strategy');

describe('Trader', () => {
    let trader;
    let mockConfig;
    
    beforeEach(() => {
        // 重置所有mock
        jest.clearAllMocks();
        
        // 模拟配置
        mockConfig = {
            RISK_AVERSION: 1,
            ORDER_FLOW_A: 140,
            ORDER_FLOW_K: 1.5,
            MAX_INVENTORY_Q: 0.2,
            ORDER_AMOUNT: 0.01,
            VOLATILITY_LOOKBACK: 14,
            KLINE_INTERVAL: '15m',
            LEVERAGE: 2,
            TRADE_SIDE: 'both',
            MIN_SPREAD_PCT: 0.06,
            HALF_SPREAD_PCT: 0.04,
            REBALANCE_TIME_INTERVAL: 10,
            PRICE_MOVE_THRESHOLD_PCT: 0.05,
            USE_TRADITIONAL_GLFT: false
        };
        
        // 模拟ExchangeService
        ExchangeService.isInitialized = jest.fn().mockReturnValue(true);
        ExchangeService.fetchOpenOrders = jest.fn().mockResolvedValue([]);
        ExchangeService.fetchTicker = jest.fn().mockResolvedValue({
            bid: 50000,
            ask: 50010,
            timestamp: Date.now()
        });
        ExchangeService.cancelOrder = jest.fn().mockResolvedValue({ id: 'test-order' });
        ExchangeService.createOrder = jest.fn().mockResolvedValue({ id: 'new-order' });
        
        // 模拟AccountService
        AccountService.isServiceInitialized = jest.fn().mockReturnValue(true);
        AccountService.getNormalizedInventory = jest.fn().mockReturnValue(0.1);
        AccountService.forceSyncData = jest.fn().mockResolvedValue();
        
        // 模拟策略模块
        MidLowFreqGLFTStrategy.calculateOptimalQuotes = jest.fn().mockReturnValue({
            bidPrice: 49995,
            askPrice: 50015
        });
        
        MidLowFreqGLFTStrategy.checkInventoryLimits = jest.fn().mockReturnValue({
            canBuy: true,
            canSell: true,
            riskLevel: 'low'
        });
        
        // 创建Trader实例
        trader = new Trader('BTC/USDT:USDT', mockConfig);
    });
    
    afterEach(async () => {
        if (trader && trader.isRunning) {
            await trader.stop();
        }
    });
    
    describe('构造函数', () => {
        test('应该正确初始化Trader实例', () => {
            expect(trader.symbol).toBe('BTC/USDT:USDT');
            expect(trader.config).toEqual(mockConfig);
            expect(trader.isRunning).toBe(false);
            expect(trader.isPaused).toBe(false);
            expect(trader.activeOrders).toBeInstanceOf(Map);
            expect(trader.stats.totalUpdates).toBe(0);
        });
        
        test('应该继承EventEmitter', () => {
            expect(trader.on).toBeDefined();
            expect(trader.emit).toBeDefined();
        });
    });
    
    describe('启动和停止', () => {
        test('应该成功启动交易器', async () => {
            const startedSpy = jest.fn();
            trader.on('started', startedSpy);
            
            await trader.start();
            
            expect(trader.isRunning).toBe(true);
            expect(ExchangeService.fetchOpenOrders).toHaveBeenCalledWith('BTC/USDT:USDT');
            expect(ExchangeService.fetchTicker).toHaveBeenCalledWith('BTC/USDT:USDT');
            expect(startedSpy).toHaveBeenCalledWith({ symbol: 'BTC/USDT:USDT' });
        });
        
        test('应该在服务未初始化时抛出错误', async () => {
            ExchangeService.isInitialized.mockReturnValue(false);
            
            await expect(trader.start()).rejects.toThrow('ExchangeService not initialized');
        });
        
        test('应该成功停止交易器', async () => {
            await trader.start();
            
            const stoppedSpy = jest.fn();
            trader.on('stopped', stoppedSpy);
            
            await trader.stop();
            
            expect(trader.isRunning).toBe(false);
            expect(stoppedSpy).toHaveBeenCalledWith({ symbol: 'BTC/USDT:USDT' });
        });
    });
    
    describe('暂停和恢复', () => {
        test('应该能够暂停交易', () => {
            const pausedSpy = jest.fn();
            trader.on('paused', pausedSpy);
            
            trader.pause();
            
            expect(trader.isPaused).toBe(true);
            expect(pausedSpy).toHaveBeenCalledWith({ symbol: 'BTC/USDT:USDT' });
        });
        
        test('应该能够恢复交易', () => {
            trader.pause();
            
            const resumedSpy = jest.fn();
            trader.on('resumed', resumedSpy);
            
            trader.resume();
            
            expect(trader.isPaused).toBe(false);
            expect(resumedSpy).toHaveBeenCalledWith({ symbol: 'BTC/USDT:USDT' });
        });
    });
    
    describe('僵尸订单清理', () => {
        test('应该取消所有僵尸订单', async () => {
            const zombieOrders = [
                { id: 'order1', symbol: 'BTC/USDT:USDT' },
                { id: 'order2', symbol: 'BTC/USDT:USDT' }
            ];
            
            ExchangeService.fetchOpenOrders.mockResolvedValue(zombieOrders);
            
            await trader.cancelAllZombieOrders();
            
            expect(ExchangeService.cancelOrder).toHaveBeenCalledTimes(2);
            expect(ExchangeService.cancelOrder).toHaveBeenCalledWith('order1', 'BTC/USDT:USDT');
            expect(ExchangeService.cancelOrder).toHaveBeenCalledWith('order2', 'BTC/USDT:USDT');
        });
        
        test('应该处理取消订单失败的情况', async () => {
            const zombieOrders = [{ id: 'order1', symbol: 'BTC/USDT:USDT' }];
            
            ExchangeService.fetchOpenOrders.mockResolvedValue(zombieOrders);
            ExchangeService.cancelOrder.mockRejectedValue(new Error('Cancel failed'));
            
            // 不应该抛出错误
            await expect(trader.cancelAllZombieOrders()).resolves.not.toThrow();
        });
    });
    
    describe('市场数据获取', () => {
        test('应该正确获取当前市场数据', async () => {
            const mockTicker = {
                bid: 50000,
                ask: 50010,
                timestamp: Date.now()
            };
            
            ExchangeService.fetchTicker.mockResolvedValue(mockTicker);
            
            const marketData = await trader.getCurrentMarketData();
            
            expect(marketData).toEqual({
                bid: 50000,
                ask: 50010,
                midPrice: 50005,
                spread: 10,
                timestamp: mockTicker.timestamp
            });
        });
        
        test('应该处理获取市场数据失败的情况', async () => {
            ExchangeService.fetchTicker.mockRejectedValue(new Error('Network error'));
            
            const marketData = await trader.getCurrentMarketData();
            
            expect(marketData).toBeNull();
        });
    });
    
    describe('报价更新判断', () => {
        beforeEach(() => {
            trader.lastUpdateTime = Date.now() - 5000; // 5秒前
            trader.lastMidPrice = 50000;
            trader.lastInventory = 0.1;
        });
        
        test('应该在时间触发条件满足时返回true', () => {
            trader.lastUpdateTime = Date.now() - 15000; // 15秒前，超过10秒间隔
            
            const marketData = { midPrice: 50000 };
            const shouldUpdate = trader.shouldUpdateQuotes(marketData);
            
            expect(shouldUpdate).toBe(true);
        });
        
        test('应该在价格变动触发条件满足时返回true', () => {
            const marketData = { midPrice: 50030 }; // 0.06%的价格变动，超过0.05%阈值
            const shouldUpdate = trader.shouldUpdateQuotes(marketData);
            
            expect(shouldUpdate).toBe(true);
        });
        
        test('应该在库存变动触发条件满足时返回true', () => {
            AccountService.getNormalizedInventory.mockReturnValue(0.25); // 库存变化15%
            
            const marketData = { midPrice: 50000 };
            const shouldUpdate = trader.shouldUpdateQuotes(marketData);
            
            expect(shouldUpdate).toBe(true);
        });
        
        test('应该在所有条件都不满足时返回false', () => {
            const marketData = { midPrice: 50005 }; // 微小价格变动
            const shouldUpdate = trader.shouldUpdateQuotes(marketData);
            
            expect(shouldUpdate).toBe(false);
        });
    });
    
    describe('动态更新间隔计算', () => {
        test('应该在低风险时返回标准间隔', () => {
            AccountService.getNormalizedInventory.mockReturnValue(0.2); // 20%库存，低风险
            
            const interval = trader.calculateUpdateInterval();
            
            expect(interval).toBe(10000); // 10秒 * 1000毫秒
        });
        
        test('应该在中风险时返回缩短的间隔', () => {
            AccountService.getNormalizedInventory.mockReturnValue(0.5); // 50%库存，中风险
            
            const interval = trader.calculateUpdateInterval();
            
            expect(interval).toBe(5000); // 10秒 * 0.5 * 1000毫秒
        });
        
        test('应该在高风险时返回最短间隔', () => {
            AccountService.getNormalizedInventory.mockReturnValue(0.8); // 80%库存，高风险
            
            const interval = trader.calculateUpdateInterval();
            
            expect(interval).toBe(2500); // 10秒 * 0.25 * 1000毫秒
        });
    });
    
    describe('最优报价计算', () => {
        test('应该正确计算最优报价', async () => {
            const marketData = { midPrice: 50000 };
            const inventory = 0.1;
            
            const quotes = await trader.calculateOptimalQuotes(marketData, inventory);
            
            expect(MidLowFreqGLFTStrategy.calculateOptimalQuotes).toHaveBeenCalledWith({
                midPrice: 50000,
                halfSpreadPct: 0.0004, // 0.04% / 100
                volatility: 0.02,
                riskAversion: 1,
                inventory: 0.1,
                useTraditionalGLFT: false
            });
            
            expect(quotes).toEqual({
                bidPrice: 49995,
                askPrice: 50015,
                bidAmount: 0.01,
                askAmount: 0.01,
                timestamp: expect.any(Number),
                inventoryCheck: {
                    canBuy: true,
                    canSell: true,
                    riskLevel: 'low'
                }
            });
        });
        
        test('应该在库存限制时调整报价', async () => {
            MidLowFreqGLFTStrategy.checkInventoryLimits.mockReturnValue({
                canBuy: false,
                canSell: true,
                riskLevel: 'high'
            });
            
            const marketData = { midPrice: 50000 };
            const inventory = 0.9;
            
            const quotes = await trader.calculateOptimalQuotes(marketData, inventory);
            
            expect(quotes.bidPrice).toBe(0); // 禁止买入
            expect(quotes.askPrice).toBe(50015); // 允许卖出
        });
    });
    
    describe('订单操作分析', () => {
        test('应该正确分析需要取消和创建的订单', () => {
            const currentOrders = [
                { id: 'order1', side: 'buy', price: 49990 },
                { id: 'order2', side: 'sell', price: 50020 }
            ];
            
            const newQuotes = {
                bidPrice: 49995,
                askPrice: 50015,
                bidAmount: 0.01,
                askAmount: 0.01,
                inventoryCheck: { canBuy: true, canSell: true }
            };
            
            const operations = trader.analyzeOrderOperations(currentOrders, newQuotes);
            
            expect(operations.toCancel).toHaveLength(2); // 两个订单价格都需要调整
            expect(operations.toCreate).toHaveLength(2); // 创建新的买卖订单
            expect(operations.toCreate[0].side).toBe('buy');
            expect(operations.toCreate[1].side).toBe('sell');
        });
        
        test('应该在库存限制时不创建相应订单', () => {
            const currentOrders = [];
            const newQuotes = {
                bidPrice: 49995,
                askPrice: 50015,
                bidAmount: 0.01,
                askAmount: 0.01,
                inventoryCheck: { canBuy: false, canSell: true }
            };
            
            const operations = trader.analyzeOrderOperations(currentOrders, newQuotes);
            
            expect(operations.toCreate).toHaveLength(1); // 只创建卖单
            expect(operations.toCreate[0].side).toBe('sell');
        });
    });
    
    describe('统计功能', () => {
        test('应该正确返回交易统计', () => {
            trader.stats.totalUpdates = 10;
            trader.stats.successfulUpdates = 8;
            trader.stats.errors = 2;
            
            const stats = trader.getStats();
            
            expect(stats).toEqual({
                totalUpdates: 10,
                successfulUpdates: 8,
                errors: 2,
                lastError: null,
                avgUpdateTime: 0,
                symbol: 'BTC/USDT:USDT',
                isRunning: false,
                isPaused: false,
                lastUpdateTime: 0,
                currentInventory: 0.1
            });
        });
        
        test('应该能够重置统计', () => {
            trader.stats.totalUpdates = 10;
            trader.stats.errors = 5;
            
            trader.resetStats();
            
            expect(trader.stats.totalUpdates).toBe(0);
            expect(trader.stats.errors).toBe(0);
        });
    });
    
    describe('错误处理', () => {
        test('应该在交易循环中处理错误', async () => {
            // 直接测试executeTradingCycle方法的错误处理
            ExchangeService.fetchTicker.mockRejectedValue(new Error('Network error'));
            
            const errorSpy = jest.fn();
            trader.on('error', errorSpy);
            
            // 直接调用交易周期方法 - getCurrentMarketData会捕获错误并返回null
            // executeTradingCycle会检查marketData为null并提前返回，不会抛出错误
            await expect(trader.executeTradingCycle()).resolves.not.toThrow();
            
            // 验证没有错误统计更新（因为错误在getCurrentMarketData中被处理了）
            expect(trader.stats.errors).toBe(0);
        });
        
        test('应该在暂停状态下跳过交易循环', async () => {
            // 设置一个很短的更新间隔来快速触发
            trader.config.REBALANCE_TIME_INTERVAL = 0.1; // 0.1秒
            
            await trader.start();
            
            // 等待第一次更新完成
            await new Promise(resolve => setTimeout(resolve, 150));
            
            // 暂停交易
            trader.pause();
            
            // 记录暂停时的更新次数
            const updatesBeforePause = trader.stats.totalUpdates;
            
            // 等待足够长的时间，如果没有暂停应该会有更多更新
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // 验证暂停期间没有新的更新
            expect(trader.stats.totalUpdates).toBe(updatesBeforePause);
            
            // 恢复交易
            trader.resume();
            
            // 等待一段时间，应该有新的更新
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // 验证恢复后有新的更新
            expect(trader.stats.totalUpdates).toBeGreaterThan(updatesBeforePause);
        });
    });
    
    describe('批量订单操作', () => {
        test('应该正确执行批量订单操作', async () => {
            // 重置mock调用计数
            ExchangeService.cancelOrder.mockClear();
            ExchangeService.createOrder.mockClear();
            
            const operations = {
                toCancel: [{ id: 'order1' }, { id: 'order2' }],
                toCreate: [
                    { side: 'buy', type: 'limit', amount: 0.01, price: 49995 },
                    { side: 'sell', type: 'limit', amount: 0.01, price: 50015 }
                ]
            };
            
            await trader.executeBatchOrderOperations(operations);
            
            expect(ExchangeService.cancelOrder).toHaveBeenCalledTimes(2);
            expect(ExchangeService.createOrder).toHaveBeenCalledTimes(2);
        });
        
        test('应该处理部分操作失败的情况', async () => {
            // 重置mock调用计数
            ExchangeService.cancelOrder.mockClear();
            ExchangeService.createOrder.mockClear();
            
            ExchangeService.cancelOrder.mockRejectedValueOnce(new Error('Cancel failed'));
            ExchangeService.createOrder.mockRejectedValueOnce(new Error('Create failed'));
            
            const operations = {
                toCancel: [{ id: 'order1' }],
                toCreate: [{ side: 'buy', type: 'limit', amount: 0.01, price: 49995 }]
            };
            
            // 不应该抛出错误
            await expect(trader.executeBatchOrderOperations(operations)).resolves.not.toThrow();
        });
    });
});