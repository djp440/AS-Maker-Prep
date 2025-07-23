/**
 * WebSocket Manager EventEmitter 演示脚本
 * 展示数据分发和重连后状态校准功能
 */

const WebSocketManager = require('./src/services/websocket_manager');
const Config = require('./src/shared/config');
const Logger = require('./src/shared/logger');

class WebSocketEventDemo {
    constructor() {
        this.wsManager = WebSocketManager;
        this.receivedEvents = {
            ticker: 0,
            orderbook: 0,
            orders: 0,
            balance: 0,
            positions: 0,
            reconnected: 0,
            'reconnected:calibrate': 0
        };
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        console.log('🎧 设置事件监听器...');

        // 监听ticker数据
        this.wsManager.on('ticker', (data) => {
            this.receivedEvents.ticker++;
            console.log(`📈 收到Ticker数据 [${this.receivedEvents.ticker}]:`, {
                symbol: data.symbol,
                bid: data.bid,
                ask: data.ask,
                last: data.last,
                timestamp: new Date(data.timestamp).toLocaleTimeString()
            });
        });

        // 监听订单簿数据
        this.wsManager.on('orderbook', (data) => {
            this.receivedEvents.orderbook++;
            console.log(`📊 收到OrderBook数据 [${this.receivedEvents.orderbook}]:`, {
                symbol: data.symbol,
                bids: data.bids?.length || 0,
                asks: data.asks?.length || 0,
                timestamp: new Date(data.timestamp).toLocaleTimeString()
            });
        });

        // 监听订单更新
        this.wsManager.on('orders', (data) => {
            this.receivedEvents.orders++;
            console.log(`📋 收到Orders数据 [${this.receivedEvents.orders}]:`, {
                symbol: data.symbol,
                side: data.side,
                amount: data.amount,
                status: data.status,
                timestamp: new Date(data.timestamp).toLocaleTimeString()
            });
        });

        // 监听余额变化
        this.wsManager.on('balance', (data) => {
            this.receivedEvents.balance++;
            console.log(`💰 收到Balance数据 [${this.receivedEvents.balance}]:`, {
                currency: data.currency,
                free: data.free,
                used: data.used,
                total: data.total,
                timestamp: new Date(data.timestamp).toLocaleTimeString()
            });
        });

        // 监听持仓变化
        this.wsManager.on('positions', (data) => {
            this.receivedEvents.positions++;
            console.log(`🏦 收到Positions数据 [${this.receivedEvents.positions}]:`, {
                symbol: data.symbol,
                side: data.side,
                size: data.size,
                unrealizedPnl: data.unrealizedPnl,
                timestamp: new Date(data.timestamp).toLocaleTimeString()
            });
        });

        // 监听重连事件
        this.wsManager.on('reconnected', () => {
            this.receivedEvents.reconnected++;
            console.log(`🔄 WebSocket重连成功 [${this.receivedEvents.reconnected}]`);
        });

        // 监听重连后状态校准事件
        this.wsManager.on('reconnected:calibrate', () => {
            this.receivedEvents['reconnected:calibrate']++;
            console.log(`⚖️  重连后状态校准通知 [${this.receivedEvents['reconnected:calibrate']}] - AccountService应该开始状态校准`);
        });

        console.log('✅ 事件监听器设置完成');
    }

    /**
     * 开始演示
     */
    async startDemo() {
        try {
            console.log('🚀 WebSocket EventEmitter 演示开始\n');
            console.log('=' .repeat(60));

            // 加载配置
            await Config.load();
            console.log('✅ 配置加载成功');

            // 设置事件监听器
            this.setupEventListeners();

            // 初始化WebSocket连接
            console.log('\n🔌 初始化WebSocket连接...');
            await this.wsManager.initialize();
            console.log('✅ WebSocket连接成功');

            // 订阅数据
            console.log('\n📡 开始订阅数据...');
            const symbol = 'BTC/USDT:USDT';
            
            await this.wsManager.watchTicker(symbol);
            await this.wsManager.watchOrderBook(symbol);
            await this.wsManager.watchOrders();
            await this.wsManager.watchBalance();
            await this.wsManager.watchPositions(symbol);
            
            console.log('✅ 数据订阅完成');
            console.log(`📊 已订阅主题: ${this.wsManager.getSubscribedTopics().join(', ')}`);

            // 等待接收数据
            console.log('\n⏳ 等待接收数据 (30秒)...');
            console.log('💡 提示: 您可以在Bitget交易所进行一些操作来触发事件');
            
            await this.waitAndShowProgress(30);

            // 模拟连接错误以测试重连机制
            console.log('\n🔄 模拟连接错误以测试重连机制...');
            this.wsManager.handleConnectionError(new Error('模拟网络错误'));
            
            console.log('⏳ 等待重连和状态校准 (10秒)...');
            await this.waitAndShowProgress(10);

            // 显示统计信息
            this.showStatistics();

        } catch (error) {
            console.error('❌ 演示过程中发生错误:', error.message);
        } finally {
            // 清理资源
            console.log('\n🧹 清理资源...');
            if (this.wsManager.isConnected()) {
                await this.wsManager.close();
            }
            console.log('✅ 演示结束');
        }
    }

    /**
     * 等待并显示进度
     */
    async waitAndShowProgress(seconds) {
        for (let i = seconds; i > 0; i--) {
            process.stdout.write(`\r⏰ 剩余时间: ${i}秒 `);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('\r✅ 等待完成     ');
    }

    /**
     * 显示统计信息
     */
    showStatistics() {
        console.log('\n' + '=' .repeat(60));
        console.log('📊 事件接收统计');
        console.log('=' .repeat(60));
        
        Object.entries(this.receivedEvents).forEach(([event, count]) => {
            const icon = this.getEventIcon(event);
            console.log(`${icon} ${event}: ${count} 次`);
        });
        
        const totalEvents = Object.values(this.receivedEvents).reduce((sum, count) => sum + count, 0);
        console.log(`\n🎯 总事件数: ${totalEvents}`);
        
        if (this.receivedEvents['reconnected:calibrate'] > 0) {
            console.log('\n✅ 重连后状态校准机制工作正常！');
            console.log('💡 AccountService 应该已收到校准通知并开始状态同步');
        }
    }

    /**
     * 获取事件图标
     */
    getEventIcon(event) {
        const icons = {
            ticker: '📈',
            orderbook: '📊',
            orders: '📋',
            balance: '💰',
            positions: '🏦',
            reconnected: '🔄',
            'reconnected:calibrate': '⚖️'
        };
        return icons[event] || '📡';
    }
}

// 运行演示
if (require.main === module) {
    const demo = new WebSocketEventDemo();
    demo.startDemo().catch(error => {
        console.error('演示启动失败:', error);
        process.exit(1);
    });
}

module.exports = WebSocketEventDemo;