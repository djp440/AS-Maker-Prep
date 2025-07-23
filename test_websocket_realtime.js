/**
 * WebSocket实时数据流测试
 * 用于验证修复后的WebSocket Manager在实际数据流中的表现
 */

const WebSocketManager = require('./src/services/websocket_manager');
const Config = require('./src/shared/config');
const Logger = require('./src/shared/logger');

class RealtimeDataTester {
    constructor() {
        this.webSocketManager = WebSocketManager;
        this.receivedData = {
            ticker: 0,
            orderbook: 0,
            balance: 0,
            positions: 0
        };
        this.testDuration = 10000; // 10秒测试
        this.startTime = null;
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 监听ticker数据
        this.webSocketManager.on('ticker', (data) => {
            this.receivedData.ticker++;
            console.log(`📈 Ticker更新 [${this.receivedData.ticker}]: ${data.symbol} - 价格: ${data.data.last}`);
        });

        // 监听订单簿数据
        this.webSocketManager.on('orderbook', (data) => {
            this.receivedData.orderbook++;
            const { bids, asks } = data.data;
            console.log(`📊 订单簿更新 [${this.receivedData.orderbook}]: ${data.symbol} - 买一: ${bids[0]?.[0]}, 卖一: ${asks[0]?.[0]}`);
        });

        // 监听余额变化
        this.webSocketManager.on('balance', (data) => {
            this.receivedData.balance++;
            console.log(`💰 余额更新 [${this.receivedData.balance}]: USDT余额变化`);
        });

        // 监听持仓变化
        this.webSocketManager.on('positions', (data) => {
            this.receivedData.positions++;
            console.log(`📍 持仓更新 [${this.receivedData.positions}]: ${data.symbol || '全部'}`);
        });

        // 监听连接事件
        this.webSocketManager.on('connected', () => {
            console.log('🔗 WebSocket已连接');
        });

        this.webSocketManager.on('disconnected', (error) => {
            console.log('❌ WebSocket连接断开:', error.message);
        });

        this.webSocketManager.on('reconnected', () => {
            console.log('🔄 WebSocket重连成功');
        });
    }

    /**
     * 运行实时数据测试
     */
    async runRealtimeTest() {
        console.log('\n🚀 开始WebSocket实时数据流测试...');
        console.log(`⏱️  测试时长: ${this.testDuration / 1000}秒\n`);

        try {
            // 加载配置
            await Config.load();
            
            // 设置事件监听器
            this.setupEventListeners();

            // 初始化WebSocket连接
            await this.webSocketManager.initialize();
            
            if (!this.webSocketManager.isConnected()) {
                throw new Error('WebSocket连接失败');
            }

            console.log('✅ WebSocket连接成功，开始订阅数据流...\n');

            // 订阅数据流
            const symbol = 'BTC/USDT:USDT';
            await this.webSocketManager.watchTicker(symbol);
            await this.webSocketManager.watchOrderBook(symbol);
            
            // 注意：余额和持仓订阅需要有效的API凭证
            try {
                await this.webSocketManager.watchBalance();
                await this.webSocketManager.watchPositions(symbol);
            } catch (error) {
                console.log('⚠️  私有数据订阅跳过（需要有效API凭证）:', error.message);
            }

            this.startTime = Date.now();

            // 等待指定时间
            await new Promise(resolve => {
                const interval = setInterval(() => {
                    const elapsed = Date.now() - this.startTime;
                    const remaining = Math.max(0, this.testDuration - elapsed);
                    
                    if (remaining > 0) {
                        process.stdout.write(`\r⏰ 剩余时间: ${Math.ceil(remaining / 1000)}秒 `);
                    } else {
                        clearInterval(interval);
                        console.log('\n');
                        resolve();
                    }
                }, 1000);
            });

            // 生成测试报告
            this.generateReport();

        } catch (error) {
            console.error('❌ 测试失败:', error.message);
        } finally {
            // 清理资源
            await this.webSocketManager.close();
            console.log('🧹 测试完成，资源已清理');
        }
    }

    /**
     * 生成测试报告
     */
    generateReport() {
        const totalReceived = Object.values(this.receivedData).reduce((sum, count) => sum + count, 0);
        const testDurationSeconds = this.testDuration / 1000;
        
        console.log('\n' + '='.repeat(50));
        console.log('📊 实时数据流测试报告');
        console.log('='.repeat(50));
        
        console.log(`\n📈 数据接收统计:`);
        console.log(`   Ticker数据: ${this.receivedData.ticker} 条`);
        console.log(`   订单簿数据: ${this.receivedData.orderbook} 条`);
        console.log(`   余额数据: ${this.receivedData.balance} 条`);
        console.log(`   持仓数据: ${this.receivedData.positions} 条`);
        console.log(`   总计: ${totalReceived} 条`);
        
        console.log(`\n⚡ 性能指标:`);
        console.log(`   测试时长: ${testDurationSeconds}秒`);
        console.log(`   平均数据率: ${(totalReceived / testDurationSeconds).toFixed(2)} 条/秒`);
        
        if (totalReceived > 0) {
            console.log(`\n✅ 测试结果: 成功`);
            console.log(`   WebSocket数据流正常，修复有效！`);
        } else {
            console.log(`\n⚠️  测试结果: 无数据接收`);
            console.log(`   可能原因: 网络问题或API限制`);
        }
        
        console.log('\n' + '='.repeat(50));
    }
}

// 运行测试
if (require.main === module) {
    const tester = new RealtimeDataTester();
    tester.runRealtimeTest().catch(error => {
        console.error('测试异常:', error);
        process.exit(1);
    });
}

module.exports = RealtimeDataTester;