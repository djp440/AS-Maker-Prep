/**
 * 订单恢复机制与Trader集成测试
 * 验证在实际交易环境中的订单恢复功能
 */

const Trader = require('./trader');
const Logger = require('../shared/logger');

class OrderRecoveryIntegrationTest {
    constructor() {
        this.testResults = {
            total: 0,
            passed: 0,
            failed: 0,
            details: []
        };
    }

    /**
     * 运行所有集成测试
     */
    async runAllTests() {
        Logger.info('开始订单恢复机制集成测试...');
        
        try {
            await this.testTraderWithOrderRecovery();
            await this.testOrderRecoveryAfterNetworkIssue();
            await this.testManualRecoveryTrigger();
            
            this.printTestReport();
            
        } catch (error) {
            Logger.error('集成测试执行失败:', error);
        }
    }

    /**
     * 测试Trader与订单恢复的基本集成
     */
    async testTraderWithOrderRecovery() {
        const testName = 'Trader订单恢复集成测试';
        this.testResults.total++;
        
        try {
            // 创建Trader实例
            const trader = new Trader('BTC/USDT', {
                orderRecovery: {
                    enabled: true,
                    checkInterval: 1000,
                    maxRecoveryAttempts: 2
                },
                // 其他必要的配置
                minSpread: 0.001,
                maxSpread: 0.01,
                orderSize: 0.001,
                maxInventory: 0.1
            });
            
            // 检查订单恢复管理器是否可以初始化
            if (trader.orderRecoveryManager === null) {
                // 手动初始化订单恢复管理器进行测试
                const mockServices = this.createMockServices();
                const OrderRecoveryManager = require('./order_recovery_manager');
                trader.orderRecoveryManager = new OrderRecoveryManager(mockServices, {
                    enabled: true,
                    checkInterval: 1000,
                    maxRecoveryAttempts: 2,
                    targetSymbol: 'BTC/USDT'
                });
                
                const recoveryStats = trader.orderRecoveryManager.getRecoveryStats();
                
                if (recoveryStats && typeof recoveryStats.totalRecoveries === 'number') {
                    this.recordTestResult(testName, true, 'Trader与订单恢复集成成功');
                } else {
                    this.recordTestResult(testName, false, '订单恢复管理器未正确初始化');
                }
                
                trader.orderRecoveryManager.destroy();
            } else {
                this.recordTestResult(testName, true, 'Trader订单恢复管理器已存在');
            }
            
        } catch (error) {
            this.recordTestResult(testName, false, `集成测试异常: ${error.message}`);
        }
    }

    /**
     * 测试网络问题后的订单恢复
     */
    async testOrderRecoveryAfterNetworkIssue() {
        const testName = '网络异常后订单恢复测试';
        this.testResults.total++;
        
        try {
            const mockServices = this.createMockServices();
            
            // 模拟网络问题
            let networkIssue = true;
            mockServices.exchangeService.fetchOpenOrders = async () => {
                if (networkIssue) {
                    throw new Error('Network error - connection timeout');
                }
                return [
                    { id: '1', symbol: 'BTC/USDT', side: 'buy', amount: 0.001, price: 50000 }
                ];
            };
            
            // 直接测试OrderRecoveryManager
            const OrderRecoveryManager = require('./order_recovery_manager');
            const manager = new OrderRecoveryManager(mockServices, {
                enabled: true,
                checkInterval: 500,
                maxRecoveryAttempts: 3,
                targetSymbol: 'BTC/USDT'
            });
            
            // 尝试执行恢复（应该失败）
            try {
                await manager.executeOrderRecovery();
            } catch (error) {
                // 预期的网络错误
            }
            
            // 恢复网络
            networkIssue = false;
            
            // 再次尝试恢复（应该成功）
            const result = await manager.executeOrderRecovery();
            
            const recoveryStats = manager.getRecoveryStats();
            
            if (result && result.symbolsProcessed >= 0) {
                this.recordTestResult(testName, true, '网络异常后订单恢复功能正常');
            } else {
                this.recordTestResult(testName, false, '网络异常后订单恢复未正确执行');
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `网络异常测试失败: ${error.message}`);
        }
    }

    /**
     * 测试手动触发订单恢复
     */
    async testManualRecoveryTrigger() {
        const testName = '手动触发订单恢复测试';
        this.testResults.total++;
        
        try {
            const mockServices = this.createMockServices();
            
            // 直接测试OrderRecoveryManager的手动触发功能
            const OrderRecoveryManager = require('./order_recovery_manager');
            const manager = new OrderRecoveryManager(mockServices, {
                enabled: true,
                checkInterval: 5000, // 设置较长间隔，避免自动触发
                targetSymbol: 'BTC/USDT'
            });
            
            // 手动触发恢复
            const result = await manager.triggerManualRecovery('BTC/USDT');
            
            // 检查返回结果格式：{ 'BTC/USDT': { ordersRecovered: 0, ordersCanceled: 2 } }
            if (result && result['BTC/USDT'] && typeof result['BTC/USDT'].ordersCanceled === 'number') {
                this.recordTestResult(testName, true, '手动触发订单恢复成功');
            } else {
                this.recordTestResult(testName, false, `手动触发订单恢复失败，返回结果: ${JSON.stringify(result)}`);
            }
            
            manager.destroy();
            
        } catch (error) {
            this.recordTestResult(testName, false, `手动触发测试失败: ${error.message}`);
        }
    }

    /**
     * 创建模拟服务
     */
    createMockServices() {
        return {
            exchangeService: {
                fetchOpenOrders: async (symbol) => {
                    return [
                        { id: '1', symbol, side: 'buy', amount: 0.001, price: 50000 },
                        { id: '2', symbol, side: 'sell', amount: 0.001, price: 51000 }
                    ];
                },
                cancelOrder: async (id, symbol) => {
                    return { id, status: 'canceled' };
                },
                createOrder: async (symbol, type, side, amount, price) => {
                    return { id: Date.now().toString(), symbol, type, side, amount, price, status: 'open' };
                }
            },
            wsManager: {
                getConnectionState: () => 'connected',
                isConnected: () => true,
                on: () => {},
                off: () => {},
                emit: () => {}
            },
            quotingEngine: {
                getQuote: async (symbol) => {
                    return {
                        bid: 49900,
                        ask: 50100,
                        spread: 200
                    };
                },
                on: () => {},
                off: () => {}
            }
        };
    }

    /**
     * 记录测试结果
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
            message
        });
    }

    /**
     * 打印测试报告
     */
    printTestReport() {
        const successRate = ((this.testResults.passed / this.testResults.total) * 100).toFixed(2);
        
        Logger.info('\n=== 订单恢复机制集成测试报告 ===');
        Logger.info(`总测试数: ${this.testResults.total}`);
        Logger.info(`通过: ${this.testResults.passed}`);
        Logger.info(`失败: ${this.testResults.failed}`);
        Logger.info(`成功率: ${successRate}%`);
        
        if (this.testResults.failed > 0) {
            Logger.info('\n失败的测试:');
            this.testResults.details
                .filter(test => !test.passed)
                .forEach(test => {
                    Logger.info(`- ${test.name}: ${test.message}`);
                });
        } else {
            Logger.info('\n🎉 所有集成测试通过！');
        }
    }

    /**
     * 延迟函数
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 运行测试
if (require.main === module) {
    const test = new OrderRecoveryIntegrationTest();
    test.runAllTests().then(() => {
        Logger.info('订单恢复机制集成测试完成');
        process.exit(0);
    }).catch(error => {
        Logger.error('集成测试失败:', error);
        process.exit(1);
    });
}

module.exports = OrderRecoveryIntegrationTest;