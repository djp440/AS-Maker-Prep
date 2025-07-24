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
});