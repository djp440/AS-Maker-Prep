/**
 * precisionUtils.js 的单元测试
 */

const { adjustPrice, adjustQuantity, checkMinNotional } = require('../precisionUtils');

describe('precisionUtils', () => {
    describe('adjustPrice', () => {
        test('应该正确调整价格到最接近的tickSize倍数', () => {
            expect(adjustPrice(1.2345, 0.01)).toBe(1.23);
            expect(adjustPrice(1.2365, 0.01)).toBe(1.24);
            expect(adjustPrice(1.235, 0.01)).toBe(1.24);
            expect(adjustPrice(100.567, 0.1)).toBe(100.6);
            expect(adjustPrice(100.549, 0.1)).toBe(100.5);
        });

        test('应该处理不同的tickSize值', () => {
            expect(adjustPrice(1.2345, 0.001)).toBe(1.235);
            expect(adjustPrice(1.2345, 0.1)).toBe(1.2);
            expect(adjustPrice(1.2345, 1)).toBe(1);
        });

        test('应该在无效输入时抛出错误', () => {
            expect(() => adjustPrice(0, 0.01)).toThrow('价格和tickSize必须为正数');
            expect(() => adjustPrice(1.23, 0)).toThrow('价格和tickSize必须为正数');
            expect(() => adjustPrice(1.23, -0.01)).toThrow('价格和tickSize必须为正数');
            expect(() => adjustPrice(null, 0.01)).toThrow('价格和tickSize必须为正数');
            expect(() => adjustPrice(1.23, null)).toThrow('价格和tickSize必须为正数');
        });
    });

    describe('adjustQuantity', () => {
        test('应该正确向下调整数量到stepSize倍数', () => {
            expect(adjustQuantity(1.2345, 0.01, 0.1)).toBe(1.23);
            expect(adjustQuantity(1.2365, 0.01, 0.1)).toBe(1.23);
            expect(adjustQuantity(0.567, 0.1, 0.1)).toBe(0.5);
        });

        test('应该确保数量不小于minQty', () => {
            expect(adjustQuantity(0.05, 0.01, 0.1)).toBe(0.1);
            expect(adjustQuantity(0.001, 0.01, 0.1)).toBe(0.1);
            expect(adjustQuantity(0.15, 0.01, 0.1)).toBe(0.15);
        });

        test('应该处理minQty为0或undefined的情况', () => {
            expect(adjustQuantity(1.2345, 0.01, 0)).toBe(1.23);
            expect(adjustQuantity(1.2345, 0.01)).toBe(1.23);
        });

        test('应该在无效输入时抛出错误', () => {
            expect(() => adjustQuantity(0, 0.01, 0.1)).toThrow('数量和stepSize必须为正数');
            expect(() => adjustQuantity(1.23, 0, 0.1)).toThrow('数量和stepSize必须为正数');
            expect(() => adjustQuantity(1.23, -0.01, 0.1)).toThrow('数量和stepSize必须为正数');
            expect(() => adjustQuantity(1.23, 0.01, -0.1)).toThrow('最小数量不能为负数');
        });
    });

    describe('checkMinNotional', () => {
        test('应该正确检查最小名义价值', () => {
            expect(checkMinNotional(100, 0.1, 5)).toBe(true);  // 100 * 0.1 = 10 >= 5
            expect(checkMinNotional(100, 0.01, 5)).toBe(false); // 100 * 0.01 = 1 < 5
            expect(checkMinNotional(50, 0.2, 5)).toBe(true);   // 50 * 0.2 = 10 >= 5
            expect(checkMinNotional(10, 0.4, 5)).toBe(false);  // 10 * 0.4 = 4 < 5
        });

        test('应该在没有minNotional要求时返回true', () => {
            expect(checkMinNotional(100, 0.01, 0)).toBe(true);
            expect(checkMinNotional(100, 0.01, null)).toBe(true);
            expect(checkMinNotional(100, 0.01)).toBe(true);
        });

        test('应该在无效输入时抛出错误', () => {
            expect(() => checkMinNotional(0, 0.1, 5)).toThrow('价格和数量必须为正数');
            expect(() => checkMinNotional(100, 0, 5)).toThrow('价格和数量必须为正数');
            expect(() => checkMinNotional(-100, 0.1, 5)).toThrow('价格和数量必须为正数');
            expect(() => checkMinNotional(100, -0.1, 5)).toThrow('价格和数量必须为正数');
        });
    });
});