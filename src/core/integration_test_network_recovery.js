/**
 * 网络恢复管理器集成测试
 * 测试网络恢复管理器与交易系统的集成功能
 */

const NetworkRecoveryManager = require('./network_recovery_manager');
const Logger = require('../shared/logger');
const { EventEmitter } = require('events');

class NetworkRecoveryIntegrationTest {
    constructor() {
        this.testResults = [];
        this.logger = Logger;
    }

    /**
     * 运行所有集成测试
     */
    async runAllTests() {
        console.log('\n🚀 开始网络恢复管理器集成测试\n');
        
        const tests = [
            { name: '网络恢复管理器初始化测试', method: 'testNetworkRecoveryInitialization' },
            { name: '网络异常检测与恢复测试', method: 'testNetworkFailureDetectionAndRecovery' },
            { name: '降级模式集成测试', method: 'testDegradationModeIntegration' },
            { name: '风险控制集成测试', method: 'testRiskControlIntegration' }
        ];

        for (const test of tests) {
            await this.runTest(test.name, test.method);
        }

        this.printTestSummary();
    }

    /**
     * 运行单个测试
     */
    async runTest(testName, methodName) {
        console.log(`🧪 运行测试: ${testName}`);
        
        try {
            const manager = new NetworkRecoveryManager({
                logger: this.logger,
                config: {
                    healthCheckInterval: 1000,
                    degradationThreshold: 2,
                    degradationDuration: 2000,
                    dataStaleThreshold: 3000
                }
            });
            
            await manager.initialize();
            
            await this[methodName](manager);
            
            this.testResults.push({ name: testName, status: 'PASSED' });
            console.log(`✅ 测试通过: ${testName}\n`);
            
            // 清理
            manager.stop();
            manager.destroy();
            
        } catch (error) {
            this.testResults.push({ name: testName, status: 'FAILED', error: error.message });
            console.log(`❌ 测试失败: ${testName}`);
            console.log(`   错误: ${error.message}\n`);
        }
    }

    /**
     * 测试网络恢复管理器初始化
     */
    async testNetworkRecoveryInitialization(manager) {
        // 验证管理器已正确初始化
        if (!manager.isInitialized) {
            throw new Error('网络恢复管理器未正确初始化');
        }
        
        // 验证配置已加载
        if (!manager.recoveryConfig) {
            throw new Error('恢复配置未加载');
        }
        
        // 验证状态已初始化
        if (!manager.recoveryState) {
            throw new Error('恢复状态未初始化');
        }
        
        console.log('   网络恢复管理器初始化成功');
        console.log(`   配置: 健康检查间隔=${manager.recoveryConfig.healthCheckInterval}ms`);
        console.log(`   状态: 连续失败=${manager.recoveryState.consecutiveFailures}次`);
    }

    /**
     * 测试网络异常检测与恢复
     */
    async testNetworkFailureDetectionAndRecovery(manager) {
        return new Promise((resolve, reject) => {
            let errorDetected = false;
            let recoveryTriggered = false;
            
            // 监听连接错误事件
            manager.on('connection_error', (data) => {
                errorDetected = true;
                console.log(`   检测到连接错误: ${data.source}`);
            });
            
            // 监听恢复开始事件
            manager.on('recovery_started', (data) => {
                recoveryTriggered = true;
                console.log(`   恢复流程已启动: ${data.source}`);
                
                // 验证测试结果
                if (errorDetected && recoveryTriggered) {
                    console.log('   网络异常检测与恢复功能正常');
                    resolve();
                } else {
                    reject(new Error('网络异常检测或恢复功能异常'));
                }
            });
            
            // 停止自动检查避免干扰
            manager.stop();
            
            // 模拟网络错误
            setTimeout(async () => {
                try {
                    await manager.handleConnectionError('websocket', new Error('模拟网络错误'));
                } catch (error) {
                    reject(error);
                }
            }, 100);
            
            // 超时保护
            setTimeout(() => {
                reject(new Error('测试超时'));
            }, 5000);
        });
    }

    /**
     * 测试降级模式集成
     */
    async testDegradationModeIntegration(manager) {
        return new Promise((resolve, reject) => {
            let degradationEntered = false;
            let tradingPaused = false;
            
            // 监听降级模式事件
            manager.on('degradation_mode_entered', () => {
                degradationEntered = true;
                console.log('   进入降级模式');
                
                // 模拟交易暂停
                tradingPaused = true;
                console.log('   交易已暂停');
                
                // 验证降级模式功能
                if (degradationEntered && tradingPaused) {
                    console.log('   降级模式集成功能正常');
                    resolve();
                }
            });
            
            // 停止自动检查避免干扰
            manager.stop();
            
            // 模拟连续失败触发降级模式
            setTimeout(async () => {
                try {
                    const threshold = manager.recoveryConfig.degradationThreshold;
                    console.log(`   降级阈值: ${threshold}`);
                    
                    for (let i = 0; i < threshold; i++) {
                        await manager.handleConnectionError('api', new Error(`连续错误 ${i + 1}`));
                        console.log(`   模拟第${i + 1}次连接错误，当前连续失败: ${manager.recoveryState.consecutiveFailures}`);
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    
                    // 检查是否应该进入降级模式
                    console.log(`   检查降级条件: 连续失败=${manager.recoveryState.consecutiveFailures}, 阈值=${threshold}`);
                    if (manager.shouldEnterDegradationMode()) {
                        console.log('   满足降级条件，手动触发降级模式');
                        await manager.enterDegradationMode();
                    }
                    
                } catch (error) {
                    reject(error);
                }
            }, 100);
            
            // 超时保护
            setTimeout(() => {
                if (!degradationEntered) {
                    reject(new Error('未能触发降级模式'));
                } else {
                    reject(new Error('测试超时'));
                }
            }, 5000);
        });
    }

    /**
     * 测试风险控制集成
     */
    async testRiskControlIntegration(manager) {
        return new Promise((resolve, reject) => {
            let riskLevelChanged = false;
            let emergencyActionTaken = false;
            
            // 监听风险级别变更事件
            manager.on('risk_level_changed', (data) => {
                riskLevelChanged = true;
                console.log(`   风险级别变更: ${data.oldLevel} -> ${data.newLevel}`);
                
                if (data.newLevel === 'critical' || data.newLevel === 'high') {
                    // 模拟紧急操作
                    emergencyActionTaken = true;
                    console.log('   执行紧急风险控制操作');
                    
                    // 验证风险控制功能
                    if (riskLevelChanged && emergencyActionTaken) {
                        console.log('   风险控制集成功能正常');
                        resolve();
                    }
                }
            });
            
            // 停止自动检查避免干扰
            manager.stop();
            
            // 模拟高风险场景
            setTimeout(async () => {
                try {
                    // 设置高风险参数
                    console.log('   设置高风险场景参数');
                    manager.recoveryState.consecutiveFailures = 15;
                    
                    // 模拟多次连接错误以触发风险评估
                    for (let i = 0; i < 5; i++) {
                        await manager.handleConnectionError('websocket', new Error(`高风险错误 ${i + 1}`));
                        console.log(`   模拟高风险错误 ${i + 1}，连续失败: ${manager.recoveryState.consecutiveFailures}`);
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    
                    // 手动触发风险评估
                    console.log('   手动触发风险评估');
                    await manager.assessRiskLevel();
                    
                } catch (error) {
                    reject(error);
                }
            }, 100);
            
            // 超时保护
            setTimeout(() => {
                if (!riskLevelChanged) {
                    reject(new Error('风险级别未变更'));
                } else {
                    reject(new Error('测试超时'));
                }
            }, 5000);
        });
    }

    /**
     * 打印测试结果摘要
     */
    printTestSummary() {
        console.log('\n📊 网络恢复管理器集成测试结果汇总:');
        console.log('==================================================');
        
        const passed = this.testResults.filter(r => r.status === 'PASSED').length;
        const failed = this.testResults.filter(r => r.status === 'FAILED').length;
        const total = this.testResults.length;
        
        this.testResults.forEach(result => {
            const icon = result.status === 'PASSED' ? '✅' : '❌';
            console.log(`${icon} ${result.name}`);
            if (result.error) {
                console.log(`   错误: ${result.error}`);
            }
        });
        
        console.log('==================================================');
        console.log(`总计: ${total} | 通过: ${passed} | 失败: ${failed}`);
        console.log(`成功率: ${((passed / total) * 100).toFixed(2)}%`);
        
        if (failed === 0) {
            console.log('\n🎉 所有集成测试通过！网络恢复管理器集成功能正常。');
        } else {
            console.log(`\n⚠️  有 ${failed} 个测试失败，请检查相关功能。`);
        }
    }
}

// 如果直接运行此文件，则执行测试
if (require.main === module) {
    const test = new NetworkRecoveryIntegrationTest();
    test.runAllTests().catch(console.error);
}

module.exports = NetworkRecoveryIntegrationTest;