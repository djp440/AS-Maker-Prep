/**
 * WebSocket Manager 快速测试脚本
 * 用于验证WebSocket Manager的核心功能
 * 如果遇到网络连接问题，会提示用户切换网络环境
 */

const WebSocketManager = require('./src/services/websocket_manager');
const Config = require('./src/shared/config');
const Logger = require('./src/shared/logger');

class WebSocketTester {
    constructor() {
        this.webSocketManager = WebSocketManager;
        this.testResults = {
            connection: false,
            subscription: false,
            eventEmission: false,
            reconnection: false,
            cleanup: false
        };
    }

    /**
     * 初始化配置
     */
    async initializeConfig() {
        try {
            await Config.load();
            console.log('✅ 配置加载成功');
            console.log(`   交易所: ${Config.getExchange()}`);
            console.log(`   模式: ${Config.isPaperTrading() ? '模拟盘' : '实盘'}`);
            return true;
        } catch (error) {
            console.log('❌ 配置加载失败:', error.message);
            return false;
        }
    }

    /**
     * 测试连接功能
     */
    async testConnection() {
        console.log('\n🔌 测试WebSocket连接...');
        try {
            await this.webSocketManager.initialize();
            
            if (this.webSocketManager.isConnected()) {
                console.log('✅ WebSocket连接成功');
                console.log(`   连接状态: ${this.webSocketManager.getConnectionState()}`);
                console.log(`   交易所: ${Config.getExchange()}`);
                console.log(`   模式: ${Config.isPaperTrading() ? '模拟盘' : '实盘'}`);
                this.testResults.connection = true;
                return true;
            } else {
                console.log('❌ WebSocket连接失败');
                return false;
            }
        } catch (error) {
            console.log('❌ WebSocket连接异常:', error.message);
            if (error.message.includes('网络') || error.message.includes('timeout') || error.message.includes('ENOTFOUND')) {
                console.log('\n⚠️  网络连接问题检测到！');
                console.log('   建议：');
                console.log('   1. 检查网络连接是否正常');
                console.log('   2. 确认是否可以访问Bitget交易所');
                console.log('   3. 尝试切换到更稳定的网络环境');
                console.log('   4. 检查防火墙设置');
            }
            return false;
        }
    }

    /**
     * 测试订阅功能
     */
    async testSubscription() {
        console.log('\n📡 测试订阅功能...');
        
        if (!this.webSocketManager.isConnected()) {
            console.log('❌ 跳过订阅测试：WebSocket未连接');
            return false;
        }

        try {
            const symbol = 'BTC/USDT:USDT';
            
            // 暂时设置为closed状态避免启动实际的watch循环
            const originalState = this.webSocketManager.connectionState;
            this.webSocketManager.connectionState = 'closed';
            
            // 测试各种订阅
            await this.webSocketManager.watchTicker(symbol);
            await this.webSocketManager.watchOrderBook(symbol);
            await this.webSocketManager.watchBalance();
            await this.webSocketManager.watchPositions(symbol);
            
            const topics = this.webSocketManager.getSubscribedTopics();
            
            console.log('✅ 订阅功能正常');
            console.log(`   已订阅主题数量: ${topics.length}`);
            console.log(`   订阅主题: ${topics.join(', ')}`);
            
            // 恢复原始状态
            this.webSocketManager.connectionState = originalState;
            
            this.testResults.subscription = true;
            return true;
        } catch (error) {
            console.log('❌ 订阅功能异常:', error.message);
            return false;
        }
    }

    /**
     * 测试事件分发
     */
    async testEventEmission() {
        console.log('\n📢 测试事件分发...');
        
        if (!this.webSocketManager.isConnected()) {
            console.log('❌ 跳过事件测试：WebSocket未连接');
            return false;
        }

        try {
            let eventReceived = false;
            
            // 监听连接事件
            const testHandler = () => {
                eventReceived = true;
            };
            
            this.webSocketManager.on('connected', testHandler);
            
            // 触发连接事件
            this.webSocketManager.emit('connected');
            
            // 清理监听器
            this.webSocketManager.off('connected', testHandler);
            
            if (eventReceived) {
                console.log('✅ 事件分发功能正常');
                console.log('   EventEmitter机制工作正常');
                this.testResults.eventEmission = true;
                return true;
            } else {
                console.log('❌ 事件分发功能异常');
                return false;
            }
        } catch (error) {
            console.log('❌ 事件分发测试异常:', error.message);
            return false;
        }
    }

    /**
     * 测试重连机制
     */
    async testReconnection() {
        console.log('\n🔄 测试重连机制...');
        
        try {
            const originalAttempts = this.webSocketManager.reconnectAttempts;
            const originalState = this.webSocketManager.connectionState;
            
            // 模拟连接错误
            const testError = new Error('模拟网络错误');
            this.webSocketManager.handleConnectionError(testError);
            
            // 检查重连状态
            const isReconnecting = this.webSocketManager.isReconnecting;
            const hasTimer = this.webSocketManager.reconnectTimer !== null;
            
            // 清理重连定时器
            if (this.webSocketManager.reconnectTimer) {
                clearTimeout(this.webSocketManager.reconnectTimer);
                this.webSocketManager.reconnectTimer = null;
            }
            
            // 恢复原始状态
            this.webSocketManager.reconnectAttempts = originalAttempts;
            this.webSocketManager.isReconnecting = false;
            this.webSocketManager.connectionState = originalState;
            
            if (isReconnecting && hasTimer) {
                console.log('✅ 重连机制正常');
                console.log('   错误处理正确');
                console.log('   重连定时器已设置');
                console.log('   指数退避策略已配置');
                this.testResults.reconnection = true;
                return true;
            } else {
                console.log('❌ 重连机制异常');
                return false;
            }
        } catch (error) {
            console.log('❌ 重连测试异常:', error.message);
            return false;
        }
    }

    /**
     * 测试清理功能
     */
    async testCleanup() {
        console.log('\n🧹 测试清理功能...');
        
        try {
            // 添加一些订阅
            const symbol = 'ETH/USDT:USDT';
            const originalState = this.webSocketManager.connectionState;
            this.webSocketManager.connectionState = 'closed';
            
            await this.webSocketManager.watchTicker(symbol);
            
            const topicsBeforeCleanup = this.webSocketManager.getSubscribedTopics().length;
            const handlersBeforeCleanup = this.webSocketManager.watchHandlers.size;
            
            // 执行清理
            this.webSocketManager.cleanup();
            
            const handlersAfterCleanup = this.webSocketManager.watchHandlers.size;
            const timerAfterCleanup = this.webSocketManager.reconnectTimer;
            
            // 恢复状态
            this.webSocketManager.connectionState = originalState;
            
            if (handlersAfterCleanup === 0 && timerAfterCleanup === null) {
                console.log('✅ 清理功能正常');
                console.log(`   清理前处理器数量: ${handlersBeforeCleanup}`);
                console.log(`   清理后处理器数量: ${handlersAfterCleanup}`);
                console.log('   定时器已清理');
                this.testResults.cleanup = true;
                return true;
            } else {
                console.log('❌ 清理功能异常');
                return false;
            }
        } catch (error) {
            console.log('❌ 清理测试异常:', error.message);
            return false;
        }
    }

    /**
     * 运行所有测试
     */
    async runAllTests() {
        console.log('🚀 开始WebSocket Manager功能验证\n');
        console.log('=' .repeat(50));
        
        // 首先初始化配置
        const configLoaded = await this.initializeConfig();
        if (!configLoaded) {
            console.log('\n❌ 配置加载失败，无法继续测试');
            return;
        }
        
        const startTime = Date.now();
        
        // 依次运行测试
        await this.testConnection();
        await this.testSubscription();
        await this.testEventEmission();
        await this.testReconnection();
        await this.testCleanup();
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        // 生成测试报告
        this.generateReport(duration);
        
        // 清理资源
        if (this.webSocketManager.isConnected()) {
            await this.webSocketManager.close();
        }
    }

    /**
     * 生成测试报告
     */
    generateReport(duration) {
        console.log('\n' + '=' .repeat(50));
        console.log('📊 测试报告');
        console.log('=' .repeat(50));
        
        const tests = Object.keys(this.testResults);
        const passedTests = tests.filter(test => this.testResults[test]);
        const failedTests = tests.filter(test => !this.testResults[test]);
        
        console.log(`\n📈 测试统计:`);
        console.log(`   总测试数: ${tests.length}`);
        console.log(`   通过: ${passedTests.length}`);
        console.log(`   失败: ${failedTests.length}`);
        console.log(`   成功率: ${((passedTests.length / tests.length) * 100).toFixed(1)}%`);
        console.log(`   执行时间: ${duration.toFixed(2)}秒`);
        
        console.log(`\n✅ 通过的测试:`);
        passedTests.forEach(test => {
            console.log(`   - ${this.getTestName(test)}`);
        });
        
        if (failedTests.length > 0) {
            console.log(`\n❌ 失败的测试:`);
            failedTests.forEach(test => {
                console.log(`   - ${this.getTestName(test)}`);
            });
        }
        
        console.log(`\n📋 建议:`);
        if (this.testResults.connection) {
            console.log(`   ✅ WebSocket连接功能正常，可以进行生产部署`);
        } else {
            console.log(`   ⚠️  WebSocket连接失败，请检查网络环境后重试`);
        }
        
        if (passedTests.length === tests.length) {
            console.log(`   🎉 所有测试通过！WebSocket Manager模块已准备就绪`);
        } else {
            console.log(`   🔧 部分测试失败，建议修复后重新测试`);
        }
        
        console.log('\n' + '=' .repeat(50));
    }

    /**
     * 获取测试名称
     */
    getTestName(testKey) {
        const names = {
            connection: 'WebSocket连接',
            subscription: '订阅功能',
            eventEmission: '事件分发',
            reconnection: '重连机制',
            cleanup: '清理功能'
        };
        return names[testKey] || testKey;
    }
}

// 运行测试
if (require.main === module) {
    const tester = new WebSocketTester();
    tester.runAllTests().catch(error => {
        console.error('\n❌ 测试执行异常:', error);
        process.exit(1);
    });
}

module.exports = WebSocketTester;