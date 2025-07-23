/**
 * @description Windows控制台编码修复脚本
 * 解决中文字符在Windows控制台中显示为乱码的问题
 */

/**
 * @description 设置Windows控制台编码为UTF-8
 */
function fixWindowsEncoding() {
    if (process.platform === 'win32') {
        try {
            // 设置控制台代码页为UTF-8
            const { execSync } = require('child_process');
            execSync('chcp 65001', { stdio: 'ignore' });
            
            // 设置Node.js输出编码
            process.stdout.setEncoding('utf8');
            process.stderr.setEncoding('utf8');
            
            console.log('✅ Windows控制台编码已设置为UTF-8');
            console.log('✅ 中文字符现在应该能正确显示了');
            
            return true;
        } catch (error) {
            console.warn('⚠️  警告: 无法设置控制台编码');
            console.warn('   原因:', error.message);
            console.warn('   建议: 请以管理员权限运行或手动执行 "chcp 65001"');
            return false;
        }
    } else {
        console.log('ℹ️  当前系统不是Windows，无需修复编码');
        return true;
    }
}

/**
 * @description 测试中文字符显示
 */
function testChineseDisplay() {
    console.log('\n=== 中文字符显示测试 ===');
    console.log('交易所连接成功');
    console.log('初始化交易所: bitget, 模式: 模拟盘');
    console.log('加载市场信息...');
    console.log('成功加载 44 个交易对');
    console.log('账户余额获取成功');
    console.log('=== 测试完成 ===\n');
    
    console.log('如果上述中文字符显示正常，说明编码修复成功！');
}

// 如果直接运行此脚本
if (require.main === module) {
    console.log('🔧 Windows控制台编码修复工具\n');
    
    const success = fixWindowsEncoding();
    
    if (success) {
        testChineseDisplay();
    }
    
    console.log('\n💡 提示: 如果问题仍然存在，请尝试:');
    console.log('   1. 以管理员权限运行PowerShell');
    console.log('   2. 手动执行: chcp 65001');
    console.log('   3. 重新启动终端');
}

module.exports = {
    fixWindowsEncoding,
    testChineseDisplay
};