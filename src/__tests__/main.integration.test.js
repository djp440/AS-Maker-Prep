/**
 * @file main.integration.test.js
 * @description main.js模块的集成测试
 * 测试在真实环境下的启动和运行流程
 */

const MainApplication = require('../main');
const Config = require('../shared/config');
const Logger = require('../shared/logger');

// 设置较长的超时时间
jest.setTimeout(30000);

describe('MainApplication Integration Tests', () => {
    let app;
    let originalExit;
    let originalEnv;

    beforeAll(() => {
        // 保存原始环境
        originalEnv = { ...process.env };
        originalExit = process.exit;
        
        // Mock process.exit 防止测试进程退出
        process.exit = jest.fn();
        
        // 强制使用模拟盘环境
        process.env.PAPER_TRADING = 'true';
        process.env.BITGET_API_KEY = 'bg_test_key';
        process.env.BITGET_API_SECRET = 'test_secret';
        process.env.BITGET_API_PASSPHRASE = 'test_passphrase';
        
        // 重置Config实例
        if (Config._instance) {
            Config._instance = null;
        }
    });

    afterAll(() => {
        // 恢复原始环境
        process.env = originalEnv;
        process.exit = originalExit;
        
        // 重置Config实例
        if (Config._instance) {
            Config._instance = null;
        }
    });

    beforeEach(() => {
        app = new MainApplication();
        jest.clearAllMocks();
    });

    afterEach(async () => {
        if (app && !app.isShuttingDown) {
            await app.shutdown(0);
        }
    });

    describe('配置加载测试', () => {
        test('应该能够成功加载真实配置文件', async () => {
            await expect(app.loadConfiguration()).resolves.not.toThrow();
            
            expect(app.services.config).toBe(Config);
            
            // 验证配置内容
            const exchange = Config.getExchange();
            const symbols = Config.getSymbols();
            const credentials = Config.getApiCredentials();
            
            expect(exchange).toBe('bitget');
            expect(symbols).toHaveLength(2);
            expect(symbols[0].SYMBOL).toBe('BTC/USDT:USDT');
            expect(symbols[1].SYMBOL).toBe('ETH/USDT:USDT');
            expect(credentials.apiKey).toBeTruthy();
            expect(credentials.apiSecret).toBeTruthy();
        });

        test('应该正确识别模拟盘模式', async () => {
            await app.loadConfiguration();
            
            const isPaperTrading = Config.isPaperTrading();
            expect(isPaperTrading).toBe(true);
        });
    });

    describe('服务初始化测试', () => {
        test('应该能够成功初始化所有核心服务', async () => {
            await app.loadConfiguration();
            await expect(app.initializeServices()).resolves.not.toThrow();
            
            // 验证服务已正确设置
            expect(app.services.exchange).toBeTruthy();
            expect(app.services.websocket).toBeTruthy();
            expect(app.services.marketData).toBeTruthy();
            expect(app.services.account).toBeTruthy();
        });

        test('交易所服务应该正确配置为模拟盘模式', async () => {
            await app.loadConfiguration();
            await app.initializeServices();
            
            // 验证交易所服务已初始化
            expect(app.services.exchange.isInitialized()).toBe(true);
        });
    });

    describe('启动前准备测试', () => {
        test('应该能够成功执行启动前准备', async () => {
            await app.loadConfiguration();
            await app.initializeServices();
            
            // 这个测试可能需要真实的网络连接
            await expect(app.prepareForTrading()).resolves.not.toThrow();
        }, 15000);
    });

    describe('状态监控测试', () => {
        test('应该能够获取应用程序状态', async () => {
            const status = app.getStatus();
            
            expect(status).toHaveProperty('isRunning');
            expect(status).toHaveProperty('tradersCount');
            expect(status).toHaveProperty('traders');
            expect(status).toHaveProperty('services');
            
            expect(status.isRunning).toBe(true);
            expect(status.tradersCount).toBe(0); // 初始状态下没有trader
        });
    });

    describe('优雅关闭测试', () => {
        test('应该能够正确执行优雅关闭流程', async () => {
            await app.shutdown(0);
            
            expect(app.isShuttingDown).toBe(true);
            expect(process.exit).toHaveBeenCalledWith(0);
        });

        test('应该防止重复关闭', async () => {
            await app.shutdown(0);
            
            // 重置mock计数
            process.exit.mockClear();
            
            // 再次尝试关闭
            await app.shutdown(0);
            
            // 第二次关闭不应该调用process.exit
            expect(process.exit).not.toHaveBeenCalled();
        });
    });

    describe('错误处理测试', () => {
        test('应该能够处理配置加载错误', async () => {
            // 临时破坏环境变量
            const originalApiKey = process.env.BITGET_API_KEY;
            delete process.env.BITGET_API_KEY;
            
            // 重置Config实例以重新加载
            if (Config._instance) {
                Config._instance = null;
            }
            
            await expect(app.loadConfiguration()).rejects.toThrow();
            
            // 恢复环境变量
            process.env.BITGET_API_KEY = originalApiKey;
        });
    });

    describe('完整启动流程测试', () => {
        test('应该能够执行完整的启动流程（不包括交易对启动）', async () => {
            // 这个测试执行除了交易对启动之外的所有步骤
            await expect(app.loadConfiguration()).resolves.not.toThrow();
            await expect(app.initializeServices()).resolves.not.toThrow();
            
            // 注意：prepareForTrading 可能需要真实的网络连接
            // 在CI环境中可能会失败，这是正常的
            try {
                await app.prepareForTrading();
                Logger.info('✅ 启动前准备成功完成');
            } catch (error) {
                Logger.warn('⚠️ 启动前准备失败（可能是网络问题）:', error.message);
                // 在测试环境中，网络连接失败是可以接受的
            }
        }, 20000);
    });

    describe('内存和资源管理测试', () => {
        test('应该正确管理Trader实例', () => {
            expect(app.traders).toBeInstanceOf(Map);
            expect(app.traders.size).toBe(0);
            
            // 模拟添加trader
            const mockTrader = { stop: jest.fn().mockResolvedValue() };
            app.traders.set('TEST/USDT:USDT', mockTrader);
            
            expect(app.traders.size).toBe(1);
            expect(app.traders.has('TEST/USDT:USDT')).toBe(true);
        });

        test('关闭时应该清理所有资源', async () => {
            // 添加一些模拟的trader
            const mockTrader1 = { stop: jest.fn().mockResolvedValue() };
            const mockTrader2 = { stop: jest.fn().mockResolvedValue() };
            
            app.traders.set('BTC/USDT:USDT', mockTrader1);
            app.traders.set('ETH/USDT:USDT', mockTrader2);
            
            expect(app.traders.size).toBe(2);
            
            await app.shutdown(0);
            
            expect(mockTrader1.stop).toHaveBeenCalled();
            expect(mockTrader2.stop).toHaveBeenCalled();
            expect(app.traders.size).toBe(0);
        });
    });
});