/**
 * asyncUtils.js 的单元测试
 */

const { sleep, withTimeout, retry } = require('../asyncUtils');

describe('asyncUtils', () => {
    describe('sleep', () => {
        test('应该等待指定的毫秒数', async () => {
            const start = Date.now();
            await sleep(100);
            const end = Date.now();
            const elapsed = end - start;
            
            // 允许一定的时间误差（±50ms）
            expect(elapsed).toBeGreaterThanOrEqual(90);
            expect(elapsed).toBeLessThan(200);
        });

        test('应该在等待时间为0时立即返回', async () => {
            const start = Date.now();
            await sleep(0);
            const end = Date.now();
            const elapsed = end - start;
            
            expect(elapsed).toBeLessThan(50);
        });

        test('应该在无效输入时抛出错误', () => {
            expect(() => sleep(-1)).toThrow('等待时间必须为非负数');
            expect(() => sleep('invalid')).toThrow('等待时间必须为非负数');
            expect(() => sleep(null)).toThrow('等待时间必须为非负数');
        });
    });

    describe('withTimeout', () => {
        test('应该在Promise正常完成时返回结果', async () => {
            const promise = Promise.resolve('success');
            const result = await withTimeout(promise, 1000);
            
            expect(result).toBe('success');
        });

        test('应该在Promise超时时抛出错误', async () => {
            const promise = new Promise(resolve => setTimeout(() => resolve('late'), 200));
            
            await expect(withTimeout(promise, 100, '自定义超时错误'))
                .rejects.toThrow('自定义超时错误');
        });

        test('应该使用默认错误信息', async () => {
            const promise = new Promise(resolve => setTimeout(() => resolve('late'), 200));
            
            await expect(withTimeout(promise, 100))
                .rejects.toThrow('操作超时');
        });

        test('应该在Promise拒绝时传递原始错误', async () => {
            const promise = Promise.reject(new Error('原始错误'));
            
            await expect(withTimeout(promise, 1000))
                .rejects.toThrow('原始错误');
        });

        test('应该在无效超时时间时抛出错误', async () => {
            const promise = Promise.resolve('success');
            
            expect(() => withTimeout(promise, 0)).toThrow('超时时间必须为正数');
            expect(() => withTimeout(promise, -1)).toThrow('超时时间必须为正数');
            expect(() => withTimeout(promise, 'invalid')).toThrow('超时时间必须为正数');
        });
    });

    describe('retry', () => {
        test('应该在第一次尝试成功时返回结果', async () => {
            const fn = jest.fn().mockResolvedValue('success');
            const result = await retry(fn, 3, 10);
            
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        test('应该在失败后重试指定次数', async () => {
            const fn = jest.fn()
                .mockRejectedValueOnce(new Error('第一次失败'))
                .mockRejectedValueOnce(new Error('第二次失败'))
                .mockResolvedValue('第三次成功');
            
            const result = await retry(fn, 3, 10);
            
            expect(result).toBe('第三次成功');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        test('应该在达到最大重试次数后抛出最后的错误', async () => {
            const fn = jest.fn().mockRejectedValue(new Error('持续失败'));
            
            await expect(retry(fn, 2, 10))
                .rejects.toThrow('持续失败');
            
            expect(fn).toHaveBeenCalledTimes(3); // 初始尝试 + 2次重试
        });

        test('应该使用shouldRetry函数判断是否重试', async () => {
            const fn = jest.fn()
                .mockRejectedValueOnce(new Error('可重试错误'))
                .mockRejectedValueOnce(new Error('不可重试错误'));
            
            const shouldRetry = jest.fn()
                .mockReturnValueOnce(true)  // 第一次错误可重试
                .mockReturnValueOnce(false); // 第二次错误不可重试
            
            await expect(retry(fn, 3, 10, shouldRetry))
                .rejects.toThrow('不可重试错误');
            
            expect(fn).toHaveBeenCalledTimes(2);
            expect(shouldRetry).toHaveBeenCalledTimes(2);
        });

        test('应该在重试间隔为0时立即重试', async () => {
            const fn = jest.fn()
                .mockRejectedValueOnce(new Error('失败'))
                .mockResolvedValue('成功');
            
            const start = Date.now();
            const result = await retry(fn, 2, 0);
            const elapsed = Date.now() - start;
            
            expect(result).toBe('成功');
            expect(elapsed).toBeLessThan(50); // 应该很快完成
        });

        test('应该在无效参数时抛出错误', async () => {
            await expect(retry('not a function', 3, 10))
                .rejects.toThrow('第一个参数必须是函数');
            
            await expect(retry(() => {}, -1, 10))
                .rejects.toThrow('最大重试次数必须为非负数');
            
            await expect(retry(() => {}, 3, -1))
                .rejects.toThrow('重试间隔必须为非负数');
        });

        test('应该正确处理默认参数', async () => {
            const fn = jest.fn().mockResolvedValue('success');
            const result = await retry(fn);
            
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });
    });

    describe('异步工具集成测试', () => {
        test('sleep和withTimeout应该配合工作', async () => {
            const start = Date.now();
            
            await expect(withTimeout(sleep(200), 100))
                .rejects.toThrow('操作超时');
            
            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(150); // 应该在超时时间附近停止
        });

        test('retry和sleep应该配合工作', async () => {
            let attempts = 0;
            const fn = async () => {
                attempts++;
                if (attempts < 3) {
                    throw new Error('需要重试');
                }
                return 'success';
            };
            
            const start = Date.now();
            const result = await retry(fn, 3, 50);
            const elapsed = Date.now() - start;
            
            expect(result).toBe('success');
            expect(attempts).toBe(3);
            expect(elapsed).toBeGreaterThanOrEqual(90); // 至少等待了2次重试间隔
        });
    });
});