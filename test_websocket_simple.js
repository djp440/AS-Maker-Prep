const WebSocketManager = require('./src/services/websocket_manager');
const Config = require('./src/shared/config');
const Logger = require('./src/shared/logger');

/**
 * 简化的WebSocket测试
 * 用于快速验证WebSocket连接是否正常
 */
async function testWebSocket() {
    try {
        // 加载配置
        await Config.load();
        
        // 初始化WebSocket
        await WebSocketManager.initialize(Config);
        Logger.info('WebSocket初始化成功');
        
        // 监听数据
        let orderBookCount = 0;
        let tickerCount = 0;
        
        WebSocketManager.on('orderbook', (data) => {
            orderBookCount++;
            if (orderBookCount <= 3) {
                const orderBookInfo = {
                    symbol: data.symbol,
                    bestBid: data.data.bids[0],
                    bestAsk: data.data.asks[0],
                    timestamp: new Date(data.data.timestamp).toISOString()
                };
                Logger.info(`订单簿数据 #${orderBookCount}: ${JSON.stringify(orderBookInfo, null, 2)}`);
            }
        });
        
        WebSocketManager.on('ticker', (data) => {
            tickerCount++;
            if (tickerCount <= 3) {
                const tickerInfo = {
                    symbol: data.symbol,
                    price: data.data.last,
                    volume: data.data.baseVolume,
                    change: data.data.change,
                    timestamp: new Date(data.data.timestamp).toISOString()
                };
                Logger.info(`价格数据 #${tickerCount}: ${JSON.stringify(tickerInfo, null, 2)}`);
            }
        });
        
        // 订阅数据
        const symbol = 'BTC/USDT:USDT';
        await WebSocketManager.watchOrderBook(symbol);
        await WebSocketManager.watchTicker(symbol);
        
        Logger.info('开始接收数据，10秒后自动停止...');
        
        // 10秒后停止
        setTimeout(async () => {
            Logger.info(`测试完成 - 收到 ${orderBookCount} 个订单簿更新，${tickerCount} 个价格更新`);
            await WebSocketManager.close();
            process.exit(0);
        }, 10000);
        
    } catch (error) {
        Logger.error('测试失败:', error.message);
        process.exit(1);
    }
}

// 优雅关闭
process.on('SIGINT', async () => {
    Logger.info('\n正在关闭...');
    await WebSocketManager.close();
    process.exit(0);
});

if (require.main === module) {
    testWebSocket();
}

module.exports = testWebSocket;