const ExchangeService = require('./src/services/exchange_service');
const Config = require('./src/shared/config');
const Logger = require('./src/shared/logger');

/**
 * @description 测试ExchangeService与模拟盘的连接
 */
async function testConnection() {
    try {
        // 设置控制台编码为UTF-8（Windows兼容）
        if (process.platform === 'win32') {
            try {
                // 设置控制台代码页为UTF-8
                const { execSync } = require('child_process');
                execSync('chcp 65001', { stdio: 'ignore' });
                
                // 设置Node.js输出编码
                process.stdout.setEncoding('utf8');
                process.stderr.setEncoding('utf8');
                
                // 设置控制台标题
                process.stdout.write('\x1b]0;ExchangeService连接测试\x07');
            } catch (e) {
                // 如果设置失败，继续执行但可能有编码问题
                console.warn('警告: 无法设置控制台编码，中文可能显示异常');
            }
        }
        
        console.log('=== ExchangeService 模拟盘连接测试 ===\n');
        
        // 1. 加载配置
        console.log('1. 加载配置...');
        await Config.load();
        
        const isPaperTrading = Config.isPaperTrading();
        const exchange = Config.getExchange();
        const credentials = Config.getApiCredentials();
        
        console.log(`   交易所: ${exchange}`);
        console.log(`   模式: ${isPaperTrading ? '模拟盘' : '实盘'}`);
        console.log(`   API Key: ${credentials.apiKey ? credentials.apiKey.substring(0, 10) + '...' : '未设置'}`);
        console.log(`   API Secret: ${credentials.apiSecret ? '已设置' : '未设置'}`);
        console.log(`   API Password: ${credentials.passphrase ? '已设置' : '未设置'}\n`);
        
        // 2. 初始化ExchangeService
        console.log('2. 初始化ExchangeService...');
        await ExchangeService.initialize(Config);
        console.log('   ✅ ExchangeService初始化成功\n');
        
        // 3. 加载市场信息
        console.log('3. 加载市场信息...');
        await ExchangeService.loadMarkets();
        console.log('   ✅ 市场信息加载成功\n');
        
        // 4. 测试获取账户余额
        console.log('4. 测试获取账户余额...');
        const balance = await ExchangeService.fetchBalance();
        console.log('   ✅ 账户余额获取成功');
        console.log('   余额信息:');
        
        // 显示完整的余额结构用于调试
        console.log('   原始余额数据:', JSON.stringify(balance, null, 2));
        
        // 显示主要币种余额
        const mainCoins = ['USDT', 'BTC', 'ETH'];
        let hasBalance = false;
        for (const coin of mainCoins) {
            if (balance[coin]) {
                console.log(`     ${coin}: 可用 ${balance[coin].free || 0}, 冻结 ${balance[coin].used || 0}, 总计 ${balance[coin].total || 0}`);
                hasBalance = true;
            }
        }
        
        if (!hasBalance) {
            console.log('   ⚠️  主要币种余额为空，这在新的模拟盘账户中是正常的');
            console.log('   💡 您可以在Bitget模拟盘中申请测试资金');
        }
        console.log('');
        
        // 5. 测试获取持仓信息
        console.log('5. 测试获取持仓信息...');
        const positions = await ExchangeService.fetchPositions();
        console.log(`   ✅ 持仓信息获取成功，当前持仓数量: ${positions.length}`);
        
        if (positions.length > 0) {
            console.log('   持仓详情:');
            positions.slice(0, 5).forEach(pos => {
                if (pos.contracts && pos.contracts > 0) {
                    console.log(`     ${pos.symbol}: 数量 ${pos.contracts}, 方向 ${pos.side}, 未实现盈亏 ${pos.unrealizedPnl || 0}`);
                }
            });
        } else {
            console.log('   当前无持仓');
        }
        console.log('');
        
        // 6. 测试获取市场信息
        console.log('6. 测试获取市场信息...');
        try {
            const btcMarket = ExchangeService.getMarket('BTC/USDT:USDT');
            console.log('   ✅ BTC/USDT:USDT 市场信息获取成功');
            console.log(`     精度 - 数量: ${btcMarket.precision.amount}, 价格: ${btcMarket.precision.price}`);
            console.log(`     最小订单量: ${btcMarket.limits.amount.min}`);
        } catch (error) {
            console.log('   ⚠️  BTC/USDT:USDT 市场信息获取失败，尝试其他交易对...');
            
            // 尝试获取可用的交易对
            const markets = Object.keys(ExchangeService.markets).slice(0, 3);
            if (markets.length > 0) {
                const firstMarket = ExchangeService.getMarket(markets[0]);
                console.log(`   ✅ ${markets[0]} 市场信息获取成功`);
                console.log(`     精度 - 数量: ${firstMarket.precision.amount}, 价格: ${firstMarket.precision.price}`);
            }
        }
        console.log('');
        
        // 7. 测试获取行情数据
        console.log('7. 测试获取行情数据...');
        try {
            const ticker = await ExchangeService.fetchTicker('BTC/USDT:USDT');
            console.log('   ✅ BTC/USDT:USDT 行情数据获取成功');
            console.log(`     最新价: ${ticker.last}`);
            console.log(`     买一价: ${ticker.bid}`);
            console.log(`     卖一价: ${ticker.ask}`);
            console.log(`     24h涨跌幅: ${ticker.percentage ? ticker.percentage.toFixed(2) + '%' : 'N/A'}`);
        } catch (error) {
            console.log(`   ⚠️  行情数据获取失败: ${error.message}`);
        }
        console.log('');
        
        // 8. 测试获取K线数据
        console.log('8. 测试获取K线数据...');
        try {
            const ohlcv = await ExchangeService.fetchOHLCV('BTC/USDT:USDT', '1h', undefined, 5);
            console.log('   ✅ BTC/USDT:USDT K线数据获取成功');
            console.log(`     获取到 ${ohlcv.length} 条K线数据`);
            if (ohlcv.length > 0) {
                const latest = ohlcv[ohlcv.length - 1];
                console.log(`     最新K线: 开盘 ${latest[1]}, 最高 ${latest[2]}, 最低 ${latest[3]}, 收盘 ${latest[4]}`);
            }
        } catch (error) {
            console.log(`   ⚠️  K线数据获取失败: ${error.message}`);
        }
        console.log('');
        
        console.log('=== 🎉 所有测试完成！ExchangeService与模拟盘连接正常 ===');
        
    } catch (error) {
        console.error('❌ 连接测试失败:', error.message);
        console.error('错误详情:', error);
        process.exit(1);
    }
}

// 运行测试
if (require.main === module) {
    testConnection().then(() => {
        console.log('\n测试完成，程序退出。');
        process.exit(0);
    }).catch(error => {
        console.error('测试过程中发生错误:', error);
        process.exit(1);
    });
}

module.exports = testConnection;