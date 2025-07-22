/**
 * 精度处理工具模块
 * 提供交易所订单价格和数量的精度调整功能
 */

/**
 * 将价格调整到最接近的有效tickSize倍数
 * @param {number} price - 原始价格
 * @param {number} tickSize - 价格精度步长
 * @returns {number} 调整后的价格
 * @example
 * adjustPrice(1.2345, 0.01) // 返回 1.23
 * adjustPrice(1.2365, 0.01) // 返回 1.24
 */
function adjustPrice(price, tickSize) {
    if (!price || !tickSize || tickSize <= 0) {
        throw new Error('价格和tickSize必须为正数');
    }
    const result = Math.round(price / tickSize) * tickSize;
    // 处理浮点数精度问题
    const decimals = (tickSize.toString().split('.')[1] || '').length;
    return Number(result.toFixed(decimals));
}

/**
 * 将数量向下调整到最接近的有效stepSize倍数，并确保不小于minQty
 * @param {number} quantity - 原始数量
 * @param {number} stepSize - 数量精度步长
 * @param {number} minQty - 最小数量要求
 * @returns {number} 调整后的数量
 * @example
 * adjustQuantity(1.2345, 0.01, 0.1) // 返回 1.23
 * adjustQuantity(0.05, 0.01, 0.1) // 返回 0.1
 */
function adjustQuantity(quantity, stepSize, minQty) {
    if (!quantity || !stepSize || stepSize <= 0) {
        throw new Error('数量和stepSize必须为正数');
    }
    if (minQty < 0) {
        throw new Error('最小数量不能为负数');
    }
    
    const adjustedQty = Math.floor(quantity / stepSize) * stepSize;
    const result = Math.max(adjustedQty, minQty || 0);
    // 处理浮点数精度问题
    const decimals = (stepSize.toString().split('.')[1] || '').length;
    return Number(result.toFixed(decimals));
}

/**
 * 检查订单价值（价格 × 数量）是否满足最小名义价值要求
 * @param {number} price - 订单价格
 * @param {number} quantity - 订单数量
 * @param {number} minNotional - 最小名义价值要求
 * @returns {boolean} 是否满足最小名义价值要求
 * @example
 * checkMinNotional(100, 0.1, 5) // 返回 true (100 * 0.1 = 10 >= 5)
 * checkMinNotional(100, 0.01, 5) // 返回 false (100 * 0.01 = 1 < 5)
 */
function checkMinNotional(price, quantity, minNotional) {
    if (!price || !quantity || price <= 0 || quantity <= 0) {
        throw new Error('价格和数量必须为正数');
    }
    if (!minNotional || minNotional < 0) {
        return true; // 如果没有最小名义价值要求，则总是满足
    }
    
    return (price * quantity) >= minNotional;
}

module.exports = {
    adjustPrice,
    adjustQuantity,
    checkMinNotional
};