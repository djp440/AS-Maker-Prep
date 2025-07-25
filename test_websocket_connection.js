const ccxt = require('ccxt').pro;
require('dotenv').config();

async function testWebSocketConnection() {
    console.log('🔧 测试WebSocket连接...');
    
    try {
        // 使用模拟盘凭据
        const exchange = new ccxt.bitget({
            apiKey: process.env.PAPER_API_KEY,
            secret: process.env.PAPER_API_SECRET,
            password: process.env.PAPER_API_PASSWORD,
            sandbox: true, // 模拟盘模式
            options: {
                defaultType: 'swap', // 合约交易
                marginMode: 'isolated', // 逐仓模式
                positionMode: 'hedged' // 双向持仓
            },
            enableRateLimit: true,
            timeout: 30000
        });

        console.log('📋 交易所实例创建成功');
        
        // 测试基本连接
        console.log('🔗 测试基本API连接...');
        const markets = await exchange.loadMarkets();
        console.log(`✅ 成功加载 ${Object.keys(markets).length} 个交易对`);
        
        // 测试WebSocket连接
        console.log('🌐 测试WebSocket连接...');
        
        // 测试ticker订阅
        console.log('📊 测试Ticker订阅...');
        const ticker = await exchange.watchTicker('BTC/USDT:USDT');
        console.log('✅ Ticker订阅成功:', {
            symbol: ticker.symbol,
            bid: ticker.bid,
            ask: ticker.ask,
            last: ticker.last
        });
        
        // 等待一段时间
        console.log('⏳ 等待5秒钟...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 关闭连接
        console.log('🔚 关闭WebSocket连接...');
        await exchange.close();
        console.log('✅ WebSocket连接测试完成');
        
    } catch (error) {
        console.error('❌ WebSocket连接测试失败:');
        console.error('错误类型:', error.constructor.name);
        console.error('错误消息:', error.message);
        if (error.stack) {
            console.error('错误堆栈:', error.stack);
        }
        process.exit(1);
    }
}

// 运行测试
testWebSocketConnection().catch(console.error);