/**
 * 共享工具模块
 * 整合所有工具函数，提供统一的导出接口
 */

const precisionUtils = require('./precisionUtils');
const timeUtils = require('./timeUtils');
const asyncUtils = require('./asyncUtils');

// 导出所有工具模块
module.exports = {
    // 精度处理工具
    precision: precisionUtils,
    
    // 时间处理工具
    time: timeUtils,
    
    // 异步处理工具
    async: asyncUtils,
    
    // 为了向后兼容，也可以直接导出常用函数
    adjustPrice: precisionUtils.adjustPrice,
    adjustQuantity: precisionUtils.adjustQuantity,
    checkMinNotional: precisionUtils.checkMinNotional,
    getTimestamp: timeUtils.getTimestamp,
    formatDate: timeUtils.formatDate,
    sleep: asyncUtils.sleep
};

/**
 * 使用示例：
 * 
 * // 方式1：通过分类使用
 * const utils = require('./shared/utils');
 * const adjustedPrice = utils.precision.adjustPrice(1.2345, 0.01);
 * const timestamp = utils.time.getTimestamp();
 * await utils.async.sleep(1000);
 * 
 * // 方式2：直接使用常用函数
 * const { adjustPrice, getTimestamp, sleep } = require('./shared/utils');
 * const adjustedPrice = adjustPrice(1.2345, 0.01);
 * const timestamp = getTimestamp();
 * await sleep(1000);
 * 
 * // 方式3：解构特定模块
 * const { precision, time, async: asyncUtils } = require('./shared/utils');
 * const adjustedPrice = precision.adjustPrice(1.2345, 0.01);
 * const timestamp = time.getTimestamp();
 * await asyncUtils.sleep(1000);
 */