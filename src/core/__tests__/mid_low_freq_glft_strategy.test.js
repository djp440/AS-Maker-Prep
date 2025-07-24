const MidLowFreqGLFTStrategy = require('../mid_low_freq_glft_strategy');

describe('MidLowFreqGLFTStrategy', () => {
    describe('calculateFixedSpreadQuotes', () => {
        it('should calculate bid and ask prices correctly with zero inventory', () => {
            const inputs = {
                midPrice: 100,
                halfSpreadPct: 0.01, // 1%
                volatility: 0.02,
                riskAversion: 0.5,
                inventory: 0
            };
            const { bidPrice, askPrice } = MidLowFreqGLFTStrategy.calculateFixedSpreadQuotes(inputs);
            expect(bidPrice).toBe(99);
            expect(askPrice).toBe(101);
        });

        it('should adjust quotes based on positive inventory', () => {
            const inputs = {
                midPrice: 100,
                halfSpreadPct: 0.01,
                volatility: 0.02,
                riskAversion: 0.5,
                inventory: 10
            };
            const { bidPrice, askPrice } = MidLowFreqGLFTStrategy.calculateFixedSpreadQuotes(inputs);
            // skew = 0.02 * 0.5 = 0.01
            // bidDepth = 1 + 0.01 * 10 = 1.1
            // askDepth = 1 - 0.01 * 10 = 0.9
            expect(bidPrice).toBe(100 - 1.1); // 98.9
            expect(askPrice).toBe(100 + 0.9); // 100.9
        });

        it('should adjust quotes based on negative inventory', () => {
            const inputs = {
                midPrice: 100,
                halfSpreadPct: 0.01,
                volatility: 0.02,
                riskAversion: 0.5,
                inventory: -10
            };
            const { bidPrice, askPrice } = MidLowFreqGLFTStrategy.calculateFixedSpreadQuotes(inputs);
            // skew = 0.01
            // bidDepth = 1 + 0.01 * -10 = 0.9
            // askDepth = 1 - 0.01 * -10 = 1.1
            expect(bidPrice).toBe(100 - 0.9); // 99.1
            expect(askPrice).toBe(100 + 1.1); // 101.1
        });
    });

    describe('shouldUpdateQuotes', () => {
        it('should return true if price change is above threshold', () => {
            expect(MidLowFreqGLFTStrategy.shouldUpdateQuotes(101, 100, 0.005)).toBe(true);
        });

        it('should return false if price change is below threshold', () => {
            expect(MidLowFreqGLFTStrategy.shouldUpdateQuotes(100.1, 100, 0.005)).toBe(false);
        });
    });

    describe('calculateRebalanceInterval', () => {
        it('should return base interval for low volatility', () => {
            expect(MidLowFreqGLFTStrategy.calculateRebalanceInterval(0.01, 10000)).toBe(10000);
        });

        it('should return halved interval for high volatility', () => {
            expect(MidLowFreqGLFTStrategy.calculateRebalanceInterval(0.06, 10000)).toBe(5000);
        });
    });

    // ==================== 传统GLFT模型测试 ====================
    
    describe('传统GLFT模型 - calculateConstants', () => {
        it('应该正确计算C1和C2常数', () => {
            const gamma = 0.1;
            const orderFlowA = 140;
            const orderFlowK = 1.5;
            
            const result = MidLowFreqGLFTStrategy.calculateConstants(gamma, orderFlowA, orderFlowK);
            
            expect(result).toHaveProperty('C1');
            expect(result).toHaveProperty('C2');
            expect(result.C1).toBeGreaterThan(0);
            expect(result.C2).toBeGreaterThan(0);
            expect(typeof result.C1).toBe('number');
            expect(typeof result.C2).toBe('number');
        });

        it('应该在不同参数下产生不同的常数', () => {
            const result1 = MidLowFreqGLFTStrategy.calculateConstants(0.1, 140, 1.5);
            const result2 = MidLowFreqGLFTStrategy.calculateConstants(0.2, 140, 1.5);
            
            expect(result1.C1).not.toBe(result2.C1);
            expect(result1.C2).not.toBe(result2.C2);
        });
    });

    describe('传统GLFT模型 - calculateHalfSpread', () => {
        it('应该正确计算半价差', () => {
            const C1 = 0.001;
            const C2 = 0.0005;
            const volatility = 0.02;
            
            const result = MidLowFreqGLFTStrategy.calculateHalfSpread(C1, C2, volatility);
            const expected = C1 + C2 * volatility * volatility;
            
            expect(result).toBe(expected);
            expect(result).toBeGreaterThan(C1); // 应该大于基础价差
        });

        it('波动率为零时应该等于C1', () => {
            const C1 = 0.001;
            const C2 = 0.0005;
            const volatility = 0;
            
            const result = MidLowFreqGLFTStrategy.calculateHalfSpread(C1, C2, volatility);
            
            expect(result).toBe(C1);
        });
    });

    describe('传统GLFT模型 - calculateSkew', () => {
        it('应该正确计算库存偏度', () => {
            const C2 = 0.0005;
            const volatility = 0.02;
            
            const result = MidLowFreqGLFTStrategy.calculateSkew(C2, volatility);
            const expected = C2 * volatility;
            
            expect(result).toBe(expected);
        });

        it('波动率为零时偏度应为零', () => {
            const C2 = 0.0005;
            const volatility = 0;
            
            const result = MidLowFreqGLFTStrategy.calculateSkew(C2, volatility);
            
            expect(result).toBe(0);
        });
    });

    describe('传统GLFT模型 - calculateQuoteDepths', () => {
        it('零库存时买卖深度应该相等', () => {
            const halfSpread = 20;
            const skew = 5;
            const normalizedInventory = 0;
            
            const result = MidLowFreqGLFTStrategy.calculateQuoteDepths(halfSpread, skew, normalizedInventory);
            
            expect(result.bidDepth).toBe(halfSpread);
            expect(result.askDepth).toBe(halfSpread);
            expect(result.bidDepth).toBe(result.askDepth);
        });

        it('正库存时买单应该更远，卖单应该更近', () => {
            const halfSpread = 20;
            const skew = 5;
            const normalizedInventory = 0.5;
            
            const result = MidLowFreqGLFTStrategy.calculateQuoteDepths(halfSpread, skew, normalizedInventory);
            
            expect(result.bidDepth).toBeGreaterThan(result.askDepth);
            expect(result.bidDepth).toBe(halfSpread + skew * normalizedInventory);
            expect(result.askDepth).toBe(halfSpread - skew * normalizedInventory);
        });

        it('负库存时卖单应该更远，买单应该更近', () => {
            const halfSpread = 20;
            const skew = 5;
            const normalizedInventory = -0.5;
            
            const result = MidLowFreqGLFTStrategy.calculateQuoteDepths(halfSpread, skew, normalizedInventory);
            
            expect(result.askDepth).toBeGreaterThan(result.bidDepth);
            expect(result.bidDepth).toBe(halfSpread + skew * normalizedInventory);
            expect(result.askDepth).toBe(halfSpread - skew * normalizedInventory);
        });

        it('应该确保深度不为负数', () => {
            const halfSpread = 5;
            const skew = 10;
            const extremeInventory = 1; // 可能导致负深度的极端库存
            
            const result = MidLowFreqGLFTStrategy.calculateQuoteDepths(halfSpread, skew, extremeInventory);
            
            expect(result.bidDepth).toBeGreaterThanOrEqual(0);
            expect(result.askDepth).toBeGreaterThanOrEqual(0);
        });
    });

    describe('传统GLFT模型 - calculateTraditionalGLFTQuotes', () => {
        const testInputs = {
            midPrice: 50000,
            volatility: 0.02,
            gamma: 0.1,
            orderFlowA: 140,
            orderFlowK: 1.5,
            normalizedInventory: 0
        };

        it('应该返回完整的报价结果', () => {
            const result = MidLowFreqGLFTStrategy.calculateTraditionalGLFTQuotes(testInputs);
            
            expect(result).toHaveProperty('bidPrice');
            expect(result).toHaveProperty('askPrice');
            expect(result).toHaveProperty('halfSpread');
            expect(result).toHaveProperty('skew');
            
            expect(result.bidPrice).toBeLessThan(testInputs.midPrice);
            expect(result.askPrice).toBeGreaterThan(testInputs.midPrice);
            expect(result.halfSpread).toBeGreaterThan(0);
            expect(result.skew).toBeGreaterThan(0);
        });

        it('零库存时买卖报价应该对称', () => {
            const inputs = { ...testInputs, normalizedInventory: 0 };
            const result = MidLowFreqGLFTStrategy.calculateTraditionalGLFTQuotes(inputs);
            
            const bidDistance = testInputs.midPrice - result.bidPrice;
            const askDistance = result.askPrice - testInputs.midPrice;
            
            expect(Math.abs(bidDistance - askDistance)).toBeLessThan(0.001); // 允许微小的浮点误差
        });

        it('正库存时应该促进卖出（买单更远，卖单更近）', () => {
            const zeroInventoryInputs = { ...testInputs, normalizedInventory: 0 };
            const positiveInventoryInputs = { ...testInputs, normalizedInventory: 0.5 };
            
            const zeroResult = MidLowFreqGLFTStrategy.calculateTraditionalGLFTQuotes(zeroInventoryInputs);
            const positiveResult = MidLowFreqGLFTStrategy.calculateTraditionalGLFTQuotes(positiveInventoryInputs);
            
            // 正库存时，买单应该更远，卖单应该更近
            expect(positiveResult.bidPrice).toBeLessThan(zeroResult.bidPrice);
            expect(positiveResult.askPrice).toBeLessThan(zeroResult.askPrice);
        });

        it('负库存时应该促进买入（卖单更远，买单更近）', () => {
            const zeroInventoryInputs = { ...testInputs, normalizedInventory: 0 };
            const negativeInventoryInputs = { ...testInputs, normalizedInventory: -0.5 };
            
            const zeroResult = MidLowFreqGLFTStrategy.calculateTraditionalGLFTQuotes(zeroInventoryInputs);
            const negativeResult = MidLowFreqGLFTStrategy.calculateTraditionalGLFTQuotes(negativeInventoryInputs);
            
            // 负库存时，卖单应该更远，买单应该更近
            expect(negativeResult.bidPrice).toBeGreaterThan(zeroResult.bidPrice);
            expect(negativeResult.askPrice).toBeGreaterThan(zeroResult.askPrice);
        });

        it('波动率增加时半价差和偏度都应该增加', () => {
            const lowVolInputs = { ...testInputs, volatility: 0.01 };
            const highVolInputs = { ...testInputs, volatility: 0.03 };
            
            const lowVolResult = MidLowFreqGLFTStrategy.calculateTraditionalGLFTQuotes(lowVolInputs);
            const highVolResult = MidLowFreqGLFTStrategy.calculateTraditionalGLFTQuotes(highVolInputs);
            
            expect(highVolResult.halfSpread).toBeGreaterThan(lowVolResult.halfSpread);
            expect(highVolResult.skew).toBeGreaterThan(lowVolResult.skew);
        });

        it('应该处理极端参数值而不抛出错误', () => {
            const extremeInputs = {
                midPrice: 1,
                volatility: 0.001,
                gamma: 0.001,
                orderFlowA: 1,
                orderFlowK: 0.1,
                normalizedInventory: 0
            };
            
            expect(() => {
                MidLowFreqGLFTStrategy.calculateTraditionalGLFTQuotes(extremeInputs);
            }).not.toThrow();
        });
    });

    // ==================== 通用功能模块测试 ====================

    describe('checkInventoryLimits', () => {
        test('正常库存范围内', () => {
            const result = MidLowFreqGLFTStrategy.checkInventoryLimits(0.5, 1.0);
            expect(result.canBid).toBe(true);
            expect(result.canAsk).toBe(true);
            expect(result.inventoryLimited).toBe(false);
        });

        test('达到最大多头库存限制', () => {
            const result = MidLowFreqGLFTStrategy.checkInventoryLimits(1.0, 1.0);
            expect(result.canBid).toBe(false); // 不能再买入
            expect(result.canAsk).toBe(true);  // 可以卖出
            expect(result.inventoryLimited).toBe(true);
        });

        test('达到最大空头库存限制', () => {
            const result = MidLowFreqGLFTStrategy.checkInventoryLimits(-1.0, 1.0);
            expect(result.canBid).toBe(true);  // 可以买入
            expect(result.canAsk).toBe(false); // 不能再卖出
            expect(result.inventoryLimited).toBe(true);
        });

        test('超出库存限制', () => {
            const result = MidLowFreqGLFTStrategy.checkInventoryLimits(1.2, 1.0);
            expect(result.canBid).toBe(false);
            expect(result.canAsk).toBe(true);
            expect(result.inventoryLimited).toBe(true);
        });

        test('零库存', () => {
            const result = MidLowFreqGLFTStrategy.checkInventoryLimits(0, 1.0);
            expect(result.canBid).toBe(true);
            expect(result.canAsk).toBe(true);
            expect(result.inventoryLimited).toBe(false);
        });
    });

    describe('selectStrategy', () => {
        test('选择传统GLFT模式', () => {
            const result = MidLowFreqGLFTStrategy.selectStrategy(true);
            expect(result.strategyMode).toBe('traditional_glft');
            expect(result.description).toContain('传统GLFT模型');
        });

        test('选择固定价差模式', () => {
            const result = MidLowFreqGLFTStrategy.selectStrategy(false);
            expect(result.strategyMode).toBe('fixed_spread');
            expect(result.description).toContain('固定价差模式');
        });
    });

    describe('calculateOptimalQuotes', () => {
        const baseInputs = {
            midPrice: 100,
            volatility: 0.02,
            normalizedInventory: 0.3,
            maxInventoryQ: 1.0
        };

        test('固定价差模式 - 正常库存', () => {
            const inputs = {
                ...baseInputs,
                useTraditionalGLFT: false,
                halfSpreadPct: 0.1,
                riskAversion: 0.01
            };

            const result = MidLowFreqGLFTStrategy.calculateOptimalQuotes(inputs);
            
            // 验证基本结构和逻辑
            expect(result.bidPrice).toBeLessThan(100);
            expect(result.askPrice).toBeGreaterThan(100);
            expect(result.halfSpread).toBeCloseTo(0.1, 3);
            expect(result.inventoryLimited).toBe(false);
            expect(result.strategyMode).toBe('fixed_spread');
            
            // 验证价差计算
            const spread = result.askPrice - result.bidPrice;
            expect(spread).toBeGreaterThan(0.15); // 考虑库存偏度，价差应该大于2*halfSpread
        });

        test('传统GLFT模式 - 正常库存', () => {
            const inputs = {
                ...baseInputs,
                useTraditionalGLFT: true,
                gamma: 0.1,
                orderFlowA: 140,
                orderFlowK: 1.5
            };

            const result = MidLowFreqGLFTStrategy.calculateOptimalQuotes(inputs);
            
            expect(result.bidPrice).toBeLessThan(100);
            expect(result.askPrice).toBeGreaterThan(100);
            expect(result.halfSpread).toBeGreaterThan(0);
            expect(result.inventoryLimited).toBe(false);
            expect(result.strategyMode).toBe('traditional_glft');
        });

        test('库存限制 - 最大多头库存', () => {
            const inputs = {
                ...baseInputs,
                normalizedInventory: 1.0, // 达到最大库存
                useTraditionalGLFT: false,
                halfSpreadPct: 0.1,
                riskAversion: 0.01
            };

            const result = MidLowFreqGLFTStrategy.calculateOptimalQuotes(inputs);
            
            expect(result.bidPrice).toBeNull(); // 禁用买单
            expect(result.askPrice).not.toBeNull(); // 保留卖单
            expect(result.inventoryLimited).toBe(true);
        });

        test('库存限制 - 最大空头库存', () => {
            const inputs = {
                ...baseInputs,
                normalizedInventory: -1.0, // 达到最大空头库存
                useTraditionalGLFT: false,
                halfSpreadPct: 0.1,
                riskAversion: 0.01
            };

            const result = MidLowFreqGLFTStrategy.calculateOptimalQuotes(inputs);
            
            expect(result.bidPrice).not.toBeNull(); // 保留买单
            expect(result.askPrice).toBeNull(); // 禁用卖单
            expect(result.inventoryLimited).toBe(true);
        });

        test('传统GLFT模式 - 零库存', () => {
            const inputs = {
                ...baseInputs,
                normalizedInventory: 0,
                useTraditionalGLFT: true,
                gamma: 0.1,
                orderFlowA: 140,
                orderFlowK: 1.5
            };

            const result = MidLowFreqGLFTStrategy.calculateOptimalQuotes(inputs);
            
            // 验证基本结构
            expect(result.bidPrice).toBeLessThan(100);
            expect(result.askPrice).toBeGreaterThan(100);
            expect(result.skew).toBeCloseTo(0, 3); // 零库存时偏度应该接近0
            expect(result.inventoryLimited).toBe(false);
            
            // 验证价格相对于中价的对称性
            const bidOffset = 100 - result.bidPrice;
            const askOffset = result.askPrice - 100;
            expect(Math.abs(bidOffset - askOffset)).toBeLessThan(0.1); // 偏移量应该相近
        });

        test('边界条件 - 极小波动率', () => {
            const inputs = {
                ...baseInputs,
                volatility: 0.001,
                useTraditionalGLFT: false,
                halfSpreadPct: 0.1,
                riskAversion: 0.01
            };

            const result = MidLowFreqGLFTStrategy.calculateOptimalQuotes(inputs);
            
            expect(result.bidPrice).toBeLessThan(100);
            expect(result.askPrice).toBeGreaterThan(100);
            expect(result.halfSpread).toBeCloseTo(0.1, 3);
        });
    });
});