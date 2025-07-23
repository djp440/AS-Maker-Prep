#!/usr/bin/env node

/**
 * MarketDataService 综合测试运行脚本
 * 运行所有MarketDataService相关的测试并生成报告
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 测试文件列表
const testFiles = [
    'src/services/__tests__/market_data_service.test.js',           // 原有单元测试
    'src/services/__tests__/market_data_service.integration.test.js', // 集成测试
    'src/services/__tests__/market_data_service.performance.test.js', // 性能测试
    'src/services/__tests__/market_data_service.stability.test.js',   // 稳定性测试
    'src/services/__tests__/market_data_service.recovery.test.js'     // 错误恢复测试
];

// 测试类别配置
const testCategories = {
    unit: {
        name: '单元测试',
        files: ['src/services/__tests__/market_data_service.test.js'],
        description: '基础功能和API测试'
    },
    integration: {
        name: '集成测试',
        files: ['src/services/__tests__/market_data_service.integration.test.js'],
        description: '真实WebSocket连接和外部服务集成测试'
    },
    performance: {
        name: '性能测试',
        files: ['src/services/__tests__/market_data_service.performance.test.js'],
        description: '高频数据处理和性能压力测试'
    },
    stability: {
        name: '稳定性测试',
        files: ['src/services/__tests__/market_data_service.stability.test.js'],
        description: '长时间运行和内存泄漏检测'
    },
    recovery: {
        name: '错误恢复测试',
        files: ['src/services/__tests__/market_data_service.recovery.test.js'],
        description: '网络异常和服务重启场景测试'
    }
};

// 颜色输出函数
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function colorLog(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// 运行单个测试类别
function runTestCategory(category, config) {
    colorLog(`\n${'='.repeat(60)}`, 'cyan');
    colorLog(`🧪 运行 ${config.name}`, 'bright');
    colorLog(`📝 ${config.description}`, 'blue');
    colorLog(`${'='.repeat(60)}`, 'cyan');
    
    const startTime = Date.now();
    let success = true;
    let output = '';
    
    try {
        const testCommand = `npm test ${config.files.join(' ')}`;
        colorLog(`\n📋 执行命令: ${testCommand}`, 'yellow');
        
        output = execSync(testCommand, { 
            encoding: 'utf8',
            stdio: 'pipe',
            cwd: process.cwd()
        });
        
        colorLog(`\n✅ ${config.name} 执行成功`, 'green');
        
    } catch (error) {
        success = false;
        output = error.stdout || error.message;
        colorLog(`\n❌ ${config.name} 执行失败`, 'red');
        if (error.stderr) {
            colorLog(`错误信息: ${error.stderr}`, 'red');
        }
    }
    
    const duration = Date.now() - startTime;
    
    return {
        category,
        name: config.name,
        description: config.description,
        success,
        duration,
        output: output.slice(-2000) // 保留最后2000字符
    };
}

// 运行所有测试
function runAllTests() {
    colorLog('🚀 开始运行 MarketDataService 综合测试套件', 'bright');
    colorLog(`📅 测试时间: ${new Date().toLocaleString()}`, 'blue');
    
    const results = [];
    const startTime = Date.now();
    
    // 按类别运行测试
    for (const [category, config] of Object.entries(testCategories)) {
        const result = runTestCategory(category, config);
        results.push(result);
    }
    
    const totalDuration = Date.now() - startTime;
    
    // 生成测试报告
    generateTestReport(results, totalDuration);
    
    return results;
}

// 生成测试报告
function generateTestReport(results, totalDuration) {
    colorLog(`\n${'='.repeat(80)}`, 'magenta');
    colorLog('📊 MarketDataService 测试报告', 'bright');
    colorLog(`${'='.repeat(80)}`, 'magenta');
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    colorLog(`\n📈 总体统计:`, 'bright');
    colorLog(`   ✅ 成功: ${successCount}/${results.length}`, successCount === results.length ? 'green' : 'yellow');
    colorLog(`   ❌ 失败: ${failureCount}/${results.length}`, failureCount === 0 ? 'green' : 'red');
    colorLog(`   ⏱️  总耗时: ${(totalDuration / 1000).toFixed(2)}秒`, 'blue');
    
    colorLog(`\n📋 详细结果:`, 'bright');
    results.forEach((result, index) => {
        const status = result.success ? '✅' : '❌';
        const color = result.success ? 'green' : 'red';
        const duration = (result.duration / 1000).toFixed(2);
        
        colorLog(`   ${index + 1}. ${status} ${result.name} (${duration}s)`, color);
        colorLog(`      📝 ${result.description}`, 'blue');
        
        if (!result.success) {
            colorLog(`      ⚠️  需要检查和修复`, 'yellow');
        }
    });
    
    // 生成JSON报告文件
    const reportData = {
        timestamp: new Date().toISOString(),
        totalDuration,
        summary: {
            total: results.length,
            success: successCount,
            failure: failureCount,
            successRate: ((successCount / results.length) * 100).toFixed(2) + '%'
        },
        results
    };
    
    const reportDir = path.join(process.cwd(), 'src/services/__tests__/reports');
    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const reportFile = path.join(reportDir, `market_data_service_test_report_${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
    
    colorLog(`\n📄 详细报告已保存到: ${reportFile}`, 'cyan');
    
    // 测试建议
    colorLog(`\n💡 测试建议:`, 'bright');
    if (successCount === results.length) {
        colorLog('   🎉 所有测试都通过了！MarketDataService 质量良好。', 'green');
        colorLog('   🔄 建议定期运行这些测试以确保持续质量。', 'blue');
    } else {
        colorLog('   🔧 部分测试失败，建议优先修复以下问题：', 'yellow');
        results.filter(r => !r.success).forEach(result => {
            colorLog(`      - ${result.name}: ${result.description}`, 'red');
        });
    }
    
    colorLog(`\n🎯 测试覆盖范围:`, 'bright');
    colorLog('   ✓ 单元测试 - 基础功能验证', 'green');
    colorLog('   ✓ 集成测试 - 外部服务集成', 'green');
    colorLog('   ✓ 性能测试 - 高负载处理能力', 'green');
    colorLog('   ✓ 稳定性测试 - 长期运行稳定性', 'green');
    colorLog('   ✓ 恢复测试 - 异常场景处理', 'green');
    
    colorLog(`\n${'='.repeat(80)}`, 'magenta');
}

// 主函数
function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        colorLog('MarketDataService 测试运行器', 'bright');
        colorLog('\n用法:', 'blue');
        colorLog('  node scripts/run-market-data-tests.js [选项]', 'cyan');
        colorLog('\n选项:', 'blue');
        colorLog('  --category <name>  只运行指定类别的测试', 'cyan');
        colorLog('  --list            列出所有可用的测试类别', 'cyan');
        colorLog('  --help, -h        显示帮助信息', 'cyan');
        colorLog('\n示例:', 'blue');
        colorLog('  node scripts/run-market-data-tests.js --category unit', 'cyan');
        colorLog('  node scripts/run-market-data-tests.js --category performance', 'cyan');
        return;
    }
    
    if (args.includes('--list')) {
        colorLog('可用的测试类别:', 'bright');
        Object.entries(testCategories).forEach(([key, config]) => {
            colorLog(`  ${key}: ${config.name} - ${config.description}`, 'cyan');
        });
        return;
    }
    
    const categoryIndex = args.indexOf('--category');
    if (categoryIndex !== -1 && args[categoryIndex + 1]) {
        const category = args[categoryIndex + 1];
        if (testCategories[category]) {
            const result = runTestCategory(category, testCategories[category]);
            generateTestReport([result], result.duration);
        } else {
            colorLog(`❌ 未知的测试类别: ${category}`, 'red');
            colorLog('使用 --list 查看所有可用类别', 'yellow');
        }
        return;
    }
    
    // 运行所有测试
    runAllTests();
}

// 错误处理
process.on('uncaughtException', (error) => {
    colorLog(`\n💥 未捕获的异常: ${error.message}`, 'red');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    colorLog(`\n💥 未处理的Promise拒绝: ${reason}`, 'red');
    process.exit(1);
});

if (require.main === module) {
    main();
}

module.exports = {
    runAllTests,
    runTestCategory,
    testCategories
};