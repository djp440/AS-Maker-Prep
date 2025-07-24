/**
 * @file 中低频GLFT策略模块
 * @author yourname
 */

/**
 * MidLowFreqGLFTStrategy 是一个无状态的策略模块，用于计算报价、判断是否更新等。
 */
class MidLowFreqGLFTStrategy {
    /**
     * 计算库存偏度，这会影响报价的对称性。
     * @param {number} volatility - 波动率。
     * @param {number} riskAversion - 风险厌恶系数。
     * @returns {number} 库存偏度系数。
     */
    static calculateInventorySkew(volatility, riskAversion) {
        return volatility * riskAversion;
    }

    /**
     * 使用固定的价差和库存偏度计算买卖报价。
     * @param {object} inputs - 计算报价所需的输入。
     * @param {number} inputs.midPrice - 中间价。
     * @param {number} inputs.halfSpreadPct - 基础半价差百分比。
     * @param {number} inputs.volatility - 波动率。
     * @param {number} inputs.riskAversion - 风险厌恶系数。
     * @param {number} inputs.inventory - 当前库存量 (q)。
     * @returns {{bidPrice: number, askPrice: number}} 计算出的买卖报价。
     */
    static calculateFixedSpreadQuotes(inputs) {
        const { midPrice, halfSpreadPct, volatility, riskAversion, inventory } = inputs;

        const halfSpread = midPrice * halfSpreadPct;
        const skew = this.calculateInventorySkew(volatility, riskAversion);

        const bidDepth = halfSpread + skew * inventory;
        const askDepth = halfSpread - skew * inventory;

        const bidPrice = midPrice - bidDepth;
        const askPrice = midPrice + askDepth;

        return { bidPrice, askPrice };
    }

    /**
     * 判断是否需要更新报价。
     * @param {number} currentPrice - 当前价格。
     * @param {number} lastPrice - 上次更新时的价格。
     * @param {number} threshold - 更新阈值。
     * @returns {boolean} 如果价格变化超过阈值，则返回 true。
     */
    static shouldUpdateQuotes(currentPrice, lastPrice, threshold) {
        return Math.abs(currentPrice - lastPrice) / lastPrice > threshold;
    }

    /**
     * 动态计算重新平衡的频率。
     * @param {number} volatility - 波动率。
     * @param {number} baseInterval - 基础时间间隔。
     * @returns {number} 调整后的重新平衡时间间隔。
     */
    static calculateRebalanceInterval(volatility, baseInterval) {
        // 这是一个示例实现，波动率越高，重新平衡越频繁
        if (volatility > 0.05) { // 高波动率
            return baseInterval / 2;
        }
        return baseInterval;
    }
}

module.exports = MidLowFreqGLFTStrategy;