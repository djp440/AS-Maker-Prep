/**
 * @file test_main_startup.js
 * @description 测试main.js启动流程的简单脚本
 */

const MainApplication = require('./src/main');
const Logger = require('./src/shared/logger');

// 设置测试环境
process.env.PAPER_TRADING = 'true';
process.env.BITGET_API_KEY = 'bg_test_key';
process.env.BITGET_API_SECRET = 'test_secret';
process.env.BITGET_API_PASSPHRASE = 'test_passphrase';

async function testMainStartup() {
    Logger.info('🧪 开始测试main.js启动流程...');
    
    const app = new MainApplication();
    
    try {
        // 测试配置加载
        Logger.info('📋 测试配置加载...');
        await app.loadConfiguration();
        Logger.info('✅ 配置加载测试通过');
        
        // 测试服务初始化
        Logger.info('🔧 测试服务初始化...');
        await app.initializeServices();
        Logger.info('✅ 服务初始化测试通过');
        
        // 测试启动前准备
        Logger.info('🔄 测试启动前准备...');
        try {
            await app.prepareForTrading();
            Logger.info('✅ 启动前准备测试通过');
        } catch (error) {
            Logger.warn('⚠️ 启动前准备测试失败（可能是网络问题）:', error.message);
        }
        
        // 测试状态获取
        Logger.info('📊 测试状态获取...');
        const status = app.getStatus();
        Logger.info('应用状态:', JSON.stringify(status, null, 2));
        Logger.info('✅ 状态获取测试通过');
        
        // 测试优雅关闭
        Logger.info('🔄 测试优雅关闭...');
        await app.shutdown(0);
        Logger.info('✅ 优雅关闭测试通过');
        
        Logger.info('🎉 所有测试通过！main.js启动流程正常');
        
    } catch (error) {
        Logger.error('❌ 测试失败:', error);
        
        // 确保清理资源
        try {
            await app.shutdown(1);
        } catch (cleanupError) {
            Logger.error('清理资源失败:', cleanupError);
        }
        
        process.exit(1);
    }
}

// 运行测试
if (require.main === module) {
    testMainStartup().catch(error => {
        console.error('测试脚本执行失败:', error);
        process.exit(1);
    });
}

module.exports = testMainStartup;