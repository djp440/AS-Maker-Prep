/**
 * 异步处理工具模块
 * 提供异步操作的辅助函数
 */

/**
 * 异步等待指定的毫秒数
 * @param {number} ms - 等待的毫秒数
 * @returns {Promise<void>} Promise对象
 * @example
 * await sleep(1000); // 等待1秒
 * await sleep(500);  // 等待0.5秒
 */
function sleep(ms) {
    if (typeof ms !== 'number' || ms < 0) {
        throw new Error('等待时间必须为非负数');
    }
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带有超时的Promise包装器
 * @param {Promise} promise - 要包装的Promise
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @param {string} errorMessage - 超时错误信息
 * @returns {Promise} 带超时的Promise
 * @example
 * const result = await withTimeout(fetch('/api/data'), 5000, '请求超时');
 */
function withTimeout(promise, timeoutMs, errorMessage = '操作超时') {
    if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
        throw new Error('超时时间必须为正数');
    }
    
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
        })
    ]);
}

/**
 * 重试执行异步函数
 * @param {Function} fn - 要重试的异步函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delayMs - 重试间隔（毫秒）
 * @param {Function} shouldRetry - 判断是否应该重试的函数，接收错误对象作为参数
 * @returns {Promise} 执行结果
 * @example
 * const result = await retry(
 *   () => fetch('/api/data'),
 *   3,
 *   1000,
 *   (error) => error.code === 'NETWORK_ERROR'
 * );
 */
async function retry(fn, maxRetries = 3, delayMs = 1000, shouldRetry = () => true) {
    if (typeof fn !== 'function') {
        throw new Error('第一个参数必须是函数');
    }
    if (typeof maxRetries !== 'number' || maxRetries < 0) {
        throw new Error('最大重试次数必须为非负数');
    }
    if (typeof delayMs !== 'number' || delayMs < 0) {
        throw new Error('重试间隔必须为非负数');
    }
    
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // 如果是最后一次尝试，或者不应该重试，则抛出错误
            if (attempt === maxRetries || !shouldRetry(error)) {
                throw error;
            }
            
            // 等待指定时间后重试
            if (delayMs > 0) {
                await sleep(delayMs);
            }
        }
    }
    
    throw lastError;
}

module.exports = {
    sleep,
    withTimeout,
    retry
};