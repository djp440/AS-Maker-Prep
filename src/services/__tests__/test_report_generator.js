/**
 * WebSocket Manager 测试报告生成器
 * 运行所有测试并生成详细的测试报告
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class TestReportGenerator {
    constructor() {
        this.results = {
            unitTests: null,
            integrationTests: null,
            performanceTests: null,
            summary: {
                totalTests: 0,
                passedTests: 0,
                failedTests: 0,
                skippedTests: 0,
                coverage: null
            }
        };
    }

    /**
     * 运行单元测试
     */
    async runUnitTests() {
        console.log('🧪 运行单元测试...');
        try {
            const output = execSync(
                'npm test -- src/services/__tests__/websocket_manager.test.js --json',
                { encoding: 'utf8', cwd: process.cwd() }
            );
            
            this.results.unitTests = {
                status: 'passed',
                output: output,
                timestamp: new Date().toISOString()
            };
            
            console.log('✅ 单元测试完成');
        } catch (error) {
            this.results.unitTests = {
                status: 'failed',
                error: error.message,
                timestamp: new Date().toISOString()
            };
            console.log('❌ 单元测试失败');
        }
    }

    /**
     * 运行集成测试
     */
    async runIntegrationTests() {
        console.log('🔗 运行集成测试...');
        try {
            const output = execSync(
                'npm test -- src/services/__tests__/websocket_manager.integration.test.js --json',
                { encoding: 'utf8', cwd: process.cwd() }
            );
            
            this.results.integrationTests = {
                status: 'passed',
                output: output,
                timestamp: new Date().toISOString()
            };
            
            console.log('✅ 集成测试完成');
        } catch (error) {
            this.results.integrationTests = {
                status: 'failed',
                error: error.message,
                timestamp: new Date().toISOString()
            };
            console.log('❌ 集成测试失败');
        }
    }

    /**
     * 运行性能测试
     */
    async runPerformanceTests() {
        console.log('⚡ 运行性能测试...');
        try {
            const output = execSync(
                'npm test -- src/services/__tests__/websocket_manager.performance.test.js --json',
                { encoding: 'utf8', cwd: process.cwd() }
            );
            
            this.results.performanceTests = {
                status: 'passed',
                output: output,
                timestamp: new Date().toISOString()
            };
            
            console.log('✅ 性能测试完成');
        } catch (error) {
            this.results.performanceTests = {
                status: 'failed',
                error: error.message,
                timestamp: new Date().toISOString()
            };
            console.log('❌ 性能测试失败');
        }
    }

    /**
     * 解析测试结果
     */
    parseResults() {
        let totalTests = 0;
        let passedTests = 0;
        let failedTests = 0;
        let skippedTests = 0;

        [this.results.unitTests, this.results.integrationTests, this.results.performanceTests]
            .forEach(testResult => {
                if (testResult && testResult.output) {
                    try {
                        // 尝试从输出中提取测试统计信息
                        const lines = testResult.output.split('\n');
                        const testSummaryLine = lines.find(line => 
                            line.includes('Tests:') && line.includes('passed')
                        );
                        
                        if (testSummaryLine) {
                            const matches = testSummaryLine.match(/(\d+) passed/);
                            if (matches) {
                                const passed = parseInt(matches[1]);
                                passedTests += passed;
                                totalTests += passed;
                            }
                        }
                    } catch (error) {
                        console.warn('解析测试结果时出错:', error.message);
                    }
                }
            });

        this.results.summary = {
            totalTests,
            passedTests,
            failedTests,
            skippedTests,
            coverage: null
        };
    }

    /**
     * 生成HTML测试报告
     */
    generateHTMLReport() {
        const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebSocket Manager 测试报告</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 2.5em;
        }
        .header p {
            margin: 10px 0 0 0;
            opacity: 0.9;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8f9fa;
        }
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            color: #333;
        }
        .summary-card .number {
            font-size: 2em;
            font-weight: bold;
            color: #667eea;
        }
        .test-section {
            margin: 20px 30px;
            padding: 20px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
        }
        .test-section h2 {
            margin: 0 0 15px 0;
            color: #333;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
        }
        .status {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-weight: bold;
            text-transform: uppercase;
            font-size: 0.8em;
        }
        .status.passed {
            background: #d4edda;
            color: #155724;
        }
        .status.failed {
            background: #f8d7da;
            color: #721c24;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
            margin-top: 10px;
        }
        .error {
            background: #f8f8f8;
            border-left: 4px solid #dc3545;
            padding: 15px;
            margin-top: 10px;
            font-family: monospace;
            white-space: pre-wrap;
        }
        .recommendations {
            background: #e7f3ff;
            border-left: 4px solid #0066cc;
            padding: 20px;
            margin: 20px 30px;
        }
        .recommendations h3 {
            margin: 0 0 15px 0;
            color: #0066cc;
        }
        .recommendations ul {
            margin: 0;
            padding-left: 20px;
        }
        .recommendations li {
            margin-bottom: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>WebSocket Manager 测试报告</h1>
            <p>生成时间: ${new Date().toLocaleString('zh-CN')}</p>
        </div>
        
        <div class="summary">
            <div class="summary-card">
                <h3>总测试数</h3>
                <div class="number">${this.results.summary.totalTests}</div>
            </div>
            <div class="summary-card">
                <h3>通过测试</h3>
                <div class="number">${this.results.summary.passedTests}</div>
            </div>
            <div class="summary-card">
                <h3>失败测试</h3>
                <div class="number">${this.results.summary.failedTests}</div>
            </div>
            <div class="summary-card">
                <h3>跳过测试</h3>
                <div class="number">${this.results.summary.skippedTests}</div>
            </div>
        </div>
        
        <div class="test-section">
            <h2>🧪 单元测试</h2>
            <span class="status ${this.results.unitTests?.status || 'failed'}">
                ${this.results.unitTests?.status || 'failed'}
            </span>
            ${this.results.unitTests?.timestamp ? 
                `<div class="timestamp">执行时间: ${new Date(this.results.unitTests.timestamp).toLocaleString('zh-CN')}</div>` : ''}
            ${this.results.unitTests?.error ? 
                `<div class="error">${this.results.unitTests.error}</div>` : ''}
        </div>
        
        <div class="test-section">
            <h2>🔗 集成测试</h2>
            <span class="status ${this.results.integrationTests?.status || 'failed'}">
                ${this.results.integrationTests?.status || 'failed'}
            </span>
            ${this.results.integrationTests?.timestamp ? 
                `<div class="timestamp">执行时间: ${new Date(this.results.integrationTests.timestamp).toLocaleString('zh-CN')}</div>` : ''}
            ${this.results.integrationTests?.error ? 
                `<div class="error">${this.results.integrationTests.error}</div>` : ''}
        </div>
        
        <div class="test-section">
            <h2>⚡ 性能测试</h2>
            <span class="status ${this.results.performanceTests?.status || 'failed'}">
                ${this.results.performanceTests?.status || 'failed'}
            </span>
            ${this.results.performanceTests?.timestamp ? 
                `<div class="timestamp">执行时间: ${new Date(this.results.performanceTests.timestamp).toLocaleString('zh-CN')}</div>` : ''}
            ${this.results.performanceTests?.error ? 
                `<div class="error">${this.results.performanceTests.error}</div>` : ''}
        </div>
        
        <div class="recommendations">
            <h3>📋 测试建议和下一步行动</h3>
            <ul>
                <li><strong>单元测试覆盖率</strong>: 当前单元测试覆盖了核心功能，建议保持定期运行</li>
                <li><strong>集成测试</strong>: 需要在网络环境良好时运行，验证真实连接功能</li>
                <li><strong>性能测试</strong>: 建议在生产环境部署前运行，确保系统稳定性</li>
                <li><strong>监控建议</strong>: 在生产环境中添加WebSocket连接状态监控</li>
                <li><strong>错误处理</strong>: 继续完善重连机制和错误恢复策略</li>
            </ul>
        </div>
    </div>
</body>
</html>
        `;
        
        return html;
    }

    /**
     * 保存测试报告
     */
    saveReport() {
        const reportDir = path.join(__dirname, 'reports');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const htmlFile = path.join(reportDir, `websocket_test_report_${timestamp}.html`);
        const jsonFile = path.join(reportDir, `websocket_test_results_${timestamp}.json`);
        
        // 保存HTML报告
        fs.writeFileSync(htmlFile, this.generateHTMLReport());
        
        // 保存JSON结果
        fs.writeFileSync(jsonFile, JSON.stringify(this.results, null, 2));
        
        console.log(`\n📊 测试报告已生成:`);
        console.log(`   HTML报告: ${htmlFile}`);
        console.log(`   JSON结果: ${jsonFile}`);
        
        return { htmlFile, jsonFile };
    }

    /**
     * 运行完整的测试套件
     */
    async runAllTests() {
        console.log('🚀 开始运行WebSocket Manager完整测试套件\n');
        
        const startTime = Date.now();
        
        // 运行所有测试
        await this.runUnitTests();
        await this.runIntegrationTests();
        await this.runPerformanceTests();
        
        // 解析结果
        this.parseResults();
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        console.log(`\n🏁 测试套件执行完成，耗时: ${duration.toFixed(2)}秒`);
        console.log(`📈 测试统计: ${this.results.summary.passedTests}/${this.results.summary.totalTests} 通过`);
        
        // 生成并保存报告
        const reportFiles = this.saveReport();
        
        return {
            results: this.results,
            duration,
            reportFiles
        };
    }
}

// 如果直接运行此脚本，则执行完整测试
if (require.main === module) {
    const generator = new TestReportGenerator();
    generator.runAllTests().catch(console.error);
}

module.exports = TestReportGenerator;