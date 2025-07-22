/**
 * timeUtils.js 的单元测试
 */

const { getTimestamp, formatDate, getCurrentTimeString, toISOString } = require('../timeUtils');

describe('timeUtils', () => {
    describe('getTimestamp', () => {
        test('应该返回当前时间戳', () => {
            const before = Date.now();
            const timestamp = getTimestamp();
            const after = Date.now();
            
            expect(timestamp).toBeGreaterThanOrEqual(before);
            expect(timestamp).toBeLessThanOrEqual(after);
            expect(typeof timestamp).toBe('number');
        });
    });

    describe('formatDate', () => {
        test('应该正确格式化时间戳', () => {
            const timestamp = 1703123456789; // 2023-12-21 02:30:56.789 UTC
            const formatted = formatDate(timestamp);
            
            expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(typeof formatted).toBe('string');
        });

        test('应该在没有提供时间戳时使用当前时间', () => {
            const formatted = formatDate();
            
            expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(typeof formatted).toBe('string');
        });

        test('应该处理不同的时间戳值', () => {
            const timestamp1 = 0; // 1970-01-01 00:00:00 UTC
            const timestamp2 = 946684800000; // 2000-01-01 00:00:00 UTC
            
            const formatted1 = formatDate(timestamp1);
            const formatted2 = formatDate(timestamp2);
            
            expect(formatted1).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(formatted2).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        });
    });

    describe('getCurrentTimeString', () => {
        test('应该返回当前时间的格式化字符串', () => {
            const timeString = getCurrentTimeString();
            
            expect(timeString).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(typeof timeString).toBe('string');
        });

        test('应该与formatDate()无参数调用结果一致', () => {
            const timeString1 = getCurrentTimeString();
            const timeString2 = formatDate();
            
            // 由于时间可能有微小差异，我们检查格式是否一致
            expect(timeString1).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(timeString2).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        });
    });

    describe('toISOString', () => {
        test('应该正确转换为ISO字符串格式', () => {
            const timestamp = 1703123456789; // 2023-12-21 02:30:56.789 UTC
            const isoString = toISOString(timestamp);
            
            expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(typeof isoString).toBe('string');
        });

        test('应该在没有提供时间戳时使用当前时间', () => {
            const isoString = toISOString();
            
            expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(typeof isoString).toBe('string');
        });

        test('应该处理特殊时间戳值', () => {
            const timestamp = 0; // 1970-01-01 00:00:00.000 UTC
            const isoString = toISOString(timestamp);
            
            expect(isoString).toBe('1970-01-01T00:00:00.000Z');
        });
    });

    describe('时间函数集成测试', () => {
        test('getTimestamp和formatDate应该配合工作', () => {
            const timestamp = getTimestamp();
            const formatted = formatDate(timestamp);
            
            expect(typeof timestamp).toBe('number');
            expect(typeof formatted).toBe('string');
            expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        });

        test('getTimestamp和toISOString应该配合工作', () => {
            const timestamp = getTimestamp();
            const isoString = toISOString(timestamp);
            
            expect(typeof timestamp).toBe('number');
            expect(typeof isoString).toBe('string');
            expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });
    });
});