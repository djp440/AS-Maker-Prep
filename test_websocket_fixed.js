const WebSocketManager = require('./src/services/websocket_manager');
const Config = require('./src/shared/config');
const Logger = require('./src/shared/logger');

/**
 * 测试修复后的WebSocket Manager
 * 验证是否能正常获取实时数据
 */
async function testWebSocketManager() {
    try {
        Logger.info('开始测试WebSocket Manager...');
        
        // 先加载配置
        await Config.load();
        Logger.info('配置加载成功');
        
        // 初始化WebSocket连接
        await WebSocketManager.initialize(Config);
        Logger.info('WebSocket初始化成功');
        
        // 测试订阅订单簿数据
        WebSocketManager.on('orderbook', (data) => {
            Logger.info('收到订单簿数据:', {
                symbol: data.symbol,
                timestamp: new Date(data.data.timestamp).toISOString(),
                bestBid: data.data.bids[0],
                bestAsk: data.data.asks[0]
            });
        });
        
        // 测试订阅价格数据
        WebSocketManager.on('ticker', (data) => {
            Logger.info('收到价格数据:', {
                symbol: data.symbol,
                price: data.data.last,
                change: data.data.change,
                volume: data.data.baseVolume
            });
        });
        
        // 测试连接事件
        WebSocketManager.on('connected', () => {
            Logger.info('WebSocket连接成功');
        });
        
        WebSocketManager.on('disconnected', () => {
            Logger.warn('WebSocket连接断开');
        });
        
        WebSocketManager.on('error', (error) => {
            Logger.error('WebSocket错误:', error);
        });
        
        // 订阅BTC/USDT的数据
        const symbol = 'BTC/USDT:USDT';
        Logger.info(`开始订阅 ${symbol} 的数据...`);
        
        await WebSocketManager.watchOrderBook(symbol);
        Logger.info('订单簿订阅成功');
        
        await WebSocketManager.watchTicker(symbol);
        Logger.info('价格订阅成功');
        
        // 运行30秒后停止
        setTimeout(async () => {
            Logger.info('测试完成，关闭连接...');
            await WebSocketManager.close();
            process.exit(0);
        }, 30000);
        
    } catch (error) {
        Logger.error('测试失败:', error.message);
        Logger.error('错误堆栈:', error.stack);
        process.exit(1);
    }
}

// 优雅关闭
process.on('SIGINT', async () => {
    Logger.info('\n收到中断信号，正在关闭...');
    try {
        await WebSocketManager.close();
    } catch (error) {
        Logger.error('关闭WebSocket时出错:', error);
    }
    process.exit(0);
});

// 运行测试
if (require.main === module) {
    testWebSocketManager().catch(console.error);
}

module.exports = testWebSocketManager;