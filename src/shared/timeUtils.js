/**
 * 时间处理工具模块
 * 提供时间戳获取和格式化功能
 */

const dayjs = require('dayjs');

/**
 * 获取当前的Unix时间戳（毫秒）
 * @returns {number} 当前时间戳（毫秒）
 * @example
 * getTimestamp() // 返回 1703123456789
 */
function getTimestamp() {
    return Date.now();
}

/**
 * 将时间戳格式化为YYYY-MM-DD HH:mm:ss格式
 * @param {number} timestamp - Unix时间戳（毫秒），如果不提供则使用当前时间
 * @returns {string} 格式化后的时间字符串
 * @example
 * formatDate(1703123456789) // 返回 "2023-12-21 10:30:56"
 * formatDate() // 返回当前时间的格式化字符串
 */
function formatDate(timestamp) {
    const time = timestamp ? dayjs(timestamp) : dayjs();
    return time.format('YYYY-MM-DD HH:mm:ss');
}

/**
 * 获取格式化的当前时间字符串
 * @returns {string} 当前时间的格式化字符串
 * @example
 * getCurrentTimeString() // 返回 "2023-12-21 10:30:56"
 */
function getCurrentTimeString() {
    return formatDate();
}

/**
 * 将时间戳转换为ISO字符串格式
 * @param {number} timestamp - Unix时间戳（毫秒），如果不提供则使用当前时间
 * @returns {string} ISO格式的时间字符串
 * @example
 * toISOString(1703123456789) // 返回 "2023-12-21T02:30:56.789Z"
 */
function toISOString(timestamp) {
    const time = timestamp !== undefined ? dayjs(timestamp) : dayjs();
    return time.toISOString();
}

module.exports = {
    getTimestamp,
    formatDate,
    getCurrentTimeString,
    toISOString
};