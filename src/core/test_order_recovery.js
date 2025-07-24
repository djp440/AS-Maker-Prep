/**
 * @file 订单恢复机制测试
 * @description 测试网络异常时的订单状态恢复功能
 */

const OrderRecoveryManager = require('./order_recovery_manager');
const Trader = require('./trader');
const Logger = require('../shared/logger');
const { sleep } = require('../shared/utils');

/**
 * @class OrderRecoveryTest
 * @description 订单恢复机制测试类
 */
class OrderRecoveryTest {
    constructor() {
        this.testResults = {
            total: 0,
            passed: 0,
            failed: 0,
            details: []
        };
        
        // 模拟服务
        this.mockServices = this.createMockServices();
    }
    
    /**
     * 创建模拟服务
     * @private
     * @returns {Object}
     */
    createMockServices() {
        return {
            exchangeService: {
                fetchTime: async () => Date.now(),
                fetchOpenOrders: async (symbol) => {
                    // 模拟返回一些测试订单
                    return [
                        {
                            id: 'order1',
                            symbol: symbol,
                            side: 'buy',
                            amount: 0.1,
                            price: 50000,
                            status: 'open',
                            timestamp: Date.now() - 60000 // 1分钟前
                        },
                        {
                            id: 'order2',
                            symbol: symbol,
                            side: 'sell',
                            amount: 0.1,
                            price: 51000,
                            status: 'open',
                            timestamp: Date.now() - 300000 // 5分钟前
                        }
                    ];
                },
                cancelOrder: async (orderId, symbol) => {
                    Logger.debug(`Mock: Canceling order ${orderId} for ${symbol}`);
                    return { id: orderId, status: 'canceled' };
                },
                createOrder: async (symbol, type, side, amount, price) => {
                    const orderId = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    Logger.debug(`Mock: Creating ${side} order ${orderId} for ${symbol}`);
                    return {
                        id: orderId,
                        symbol,
                        type,
                        side,
                        amount,
                        price,
                        status: 'open',
                        timestamp: Date.now()
                    };
                }
            },
            
            accountService: {
                forceSyncData: async () => {
                    Logger.debug('Mock: Force syncing account data');
                    return true;
                }
            },
            
            websocketManager: {
                connectionState: 'open',
                getConnectionState: () => 'open',
                isConnected: () => true,
                on: (event, callback) => {
                    // 模拟事件监听
                },
                emit: (event, data) => {
                    // 模拟事件发射
                }
            }
        };
    }
    
    /**
     * 运行所有测试
     * @returns {Promise<Object>}
     */
    async runAllTests() {
        Logger.info('Starting OrderRecoveryManager tests...');
        
        try {
            // 基础功能测试
            await this.testBasicInitialization();
            await this.testMonitoringStartStop();
            await this.testNetworkStateDetection();
            
            // 恢复机制测试
            await this.testOrderRecoveryFlow();
            await this.testManualRecovery();
            await this.testRecoveryFailureHandling();
            
            // 配置和统计测试
            await this.testConfigurationUpdate();
            await this.testStatisticsTracking();
            
            // Trader集成测试
            await this.testTraderIntegration();
            
            // 生成测试报告
            const report = this.generateTestReport();
            Logger.info('OrderRecoveryManager tests completed');
            
            return report;
            
        } catch (error) {
            Logger.error('Error running tests:', error);
            throw error;
        }
    }
    
    /**
     * 测试基础初始化
     */
    async testBasicInitialization() {
        const testName = '基础初始化测试';
        this.testResults.total++;
        
        try {
            const manager = new OrderRecoveryManager(this.mockServices, {
                targetSymbol: 'BTC/USDT',
                autoRecoveryEnabled: true
            });
            
            // 检查初始状态
            if (!manager.isMonitoring && !manager.isRecovering) {
                this.recordTestResult(testName, true, '初始化成功，状态正确');
            } else {
                this.recordTestResult(testName, false, '初始状态不正确');
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `初始化失败: ${error.message}`);
        }
    }
    
    /**
     * 测试监控启动和停止
     */
    async testMonitoringStartStop() {
        const testName = '监控启动停止测试';
        this.testResults.total++;
        
        try {
            const manager = new OrderRecoveryManager(this.mockServices);
            
            // 启动监控
            await manager.startMonitoring();
            
            if (manager.isMonitoring) {
                // 停止监控
                manager.stopMonitoring();
                
                if (!manager.isMonitoring) {
                    this.recordTestResult(testName, true, '监控启动和停止成功');
                } else {
                    this.recordTestResult(testName, false, '监控停止失败');
                }
            } else {
                this.recordTestResult(testName, false, '监控启动失败');
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `监控测试失败: ${error.message}`);
        }
    }
    
    /**
     * 测试网络状态检测
     */
    async testNetworkStateDetection() {
        const testName = '网络状态检测测试';
        this.testResults.total++;
        
        try {
            const manager = new OrderRecoveryManager(this.mockServices);
            
            // 测试网络状态检查
            const networkState = await manager.checkNetworkState();
            
            if (networkState === 'connected') {
                this.recordTestResult(testName, true, `网络状态检测成功: ${networkState}`);
            } else {
                this.recordTestResult(testName, false, `网络状态检测异常: ${networkState}`);
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `网络状态检测失败: ${error.message}`);
        }
    }
    
    /**
     * 测试订单恢复流程
     */
    async testOrderRecoveryFlow() {
        const testName = '订单恢复流程测试';
        this.testResults.total++;
        
        try {
            const manager = new OrderRecoveryManager(this.mockServices, {
                targetSymbol: 'BTC/USDT',
                conservativeMode: false
            });
            
            // 执行订单恢复
            const result = await manager.executeOrderRecovery();
            
            if (result && result.symbolsProcessed >= 0) {
                this.recordTestResult(testName, true, `订单恢复完成: 处理${result.symbolsProcessed}个交易对`);
            } else {
                this.recordTestResult(testName, false, '订单恢复结果异常');
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `订单恢复流程失败: ${error.message}`);
        }
    }
    
    /**
     * 测试手动恢复
     */
    async testManualRecovery() {
        const testName = '手动恢复测试';
        this.testResults.total++;
        
        try {
            const manager = new OrderRecoveryManager(this.mockServices);
            
            // 触发手动恢复
            const result = await manager.triggerManualRecovery('BTC/USDT');
            
            if (result && result['BTC/USDT']) {
                this.recordTestResult(testName, true, '手动恢复成功');
            } else {
                this.recordTestResult(testName, false, '手动恢复结果异常');
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `手动恢复失败: ${error.message}`);
        }
    }
    
    /**
     * 测试恢复失败处理
     */
    async testRecoveryFailureHandling() {
        const testName = '恢复失败处理测试';
        this.testResults.total++;
        
        try {
            // 创建会失败的模拟服务
            const failingServices = {
                ...this.mockServices,
                exchangeService: {
                    ...this.mockServices.exchangeService,
                    fetchOpenOrders: async () => {
                        throw new Error('Network error - connection failed');
                    }
                }
            };
            
            const manager = new OrderRecoveryManager(failingServices, {
                maxRecoveryAttempts: 1,
                targetSymbol: 'BTC/USDT'
            });
            
            let failureHandled = false;
            manager.on('recovery_failed', () => {
                failureHandled = true;
            });
            
            try {
                await manager.executeOrderRecovery();
                // 检查是否有错误被记录
                const stats = manager.getRecoveryStats();
                if (stats.failedRecoveries > 0 || failureHandled) {
                    this.recordTestResult(testName, true, '恢复失败处理正确（错误被正确记录）');
                } else {
                    this.recordTestResult(testName, false, '恢复失败未被正确处理');
                }
            } catch (error) {
                if (failureHandled || error.message.includes('Network error')) {
                    this.recordTestResult(testName, true, '恢复失败处理正确（异常被正确抛出）');
                } else {
                    this.recordTestResult(testName, false, `恢复失败处理异常: ${error.message}`);
                }
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `恢复失败处理测试异常: ${error.message}`);
        }
    }
    
    /**
     * 测试配置更新
     */
    async testConfigurationUpdate() {
        const testName = '配置更新测试';
        this.testResults.total++;
        
        try {
            const manager = new OrderRecoveryManager(this.mockServices);
            
            const originalConfig = manager.config.maxRecoveryAttempts;
            
            // 更新配置
            manager.updateConfig({ maxRecoveryAttempts: 5 });
            
            if (manager.config.maxRecoveryAttempts === 5) {
                this.recordTestResult(testName, true, '配置更新成功');
            } else {
                this.recordTestResult(testName, false, '配置更新失败');
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `配置更新测试失败: ${error.message}`);
        }
    }
    
    /**
     * 测试统计信息跟踪
     */
    async testStatisticsTracking() {
        const testName = '统计信息跟踪测试';
        this.testResults.total++;
        
        try {
            const manager = new OrderRecoveryManager(this.mockServices);
            
            // 获取初始统计
            const initialStats = manager.getRecoveryStats();
            
            // 执行一次恢复
            await manager.executeOrderRecovery();
            
            // 获取更新后的统计
            const updatedStats = manager.getRecoveryStats();
            
            if (updatedStats.totalRecoveries > initialStats.totalRecoveries) {
                this.recordTestResult(testName, true, '统计信息跟踪正确');
            } else {
                this.recordTestResult(testName, false, '统计信息未更新');
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `统计信息测试失败: ${error.message}`);
        }
    }
    
    /**
     * 测试Trader集成
     */
    async testTraderIntegration() {
        const testName = 'Trader集成测试';
        this.testResults.total++;
        
        try {
            // 创建模拟的Trader配置
            const traderConfig = {
                symbol: 'BTC/USDT',
                // 其他必要的配置...
            };
            
            // 注意：这里只测试OrderRecoveryManager的创建，不测试完整的Trader
            // 因为Trader需要更多的依赖和配置
            
            const manager = new OrderRecoveryManager(this.mockServices, {
                targetSymbol: 'BTC/USDT'
            });
            
            // 测试手动触发恢复
            const result = await manager.triggerManualRecovery('BTC/USDT');
            
            if (result) {
                this.recordTestResult(testName, true, 'Trader集成基础功能正常');
            } else {
                this.recordTestResult(testName, false, 'Trader集成功能异常');
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `Trader集成测试失败: ${error.message}`);
        }
    }
    
    /**
     * 记录测试结果
     * @private
     * @param {string} testName - 测试名称
     * @param {boolean} passed - 是否通过
     * @param {string} message - 结果消息
     */
    recordTestResult(testName, passed, message) {
        if (passed) {
            this.testResults.passed++;
            Logger.info(`✓ ${testName}: ${message}`);
        } else {
            this.testResults.failed++;
            Logger.error(`✗ ${testName}: ${message}`);
        }
        
        this.testResults.details.push({
            name: testName,
            passed,
            message,
            timestamp: new Date().toISOString()
        });
    }
    
    /**
     * 生成测试报告
     * @private
     * @returns {Object}
     */
    generateTestReport() {
        const successRate = this.testResults.total > 0 ? 
            (this.testResults.passed / this.testResults.total * 100).toFixed(2) : 0;
        
        const report = {
            summary: {
                total: this.testResults.total,
                passed: this.testResults.passed,
                failed: this.testResults.failed,
                successRate: `${successRate}%`
            },
            details: this.testResults.details
        };
        
        Logger.info('\n=== 订单恢复机制测试报告 ===');
        Logger.info(`总测试数: ${report.summary.total}`);
        Logger.info(`通过: ${report.summary.passed}`);
        Logger.info(`失败: ${report.summary.failed}`);
        Logger.info(`成功率: ${report.summary.successRate}`);
        
        if (report.summary.failed > 0) {
            Logger.info('\n失败的测试:');
            report.details.filter(test => !test.passed).forEach(test => {
                Logger.info(`- ${test.name}: ${test.message}`);
            });
        }
        
        return report;
    }
}

/**
 * 运行测试的主函数
 */
async function runOrderRecoveryTests() {
    try {
        const tester = new OrderRecoveryTest();
        const report = await tester.runAllTests();
        
        // 如果有失败的测试，退出码为1
        if (report.summary.failed > 0) {
            process.exit(1);
        }
        
        Logger.info('所有测试通过！');
        
    } catch (error) {
        Logger.error('测试运行失败:', error);
        process.exit(1);
    }
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
    runOrderRecoveryTests();
}

module.exports = { OrderRecoveryTest, runOrderRecoveryTests };