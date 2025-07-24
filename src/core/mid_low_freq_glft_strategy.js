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

    // ==================== 传统GLFT模型（备用）====================

    /**
     * 计算传统GLFT模型的常数C1和C2。
     * 这些常数由风险厌恶系数和订单流强度参数决定。
     * @param {number} gamma - 风险厌恶系数。
     * @param {number} orderFlowA - 订单流强度基准参数A。
     * @param {number} orderFlowK - 订单流强度衰减参数k。
     * @returns {{C1: number, C2: number}} 计算出的常数C1和C2。
     */
    static calculateConstants(gamma, orderFlowA, orderFlowK) {
        // 根据GLFT模型理论，计算常数C1和C2
        // C1主要影响基础价差，C2主要影响波动率敏感性
        
        // 计算中间变量
        const gammaOverK = gamma / orderFlowK;
        const logTerm = Math.log(1 + gammaOverK);
        
        // C1: 基础价差常数（不依赖波动率的部分）
        const C1 = (2 / gamma) * logTerm;
        
        // C2: 波动率敏感常数
        // 这个公式基于GLFT模型的渐近解
        const eta = orderFlowA * Math.exp(-orderFlowK * logTerm / gamma);
        const C2 = 1 / (2 * eta);
        
        return { C1, C2 };
    }

    /**
     * 计算传统GLFT模型的半价差。
     * @param {number} C1 - 基础价差常数。
     * @param {number} C2 - 波动率敏感常数。
     * @param {number} volatility - 波动率。
     * @returns {number} 计算出的半价差。
     */
    static calculateHalfSpread(C1, C2, volatility) {
        // 传统GLFT模型的半价差公式：half_spread = C1 + C2 * σ²
        return C1 + C2 * volatility * volatility;
    }

    /**
     * 计算传统GLFT模型的库存偏度。
     * @param {number} C2 - 波动率敏感常数。
     * @param {number} volatility - 波动率。
     * @returns {number} 计算出的库存偏度系数。
     */
    static calculateSkew(C2, volatility) {
        // 传统GLFT模型的偏度公式：skew = C2 * σ
        return C2 * volatility;
    }

    /**
     * 计算传统GLFT模型的报价深度。
     * @param {number} halfSpread - 半价差。
     * @param {number} skew - 库存偏度系数。
     * @param {number} normalizedInventory - 标准化库存（-1到1之间）。
     * @returns {{bidDepth: number, askDepth: number}} 买卖报价深度。
     */
    static calculateQuoteDepths(halfSpread, skew, normalizedInventory) {
        // 根据库存调整报价深度
        // 正库存时：买单更远（bidDepth增大），卖单更近（askDepth减小）
        // 负库存时：卖单更远（askDepth增大），买单更近（bidDepth减小）
        
        const bidDepth = halfSpread + skew * normalizedInventory;
        const askDepth = halfSpread - skew * normalizedInventory;
        
        // 确保深度不为负数
        return {
            bidDepth: Math.max(0, bidDepth),
            askDepth: Math.max(0, askDepth)
        };
    }

    /**
     * 传统GLFT模型的主入口函数。
     * @param {object} inputs - 计算所需的输入参数。
     * @param {number} inputs.midPrice - 中间价。
     * @param {number} inputs.volatility - 波动率。
     * @param {number} inputs.gamma - 风险厌恶系数。
     * @param {number} inputs.orderFlowA - 订单流强度基准参数A。
     * @param {number} inputs.orderFlowK - 订单流强度衰减参数k。
     * @param {number} inputs.normalizedInventory - 标准化库存（-1到1之间）。
     * @returns {{bidPrice: number, askPrice: number, halfSpread: number, skew: number}} 传统GLFT模型的报价结果。
     */
    static calculateTraditionalGLFTQuotes(inputs) {
        const { midPrice, volatility, gamma, orderFlowA, orderFlowK, normalizedInventory } = inputs;
        
        // 步骤1: 计算常数C1和C2
        const { C1, C2 } = this.calculateConstants(gamma, orderFlowA, orderFlowK);
        
        // 步骤2: 计算半价差
        const halfSpread = this.calculateHalfSpread(C1, C2, volatility);
        
        // 步骤3: 计算库存偏度
        const skew = this.calculateSkew(C2, volatility);
        
        // 步骤4: 计算报价深度
        const { bidDepth, askDepth } = this.calculateQuoteDepths(halfSpread, skew, normalizedInventory);
        
        // 步骤5: 计算最终报价
        const bidPrice = midPrice - bidDepth;
        const askPrice = midPrice + askDepth;
        
        return {
            bidPrice,
            askPrice,
            halfSpread,
            skew
        };
    }
}

module.exports = MidLowFreqGLFTStrategy;