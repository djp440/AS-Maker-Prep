const NetworkRecoveryManager = require('./network_recovery_manager');
const { EventEmitter } = require('events');
const Logger = require('../shared/logger');

/**
 * @class NetworkRecoveryTest
 * @description 网络恢复管理器测试类
 */
class NetworkRecoveryTest {
    constructor() {
        this.testResults = [];
        this.mockServices = this.createMockServices();
    }

    /**
     * @description 创建模拟服务
     * @returns {Object}
     */
    createMockServices() {
        const mockWebSocketManager = new EventEmitter();
        mockWebSocketManager.isConnected = () => this.mockConnectionState;
        mockWebSocketManager.reconnect = async () => {
            if (this.shouldReconnectFail) {
                throw new Error('Reconnection failed');
            }
            this.mockConnectionState = true;
            mockWebSocketManager.emit('open');
        };
        
        const mockExchangeService = new EventEmitter();
        mockExchangeService.testConnection = async () => {
            if (this.shouldApiTestFail) {
                throw new Error('API test failed');
            }
            return true;
        };
        
        const mockTrader = {
            pauseTrading: async (reason) => {
                this.tradingPaused = true;
                this.pauseReason = reason;
            },
            resumeTrading: async (reason) => {
                this.tradingPaused = false;
                this.resumeReason = reason;
            },
            emergencyStop: async (reason) => {
                this.emergencyStop = true;
                this.emergencyReason = reason;
            },
            setTradingMode: async (mode) => {
                this.tradingMode = mode;
            }
        };
        
        const mockConnectionMonitor = new EventEmitter();
        mockConnectionMonitor.getConnectionMetrics = () => ({
            apiErrorCount: this.mockApiErrorCount || 0,
            reconnectCount: this.mockReconnectCount || 0,
            dataLatency: this.mockDataLatency || 1000,
            lastMessageTime: this.mockLastMessageTime || Date.now()
        });
        
        mockConnectionMonitor.getHealthStatus = () => ({
            isHealthy: this.mockIsHealthy !== false
        });
        
        return {
            websocketManager: mockWebSocketManager,
            exchangeService: mockExchangeService,
            trader: mockTrader,
            connectionMonitor: mockConnectionMonitor
        };
    }

    /**
     * @description 重置模拟状态
     */
    resetMockState() {
        this.mockConnectionState = true;
        this.shouldReconnectFail = false;
        this.shouldApiTestFail = false;
        this.tradingPaused = false;
        this.emergencyStop = false;
        this.tradingMode = 'normal';
        this.mockApiErrorCount = 0;
        this.mockReconnectCount = 0;
        this.mockDataLatency = 1000;
        this.mockLastMessageTime = Date.now();
        this.mockIsHealthy = true;
    }

    /**
     * @description 运行单个测试
     * @param {string} testName - 测试名称
     * @param {Function} testFunction - 测试函数
     */
    async runTest(testName, testFunction) {
        let manager = null;
        try {
            console.log(`\n🧪 运行测试: ${testName}`);
            
            // 重置状态
            this.resetMockState();
            
            // 创建新的管理器实例
            const NetworkRecoveryManagerClass = require('./network_recovery_manager').constructor;
            manager = new NetworkRecoveryManagerClass();
            await manager.initialize(this.mockServices, {
                baseDelay: 100, // 加快测试速度
                maxDelay: 1000,
                healthCheckInterval: 10000, // 增加间隔避免干扰
                degradationThreshold: 2,
                dataStaleThreshold: 300000 // 增加阈值避免误报
            });
            
            // 运行测试
            await testFunction(manager);
            
            console.log(`✅ 测试通过: ${testName}`);
            this.testResults.push({ name: testName, status: 'PASS', error: null });
            
        } catch (error) {
            console.log(`❌ 测试失败: ${testName}`);
            console.log(`   错误: ${error.message}`);
            this.testResults.push({ name: testName, status: 'FAIL', error: error.message });
        } finally {
            // 确保清理
            if (manager) {
                manager.stop();
                manager.destroy();
            }
        }
    }

    /**
     * @description 测试指数退避重连机制
     */
    async testExponentialBackoffReconnection(manager) {
        return new Promise((resolve, reject) => {
            let retryCount = 0;
            const retryDelays = [];
            
            // 监听恢复事件
            manager.on('recovery_started', () => {
                console.log('   恢复流程已启动');
            });
            
            // 模拟连接失败几次后成功
            const originalAttemptRecovery = manager.attemptRecovery.bind(manager);
            manager.attemptRecovery = async (source) => {
                retryCount++;
                const delay = manager.recoveryState.nextRetryDelay;
                retryDelays.push(delay);
                
                console.log(`   第${retryCount}次重连尝试，延迟: ${delay}ms`);
                
                if (retryCount < 3) {
                    throw new Error('Connection failed');
                }
                
                // 第3次成功
                this.mockConnectionState = true;
                return true;
            };
            
            manager.on('recovery_success', () => {
                try {
                    // 验证指数退避
                    if (retryDelays.length >= 2) {
                        const ratio = retryDelays[1] / retryDelays[0];
                        if (ratio < 1.5 || ratio > 3) {
                            throw new Error(`指数退避比例不正确: ${ratio}`);
                        }
                    }
                    
                    console.log(`   重连成功，总尝试次数: ${retryCount}`);
                    console.log(`   退避延迟序列: ${retryDelays.join(', ')}ms`);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
            
            // 触发连接错误
            this.mockConnectionState = false;
            manager.handleConnectionError('websocket', new Error('Connection lost'));
            
            // 超时保护
            setTimeout(() => {
                reject(new Error('测试超时'));
            }, 10000);
        });
    }

    /**
     * @description 测试降级模式
     */
    async testDegradationMode(manager) {
        return new Promise((resolve, reject) => {
            let degradationEntered = false;
            let degradationExited = false;
            
            manager.on('degradation_mode_entered', () => {
                degradationEntered = true;
                console.log('   已进入降级模式');
                
                // 验证交易是否暂停
                if (!this.tradingPaused) {
                    reject(new Error('降级模式下交易未暂停'));
                    return;
                }
                
                console.log(`   交易暂停原因: ${this.pauseReason}`);
                
                // 等待一段时间后模拟恢复
                setTimeout(async () => {
                    try {
                        // 设置降级时间已过
                        manager.recoveryState.degradationStartTime = Date.now() - 700000; // 超过10分钟
                        
                        await manager.handleConnectionRecovered('websocket');
                        await manager.handleConnectionRecovered('api');
                    } catch (error) {
                        reject(error);
                    }
                }, 500);
            });
            
            manager.on('degradation_mode_exited', () => {
                degradationExited = true;
                console.log('   已退出降级模式');
                
                // 验证交易是否恢复
                if (this.tradingPaused) {
                    reject(new Error('退出降级模式后交易未恢复'));
                    return;
                }
                
                console.log(`   交易恢复原因: ${this.resumeReason}`);
                resolve();
            });
            
            // 停止自动检查避免干扰
            manager.stop();
            
            // 模拟连续失败触发降级 - 确保达到阈值
            setTimeout(async () => {
                try {
                    // 根据配置的阈值进行足够次数的失败
                    const threshold = manager.recoveryConfig.degradationThreshold;
                    console.log(`   降级阈值: ${threshold}`);
                    
                    for (let i = 0; i < threshold; i++) {
                        await manager.handleConnectionError('websocket', new Error(`Error ${i + 1}`));
                        console.log(`   第${i + 1}次失败后，连续失败次数: ${manager.recoveryState.consecutiveFailures}`);
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    
                } catch (error) {
                    reject(error);
                }
            }, 100);
            
            // 检查是否进入降级模式
             setTimeout(() => {
                 if (!degradationEntered) {
                     reject(new Error(`连续失败${manager.recoveryState.consecutiveFailures}次后未进入降级模式，阈值为${manager.recoveryConfig.degradationThreshold}`));
                 }
             }, 1000);
             
             // 超时保护
            setTimeout(() => {
                if (!degradationEntered) {
                    reject(new Error('测试超时 - 未进入降级模式'));
                } else if (!degradationExited) {
                    reject(new Error('测试超时 - 未退出降级模式'));
                } else {
                    reject(new Error('测试超时'));
                }
            }, 8000);
        });
    }

    /**
     * @description 测试风险控制机制
     */
    async testRiskControlMechanism(manager) {
        return new Promise((resolve, reject) => {
            let riskLevelChanged = false;
            let criticalRiskDetected = false;
            
            manager.on('risk_level_changed', async (data) => {
                riskLevelChanged = true;
                console.log(`   风险级别变更: ${data.oldLevel} -> ${data.newLevel}`);
                
                if (data.newLevel === 'critical' || data.newLevel === 'high') {
                    criticalRiskDetected = true;
                    
                    // 等待一小段时间让交易暂停逻辑执行
                    setTimeout(() => {
                        // 验证交易是否暂停
                        if (!this.tradingPaused) {
                            reject(new Error(`${data.newLevel}风险下交易未暂停`));
                            return;
                        }
                        console.log(`   ${data.newLevel}风险下交易已暂停`);
                        resolve();
                    }, 100);
                }
            });
            
            // 停止自动检查避免干扰
            manager.stop();
            
            // 模拟高风险场景
            setTimeout(async () => {
                try {
                    // 设置高错误计数
                    this.mockApiErrorCount = 15;
                    this.mockReconnectCount = 8;
                    this.mockDataLatency = 8000;
                    
                    // 模拟连续失败
                    manager.recoveryState.consecutiveFailures = 12;
                    
                    // 触发风险评估
                    await manager.assessRiskLevel();
                    
                    // 检查是否触发了风险级别变更
                    setTimeout(() => {
                        if (!riskLevelChanged) {
                            reject(new Error('高风险场景下风险级别未变更'));
                        } else if (!criticalRiskDetected) {
                            reject(new Error('未检测到高风险或关键风险级别'));
                        }
                    }, 200);
                    
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
     * @description 测试紧急模式
     */
    async testEmergencyMode(manager) {
        return new Promise((resolve, reject) => {
            manager.on('emergency_mode_entered', (data) => {
                console.log(`   进入紧急模式: ${data.reason}`);
                
                // 验证紧急停止是否执行
                if (!this.emergencyStop) {
                    reject(new Error('紧急模式下未执行紧急停止'));
                    return;
                }
                
                console.log(`   紧急停止原因: ${this.emergencyReason}`);
                resolve();
            });
            
            // 停止自动检查避免干扰
            manager.stop();
            
            // 模拟恢复失败触发紧急模式
            setTimeout(async () => {
                try {
                    // 设置恢复失败
                    manager.recoveryState.retryCount = manager.recoveryConfig.maxRetries;
                    
                    // 触发紧急模式
                    await manager.enterEmergencyMode();
                    
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
     * @description 测试健康检查
     */
    async testHealthCheck(manager) {
        return new Promise((resolve, reject) => {
            let healthCheckTriggered = false;
            
            manager.on('recovery_started', (data) => {
                if (data.source === 'health_check') {
                    healthCheckTriggered = true;
                    console.log('   健康检查触发了恢复流程');
                    resolve();
                }
            });
            
            // 停止自动健康检查避免干扰
            manager.stop();
            
            // 模拟不健康状态
            setTimeout(() => {
                this.mockConnectionState = false;
                this.mockLastMessageTime = Date.now() - 400000; // 数据过期
                
                // 手动触发健康检查
                manager.performHealthCheck();
                
                setTimeout(() => {
                    if (!healthCheckTriggered) {
                        reject(new Error('健康检查未触发恢复流程'));
                    }
                }, 1000);
            }, 100);
            
            // 超时保护
            setTimeout(() => {
                reject(new Error('测试超时'));
            }, 3000);
        });
    }

    /**
     * @description 测试手动恢复触发
     */
    async testManualRecoveryTrigger(manager) {
        return new Promise((resolve, reject) => {
            manager.on('recovery_started', (data) => {
                if (data.source === 'manual') {
                    console.log('   手动恢复已触发');
                    resolve();
                }
            });
            
            // 停止自动检查避免干扰
            manager.stop();
            
            // 触发手动恢复
            setTimeout(async () => {
                try {
                    const result = await manager.triggerManualRecovery();
                    if (!result) {
                        reject(new Error('手动恢复触发失败'));
                    }
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
     * @description 运行所有测试
     */
    async runAllTests() {
        console.log('🚀 开始网络恢复管理器测试\n');
        
        const tests = [
            ['指数退避重连机制测试', this.testExponentialBackoffReconnection],
            ['降级模式测试', this.testDegradationMode],
            ['风险控制机制测试', this.testRiskControlMechanism],
            ['紧急模式测试', this.testEmergencyMode],
            ['健康检查测试', this.testHealthCheck],
            ['手动恢复触发测试', this.testManualRecoveryTrigger]
        ];
        
        for (const [testName, testFunction] of tests) {
            await this.runTest(testName, testFunction.bind(this));
        }
        
        this.printTestResults();
    }

    /**
     * @description 打印测试结果
     */
    printTestResults() {
        console.log('\n📊 测试结果汇总:');
        console.log('=' .repeat(50));
        
        const passed = this.testResults.filter(r => r.status === 'PASS').length;
        const failed = this.testResults.filter(r => r.status === 'FAIL').length;
        const total = this.testResults.length;
        
        this.testResults.forEach(result => {
            const status = result.status === 'PASS' ? '✅' : '❌';
            console.log(`${status} ${result.name}`);
            if (result.error) {
                console.log(`   错误: ${result.error}`);
            }
        });
        
        console.log('=' .repeat(50));
        console.log(`总计: ${total} | 通过: ${passed} | 失败: ${failed}`);
        console.log(`成功率: ${((passed / total) * 100).toFixed(2)}%`);
        
        if (failed === 0) {
            console.log('\n🎉 所有测试通过！网络恢复管理器功能正常。');
        } else {
            console.log(`\n⚠️  有 ${failed} 个测试失败，请检查相关功能。`);
        }
    }
}

// 运行测试
if (require.main === module) {
    const test = new NetworkRecoveryTest();
    test.runAllTests().catch(error => {
        console.error('测试运行失败:', error);
        process.exit(1);
    });
}

module.exports = NetworkRecoveryTest;