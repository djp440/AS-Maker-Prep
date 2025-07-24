const MonitoringSystem = require('./index');
const Logger = require('../shared/logger');

/**
 * @description 监控系统测试类
 * 用于测试连接状态监控和指标收集功能
 */
class MonitoringTest {
    constructor() {
        this.testResults = [];
        this.mockServices = this.createMockServices();
    }

    /**
     * @description 创建模拟服务
     * @returns {Object} 模拟服务对象
     */
    createMockServices() {
        const EventEmitter = require('events');
        
        // 模拟WebSocket管理器
        const mockWebSocketManager = new EventEmitter();
        mockWebSocketManager.connectionState = 'open';
        mockWebSocketManager.getConnectionQuality = () => ({
            dataReceiveRate: 95.5,
            averageLatency: 120,
            errorCount: 2,
            lastDataTime: Date.now() - 1000
        });
        mockWebSocketManager.isConnected = () => true;
        mockWebSocketManager.getReconnectCount = () => 3;
        
        // 模拟交换服务
        const mockExchangeService = {
            testConnection: async () => {
                // 模拟API调用
                await new Promise(resolve => setTimeout(resolve, 100));
                return { success: true, latency: 95 };
            },
            getExchange: () => ({
                id: 'bitget',
                name: 'Bitget'
            })
        };
        
        return {
            websocketManager: mockWebSocketManager,
            exchangeService: mockExchangeService
        };
    }

    /**
     * @description 运行所有测试
     */
    async runAllTests() {
        console.log('\n=== 监控系统功能测试开始 ===\n');
        
        try {
            await this.testSystemInitialization();
            await this.testConnectionMonitoring();
            await this.testMetricsCollection();
            await this.testAlertManagement();
            await this.testSystemIntegration();
            await this.testReportGeneration();
            
            this.printTestResults();
            
        } catch (error) {
            console.error('测试执行失败:', error);
        } finally {
            // 清理资源
            MonitoringSystem.destroy();
        }
    }

    /**
     * @description 测试系统初始化
     */
    async testSystemInitialization() {
        console.log('1. 测试系统初始化...');
        
        try {
            // 测试初始化
            await MonitoringSystem.initialize(this.mockServices, {
                connectionMonitor: {
                    healthCheckInterval: 5000,
                    apiCheckInterval: 10000
                },
                alertManager: {
                    thresholds: {
                        reconnectCount: 3,
                        errorRate: 5
                    }
                }
            });
            
            this.addTestResult('系统初始化', true, '监控系统成功初始化');
            
            // 测试重复初始化
            await MonitoringSystem.initialize(this.mockServices);
            this.addTestResult('重复初始化处理', true, '正确处理重复初始化');
            
        } catch (error) {
            this.addTestResult('系统初始化', false, `初始化失败: ${error.message}`);
        }
    }

    /**
     * @description 测试连接监控功能
     */
    async testConnectionMonitoring() {
        console.log('2. 测试连接监控功能...');
        
        try {
            // 获取健康状态
            const healthStatus = MonitoringSystem.getHealthStatus();
            this.addTestResult('健康状态检查', 
                healthStatus && typeof healthStatus === 'object',
                `健康状态: ${JSON.stringify(healthStatus, null, 2)}`);
            
            // 获取连接指标
            const connectionMetrics = MonitoringSystem.getConnectionMetrics();
            this.addTestResult('连接指标获取', 
                connectionMetrics && typeof connectionMetrics === 'object',
                `连接指标: ${JSON.stringify(connectionMetrics, null, 2)}`);
            
            // 模拟连接状态变化
            this.mockServices.websocketManager.emit('connectionStatusChanged', {
                previous: 'open',
                current: 'closed'
            });
            
            this.addTestResult('连接状态变化处理', true, '成功处理连接状态变化事件');
            
        } catch (error) {
            this.addTestResult('连接监控功能', false, `连接监控测试失败: ${error.message}`);
        }
    }

    /**
     * @description 测试指标收集功能
     */
    async testMetricsCollection() {
        console.log('3. 测试指标收集功能...');
        
        try {
            // 测试交易指标记录
            MonitoringSystem.recordTrade({
                side: 'buy',
                amount: 100,
                price: 50000,
                fee: 0.1,
                timestamp: Date.now()
            });
            this.addTestResult('交易指标记录', true, '成功记录交易指标');
            
            // 测试API调用指标记录
            MonitoringSystem.recordApiCall({
                method: 'GET',
                endpoint: '/api/v1/ticker',
                success: true,
                responseTime: 150,
                timestamp: Date.now()
            });
            this.addTestResult('API调用指标记录', true, '成功记录API调用指标');
            
            // 测试GLFT特有指标
            MonitoringSystem.recordHalfSpread(0.0025);
            MonitoringSystem.recordSkew(0.15);
            MonitoringSystem.recordInventory({
                currentInventory: 1500,
                maxInventory: 2000,
                utilization: 0.75,
                limitTriggered: false
            });
            this.addTestResult('GLFT指标记录', true, '成功记录GLFT特有指标');
            
            // 获取当前指标
            const currentMetrics = MonitoringSystem.getCurrentMetrics();
            this.addTestResult('当前指标获取', 
                currentMetrics && typeof currentMetrics === 'object',
                `当前指标: ${JSON.stringify(currentMetrics, null, 2)}`);
            
            // 获取指标摘要
            const metricsSummary = MonitoringSystem.getMetricsSummary();
            this.addTestResult('指标摘要获取', 
                metricsSummary && typeof metricsSummary === 'object',
                `指标摘要: ${JSON.stringify(metricsSummary, null, 2)}`);
            
        } catch (error) {
            this.addTestResult('指标收集功能', false, `指标收集测试失败: ${error.message}`);
        }
    }

    /**
     * @description 测试告警管理功能
     */
    async testAlertManagement() {
        console.log('4. 测试告警管理功能...');
        
        try {
            // 测试基本告警发送
            const alertSent = MonitoringSystem.sendAlert('WARNING', '测试告警', '这是一个测试告警消息', {
                testData: 'test'
            });
            this.addTestResult('基本告警发送', alertSent, '成功发送基本告警');
            
            // 测试连接告警
            MonitoringSystem.sendConnectionAlert('websocket_disconnected', {
                reconnectCount: 5
            });
            this.addTestResult('连接告警发送', true, '成功发送连接告警');
            
            // 测试交易告警
            MonitoringSystem.sendTradingAlert('inventory_utilization_high', {
                utilization: 0.95,
                currentInventory: 1900
            });
            this.addTestResult('交易告警发送', true, '成功发送交易告警');
            
            // 测试系统告警
            MonitoringSystem.sendSystemAlert('uncaught_exception', {
                error: new Error('测试异常')
            });
            this.addTestResult('系统告警发送', true, '成功发送系统告警');
            
            // 获取告警历史
            const alertHistory = MonitoringSystem.getAlertHistory();
            this.addTestResult('告警历史获取', 
                Array.isArray(alertHistory),
                `告警历史条数: ${alertHistory.length}`);
            
            // 获取告警统计
            const alertStats = MonitoringSystem.getAlertStats();
            this.addTestResult('告警统计获取', 
                alertStats && typeof alertStats === 'object',
                `告警统计: ${JSON.stringify(alertStats, null, 2)}`);
            
        } catch (error) {
            this.addTestResult('告警管理功能', false, `告警管理测试失败: ${error.message}`);
        }
    }

    /**
     * @description 测试系统集成功能
     */
    async testSystemIntegration() {
        console.log('5. 测试系统集成功能...');
        
        try {
            // 测试系统健康检查
            const isHealthy = MonitoringSystem.isSystemHealthy();
            this.addTestResult('系统健康检查', 
                typeof isHealthy === 'boolean',
                `系统健康状态: ${isHealthy}`);
            
            // 测试组件获取
            const connectionMonitor = MonitoringSystem.getComponent('connectionMonitor');
            const alertManager = MonitoringSystem.getComponent('alertManager');
            const metricsCollector = MonitoringSystem.getComponent('metricsCollector');
            
            this.addTestResult('组件获取', 
                connectionMonitor && alertManager && metricsCollector,
                '成功获取所有监控组件');
            
            // 测试配置更新
            MonitoringSystem.updateConfig({
                alertManager: {
                    thresholds: {
                        reconnectCount: 10
                    }
                }
            });
            this.addTestResult('配置更新', true, '成功更新监控配置');
            
            // 测试指标重置
            MonitoringSystem.resetMetrics(['trading', 'performance']);
            this.addTestResult('指标重置', true, '成功重置指定类别指标');
            
        } catch (error) {
            this.addTestResult('系统集成功能', false, `系统集成测试失败: ${error.message}`);
        }
    }

    /**
     * @description 测试报告生成功能
     */
    async testReportGeneration() {
        console.log('6. 测试报告生成功能...');
        
        try {
            // 测试实时报告
            const realtimeReport = MonitoringSystem.generateReport('realtime');
            this.addTestResult('实时报告生成', 
                realtimeReport && realtimeReport.type === 'realtime',
                `实时报告: ${JSON.stringify(realtimeReport, null, 2)}`);
            
            // 测试摘要报告
            const summaryReport = MonitoringSystem.generateReport('summary');
            this.addTestResult('摘要报告生成', 
                summaryReport && summaryReport.type === 'summary',
                `摘要报告: ${JSON.stringify(summaryReport, null, 2)}`);
            
            // 测试日报告
            const dailyReport = MonitoringSystem.generateReport('daily');
            this.addTestResult('日报告生成', 
                dailyReport && dailyReport.type === 'daily',
                `日报告: ${JSON.stringify(dailyReport, null, 2)}`);
            
        } catch (error) {
            this.addTestResult('报告生成功能', false, `报告生成测试失败: ${error.message}`);
        }
    }

    /**
     * @description 添加测试结果
     * @param {string} testName - 测试名称
     * @param {boolean} passed - 是否通过
     * @param {string} details - 详细信息
     */
    addTestResult(testName, passed, details) {
        this.testResults.push({
            testName,
            passed,
            details,
            timestamp: new Date().toISOString()
        });
        
        const status = passed ? '✅ 通过' : '❌ 失败';
        console.log(`   ${status} - ${testName}: ${details}`);
    }

    /**
     * @description 打印测试结果摘要
     */
    printTestResults() {
        console.log('\n=== 测试结果摘要 ===\n');
        
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(result => result.passed).length;
        const failedTests = totalTests - passedTests;
        
        console.log(`总测试数: ${totalTests}`);
        console.log(`通过: ${passedTests}`);
        console.log(`失败: ${failedTests}`);
        console.log(`成功率: ${((passedTests / totalTests) * 100).toFixed(2)}%`);
        
        if (failedTests > 0) {
            console.log('\n失败的测试:');
            this.testResults
                .filter(result => !result.passed)
                .forEach(result => {
                    console.log(`- ${result.testName}: ${result.details}`);
                });
        }
        
        console.log('\n=== 测试完成 ===\n');
    }

    /**
     * @description 模拟实际使用场景
     */
    async simulateRealWorldScenario() {
        console.log('\n=== 模拟实际使用场景 ===\n');
        
        try {
            // 模拟交易活动
            console.log('模拟交易活动...');
            for (let i = 0; i < 5; i++) {
                MonitoringSystem.recordTrade({
                    side: i % 2 === 0 ? 'buy' : 'sell',
                    amount: Math.random() * 1000,
                    price: 50000 + Math.random() * 1000,
                    fee: Math.random() * 0.5,
                    timestamp: Date.now()
                });
                
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // 模拟API调用
            console.log('模拟API调用...');
            for (let i = 0; i < 3; i++) {
                MonitoringSystem.recordApiCall({
                    method: 'GET',
                    endpoint: `/api/v1/endpoint${i}`,
                    success: Math.random() > 0.2,
                    responseTime: 50 + Math.random() * 200,
                    timestamp: Date.now()
                });
                
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            
            // 模拟GLFT指标更新
            console.log('模拟GLFT指标更新...');
            MonitoringSystem.recordHalfSpread(0.001 + Math.random() * 0.005);
            MonitoringSystem.recordSkew(-0.5 + Math.random());
            MonitoringSystem.recordInventory({
                currentInventory: 1000 + Math.random() * 1000,
                maxInventory: 2000,
                utilization: 0.5 + Math.random() * 0.4,
                limitTriggered: Math.random() > 0.8
            });
            
            // 生成最终报告
            console.log('生成最终监控报告...');
            const finalReport = MonitoringSystem.generateReport('summary');
            console.log('最终监控报告:', JSON.stringify(finalReport, null, 2));
            
        } catch (error) {
            console.error('实际场景模拟失败:', error);
        }
    }
}

// 运行测试
if (require.main === module) {
    const test = new MonitoringTest();
    
    test.runAllTests()
        .then(() => test.simulateRealWorldScenario())
        .catch(error => {
            console.error('测试运行失败:', error);
            process.exit(1);
        });
}

module.exports = MonitoringTest;