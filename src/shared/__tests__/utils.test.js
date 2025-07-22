/**
 * utils.js 的单元测试
 * 测试模块整合和导出功能
 */

const utils = require('../utils');
const precisionUtils = require('../precisionUtils');
const timeUtils = require('../timeUtils');
const asyncUtils = require('../asyncUtils');

describe('utils模块整合', () => {
    describe('模块导出结构', () => {
        test('应该正确导出所有子模块', () => {
            expect(utils.precision).toBeDefined();
            expect(utils.time).toBeDefined();
            expect(utils.async).toBeDefined();
        });

        test('应该正确导出常用函数的直接引用', () => {
            expect(utils.adjustPrice).toBeDefined();
            expect(utils.adjustQuantity).toBeDefined();
            expect(utils.checkMinNotional).toBeDefined();
            expect(utils.getTimestamp).toBeDefined();
            expect(utils.formatDate).toBeDefined();
            expect(utils.sleep).toBeDefined();
        });

        test('precision模块应该包含所有精度处理函数', () => {
            expect(utils.precision.adjustPrice).toBe(precisionUtils.adjustPrice);
            expect(utils.precision.adjustQuantity).toBe(precisionUtils.adjustQuantity);
            expect(utils.precision.checkMinNotional).toBe(precisionUtils.checkMinNotional);
        });

        test('time模块应该包含所有时间处理函数', () => {
            expect(utils.time.getTimestamp).toBe(timeUtils.getTimestamp);
            expect(utils.time.formatDate).toBe(timeUtils.formatDate);
            expect(utils.time.getCurrentTimeString).toBe(timeUtils.getCurrentTimeString);
            expect(utils.time.toISOString).toBe(timeUtils.toISOString);
        });

        test('async模块应该包含所有异步处理函数', () => {
            expect(utils.async.sleep).toBe(asyncUtils.sleep);
            expect(utils.async.withTimeout).toBe(asyncUtils.withTimeout);
            expect(utils.async.retry).toBe(asyncUtils.retry);
        });
    });

    describe('直接导出函数的功能验证', () => {
        test('adjustPrice应该正常工作', () => {
            expect(utils.adjustPrice(1.2345, 0.01)).toBe(1.23);
            expect(utils.adjustPrice).toBe(precisionUtils.adjustPrice);
        });

        test('adjustQuantity应该正常工作', () => {
            expect(utils.adjustQuantity(1.2345, 0.01, 0.1)).toBe(1.23);
            expect(utils.adjustQuantity).toBe(precisionUtils.adjustQuantity);
        });

        test('checkMinNotional应该正常工作', () => {
            expect(utils.checkMinNotional(100, 0.1, 5)).toBe(true);
            expect(utils.checkMinNotional).toBe(precisionUtils.checkMinNotional);
        });

        test('getTimestamp应该正常工作', () => {
            const timestamp = utils.getTimestamp();
            expect(typeof timestamp).toBe('number');
            expect(utils.getTimestamp).toBe(timeUtils.getTimestamp);
        });

        test('formatDate应该正常工作', () => {
            const formatted = utils.formatDate(1703123456789);
            expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(utils.formatDate).toBe(timeUtils.formatDate);
        });

        test('sleep应该正常工作', async () => {
            const start = Date.now();
            await utils.sleep(50);
            const elapsed = Date.now() - start;
            
            expect(elapsed).toBeGreaterThanOrEqual(40);
            expect(utils.sleep).toBe(asyncUtils.sleep);
        });
    });

    describe('使用方式验证', () => {
        test('方式1：通过分类使用', () => {
            const adjustedPrice = utils.precision.adjustPrice(1.2345, 0.01);
            const timestamp = utils.time.getTimestamp();
            
            expect(adjustedPrice).toBe(1.23);
            expect(typeof timestamp).toBe('number');
        });

        test('方式2：解构常用函数', () => {
            const { adjustPrice, getTimestamp, sleep } = utils;
            
            expect(adjustPrice(1.2345, 0.01)).toBe(1.23);
            expect(typeof getTimestamp()).toBe('number');
            expect(typeof sleep).toBe('function');
        });

        test('方式3：解构特定模块', () => {
            const { precision, time, async: asyncUtils } = utils;
            
            expect(precision.adjustPrice(1.2345, 0.01)).toBe(1.23);
            expect(typeof time.getTimestamp()).toBe('number');
            expect(typeof asyncUtils.sleep).toBe('function');
        });
    });

    describe('模块完整性检查', () => {
        test('所有导出的函数都应该是函数类型', () => {
            // 检查直接导出的函数
            expect(typeof utils.adjustPrice).toBe('function');
            expect(typeof utils.adjustQuantity).toBe('function');
            expect(typeof utils.checkMinNotional).toBe('function');
            expect(typeof utils.getTimestamp).toBe('function');
            expect(typeof utils.formatDate).toBe('function');
            expect(typeof utils.sleep).toBe('function');

            // 检查模块中的函数
            Object.values(utils.precision).forEach(fn => {
                expect(typeof fn).toBe('function');
            });

            Object.values(utils.time).forEach(fn => {
                expect(typeof fn).toBe('function');
            });

            Object.values(utils.async).forEach(fn => {
                expect(typeof fn).toBe('function');
            });
        });

        test('模块对象应该是对象类型', () => {
            expect(typeof utils.precision).toBe('object');
            expect(typeof utils.time).toBe('object');
            expect(typeof utils.async).toBe('object');
        });

        test('不应该有意外的属性', () => {
            const expectedKeys = [
                'precision', 'time', 'async',
                'adjustPrice', 'adjustQuantity', 'checkMinNotional',
                'getTimestamp', 'formatDate', 'sleep'
            ];
            
            const actualKeys = Object.keys(utils);
            expect(actualKeys.sort()).toEqual(expectedKeys.sort());
        });
    });
});