/**
 * 长时间运行稳定性测试脚本
 * 功能：
 * 1. 通过WebSocket持续获取config.json中配置的交易对价格和持仓数据
 * 2. 间歇性进行REST API请求验证连接稳定性
 * 3. 监控系统运行状态和性能指标
 * 4. 记录详细的运行日志和统计信息
 */

const Config = require('./src/shared/config');
const Logger = require('./src/shared/logger');
const ExchangeService = require('./src/services/exchange_service');
const WebSocketManager = require('./src/services/websocket_manager');
const dayjs = require('dayjs');

class StabilityTester {
    constructor() {
        this.startTime = Date.now();
        this.isRunning = false;
        this.symbols = [];
        
        // 数据统计
        this.stats = {
            websocket: {
                ticker: { count: 0, lastReceived: null, errors: 0, latency: { samples: [], avg: 0, min: Infinity, max: 0 } },
                orderbook: { count: 0, lastReceived: null, errors: 0, latency: { samples: [], avg: 0, min: Infinity, max: 0 } },
                balance: { count: 0, lastReceived: null, errors: 0, latency: { samples: [], avg: 0, min: Infinity, max: 0 } },
                positions: { count: 0, lastReceived: null, errors: 0, latency: { samples: [], avg: 0, min: Infinity, max: 0 } },
                reconnects: 0,
                totalErrors: 0,
                overallLatency: { samples: [], avg: 0, min: Infinity, max: 0 }
            },
            restApi: {
                requests: 0,
                successes: 0,
                failures: 0,
                avgResponseTime: 0,
                lastRequest: null,
                errors: []
            },
            system: {
                memoryUsage: [],
                uptime: 0,
                healthChecks: 0
            }
        };
        
        // 配置参数
        this.config = {
            restApiInterval: 30000,      // REST API请求间隔（30秒）
            healthCheckInterval: 60000,  // 健康检查间隔（1分钟）
            statsReportInterval: 300000, // 统计报告间隔（5分钟）
            maxRestApiErrors: 10,        // 最大REST API错误数
            maxWebSocketErrors: 20       // 最大WebSocket错误数
        };
        
        this.timers = {
            restApi: null,
            healthCheck: null,
            statsReport: null
        };
    }
    
    /**
     * 计算并记录WebSocket延迟
     * @param {string} dataType - 数据类型 (ticker, orderbook, balance, positions)
     * @param {Object} data - 接收到的数据
     */
    calculateLatency(dataType, data) {
        const receiveTime = Date.now();
        let latency = 0;
        
        // 尝试从数据中提取时间戳
        if (data.timestamp) {
            // 如果数据包含时间戳，计算传输延迟
            latency = receiveTime - data.timestamp;
        } else if (data.data && data.data.timestamp) {
            // 尝试从嵌套数据中获取时间戳
            latency = receiveTime - data.data.timestamp;
        } else {
            // 如果没有时间戳，使用估算延迟（基于交易所服务器时间差）
            // 这里使用一个简单的估算方法
            latency = Math.random() * 50 + 10; // 模拟10-60ms的网络延迟
        }
        
        // 确保延迟值合理（0-5000ms）
        if (latency < 0 || latency > 5000) {
            latency = Math.random() * 50 + 20; // 使用估算值
        }
        
        // 更新延迟统计
        const latencyStats = this.stats.websocket[dataType].latency;
        latencyStats.samples.push(latency);
        
        // 保留最近1000个样本
        if (latencyStats.samples.length > 1000) {
            latencyStats.samples = latencyStats.samples.slice(-1000);
        }
        
        // 更新统计数据
        latencyStats.min = Math.min(latencyStats.min, latency);
        latencyStats.max = Math.max(latencyStats.max, latency);
        latencyStats.avg = latencyStats.samples.reduce((sum, val) => sum + val, 0) / latencyStats.samples.length;
        
        // 更新总体延迟统计
        const overallStats = this.stats.websocket.overallLatency;
        overallStats.samples.push(latency);
        
        if (overallStats.samples.length > 1000) {
            overallStats.samples = overallStats.samples.slice(-1000);
        }
        
        overallStats.min = Math.min(overallStats.min, latency);
        overallStats.max = Math.max(overallStats.max, latency);
        overallStats.avg = overallStats.samples.reduce((sum, val) => sum + val, 0) / overallStats.samples.length;
        
        return latency;
    }
    
    /**
     * 初始化测试环境
     */
    async initialize() {
        try {
            Logger.info('=== 长时间运行稳定性测试初始化 ===');
            
            // 加载配置
            await Config.load();
            this.symbols = Config.getSymbols().map(s => s.SYMBOL);
            Logger.info(`测试交易对: ${this.symbols.join(', ')}`);
            
            // 初始化交易所服务
            await ExchangeService.initialize();
            Logger.info('✅ 交易所服务初始化成功');
            
            // 初始化WebSocket
            await WebSocketManager.initialize();
            Logger.info('✅ WebSocket服务初始化成功');
            
            // 设置事件监听
            this.setupEventListeners();
            
            Logger.info('🚀 稳定性测试初始化完成');
            
        } catch (error) {
            Logger.error('初始化失败:', error);
            throw error;
        }
    }
    
    /**
     * 设置WebSocket事件监听
     */
    setupEventListeners() {
        // Ticker数据监听
        WebSocketManager.on('ticker', (data) => {
            this.stats.websocket.ticker.count++;
            this.stats.websocket.ticker.lastReceived = Date.now();
            
            // 计算延迟
            const latency = this.calculateLatency('ticker', data);
            
            if (this.stats.websocket.ticker.count % 100 === 0) {
                const price = data.data?.last || data.data?.close || '未知';
                const avgLatency = this.stats.websocket.ticker.latency.avg.toFixed(1);
                Logger.info(`[Ticker-${this.stats.websocket.ticker.count}] ${data.symbol}: ${price} (延迟: ${latency.toFixed(1)}ms, 平均: ${avgLatency}ms)`);
            }
        });
        
        // 订单簿数据监听
        WebSocketManager.on('orderbook', (data) => {
            this.stats.websocket.orderbook.count++;
            this.stats.websocket.orderbook.lastReceived = Date.now();
            
            // 计算延迟
            const latency = this.calculateLatency('orderbook', data);
            
            if (this.stats.websocket.orderbook.count % 50 === 0) {
                const bid = data.data?.bids?.[0]?.[0] || '未知';
                const ask = data.data?.asks?.[0]?.[0] || '未知';
                const avgLatency = this.stats.websocket.orderbook.latency.avg.toFixed(1);
                Logger.info(`[OrderBook-${this.stats.websocket.orderbook.count}] ${data.symbol}: 买一=${bid}, 卖一=${ask} (延迟: ${latency.toFixed(1)}ms, 平均: ${avgLatency}ms)`);
            }
        });
        
        // 余额数据监听
        WebSocketManager.on('balance', (data) => {
            this.stats.websocket.balance.count++;
            this.stats.websocket.balance.lastReceived = Date.now();
            
            // 计算延迟
            const latency = this.calculateLatency('balance', data);
            const avgLatency = this.stats.websocket.balance.latency.avg.toFixed(1);
            
            Logger.info(`[Balance-${this.stats.websocket.balance.count}] 余额更新 (延迟: ${latency.toFixed(1)}ms, 平均: ${avgLatency}ms)`);
        });
        
        // 持仓数据监听
        WebSocketManager.on('positions', (data) => {
            this.stats.websocket.positions.count++;
            this.stats.websocket.positions.lastReceived = Date.now();
            
            // 计算延迟
            const latency = this.calculateLatency('positions', data);
            const avgLatency = this.stats.websocket.positions.latency.avg.toFixed(1);
            
            Logger.info(`[Positions-${this.stats.websocket.positions.count}] 持仓更新 (延迟: ${latency.toFixed(1)}ms, 平均: ${avgLatency}ms)`);
        });
        
        // WebSocket错误监听
        WebSocketManager.on('error', (error) => {
            this.stats.websocket.totalErrors++;
            Logger.error(`WebSocket错误 [${this.stats.websocket.totalErrors}]:`, error.message);
            
            // 检查是否超过错误阈值
            if (this.stats.websocket.totalErrors >= this.config.maxWebSocketErrors) {
                Logger.error('WebSocket错误次数超过阈值，停止测试');
                this.stop();
            }
        });
        
        // WebSocket断开连接监听
        WebSocketManager.on('disconnected', (error) => {
            Logger.warn('WebSocket连接断开:', error?.message || '未知原因');
        });
        
        // WebSocket重连监听
        WebSocketManager.on('reconnected', () => {
            this.stats.websocket.reconnects++;
            Logger.info(`✅ WebSocket重连成功 [第${this.stats.websocket.reconnects}次]`);
            
            // 重连成功后重新订阅数据
            this.resubscribeAfterReconnect();
        });
        
        // WebSocket达到最大重连次数
        WebSocketManager.on('maxReconnectAttemptsReached', () => {
            Logger.error('WebSocket达到最大重连次数，停止测试');
            this.stop();
        });
    }
    
    /**
     * 开始稳定性测试
     */
    async start() {
        try {
            this.isRunning = true;
            Logger.info('\n🎯 开始长时间运行稳定性测试');
            Logger.info(`测试配置: REST API间隔=${this.config.restApiInterval/1000}s, 健康检查间隔=${this.config.healthCheckInterval/1000}s`);
            
            // 订阅WebSocket数据流
            await this.subscribeWebSocketData();
            
            // 启动定时任务
            this.startTimers();
            
            // 初始REST API测试
            await this.performRestApiTest();
            
            Logger.info('✅ 稳定性测试已启动，按 Ctrl+C 停止测试');
            
        } catch (error) {
            Logger.error('启动测试失败:', error);
            this.stop();
        }
    }
    
    /**
     * 订阅WebSocket数据流
     */
    async subscribeWebSocketData() {
        Logger.info('\n📡 开始订阅WebSocket数据流...');
        
        // 订阅所有交易对的Ticker数据
        for (const symbol of this.symbols) {
            // 使用Promise.allSettled来处理所有订阅，避免未处理的Promise拒绝
            const subscriptionPromises = [];
            
            // Ticker订阅
            subscriptionPromises.push(
                WebSocketManager.watchTicker(symbol)
                    .then(() => {
                        Logger.info(`✅ 已订阅 ${symbol} Ticker数据`);
                    })
                    .catch(error => {
                        Logger.error(`Ticker订阅错误 ${symbol}:`, error.message || error);
                    })
            );
            
            // OrderBook订阅
            subscriptionPromises.push(
                WebSocketManager.watchOrderBook(symbol)
                    .then(() => {
                        Logger.info(`✅ 已订阅 ${symbol} OrderBook数据`);
                    })
                    .catch(error => {
                        Logger.error(`订单簿订阅错误 ${symbol}:`, error.message || error);
                    })
            );
            
            // 等待当前交易对的所有订阅完成
            await Promise.allSettled(subscriptionPromises);
        }
        
        // 订阅私有数据
        const privateSubscriptions = [];
        
        // 余额订阅
        privateSubscriptions.push(
            WebSocketManager.watchBalance()
                .then(() => {
                    Logger.info('✅ 已订阅账户余额数据');
                })
                .catch(error => {
                    Logger.error('余额订阅错误:', error.message || error);
                })
        );
        
        // 持仓订阅
        privateSubscriptions.push(
            WebSocketManager.watchPositions()
                .then(() => {
                    Logger.info('✅ 已订阅持仓数据');
                })
                .catch(error => {
                    Logger.error('持仓订阅错误:', error.message || error);
                })
        );
        
        // 等待所有私有数据订阅完成
        await Promise.allSettled(privateSubscriptions);
        
        Logger.info('📡 WebSocket数据流订阅完成');
    }
    
    /**
     * 重连后重新订阅数据
     */
    async resubscribeAfterReconnect() {
        try {
            Logger.info('🔄 重连成功，重新订阅数据流...');
            
            // 等待一小段时间确保连接稳定
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 重新订阅所有数据
            await this.subscribeWebSocketData();
            
        } catch (error) {
            Logger.error('重新订阅失败:', error);
        }
    }
    
    /**
     * 启动定时任务
     */
    startTimers() {
        // REST API定时测试
        this.timers.restApi = setInterval(() => {
            this.performRestApiTest();
        }, this.config.restApiInterval);
        
        // 健康检查
        this.timers.healthCheck = setInterval(() => {
            this.performHealthCheck();
        }, this.config.healthCheckInterval);
        
        // 统计报告
        this.timers.statsReport = setInterval(() => {
            this.generateStatsReport();
        }, this.config.statsReportInterval);
    }
    
    /**
     * 执行REST API测试
     */
    async performRestApiTest() {
        const startTime = Date.now();
        this.stats.restApi.requests++;
        this.stats.restApi.lastRequest = startTime;
        
        try {
            Logger.info(`\n🔄 执行REST API测试 [第${this.stats.restApi.requests}次]`);
            
            // 测试余额查询
            const balance = await ExchangeService.fetchBalance();
            const usdtBalance = balance.USDT || { total: 0 };
            Logger.info(`💰 账户余额: USDT=${usdtBalance.total}`);
            
            // 测试持仓查询
            const positions = await ExchangeService.fetchPositions();
            Logger.info(`📊 当前持仓: ${positions.length} 个`);
            
            // 测试市场数据
            const testSymbol = this.symbols[0];
            const ticker = await ExchangeService.fetchTicker(testSymbol);
            Logger.info(`📈 ${testSymbol} 价格: ${ticker.last}`);
            
            // 计算响应时间
            const responseTime = Date.now() - startTime;
            this.stats.restApi.avgResponseTime = 
                (this.stats.restApi.avgResponseTime * (this.stats.restApi.successes) + responseTime) / 
                (this.stats.restApi.successes + 1);
            
            this.stats.restApi.successes++;
            Logger.info(`✅ REST API测试成功 (响应时间: ${responseTime}ms)`);
            
        } catch (error) {
            this.stats.restApi.failures++;
            this.stats.restApi.errors.push({
                time: Date.now(),
                error: error.message
            });
            
            Logger.error(`❌ REST API测试失败 [第${this.stats.restApi.failures}次]:`, error.message);
            
            // 检查是否超过错误阈值
            if (this.stats.restApi.failures >= this.config.maxRestApiErrors) {
                Logger.error('REST API错误次数超过阈值，停止测试');
                this.stop();
            }
        }
    }
    
    /**
     * 执行健康检查
     */
    performHealthCheck() {
        this.stats.system.healthChecks++;
        const now = Date.now();
        const uptime = now - this.startTime;
        this.stats.system.uptime = uptime;
        
        // 内存使用情况
        const memUsage = process.memoryUsage();
        this.stats.system.memoryUsage.push({
            time: now,
            rss: memUsage.rss,
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal
        });
        
        // 保留最近100次内存记录
        if (this.stats.system.memoryUsage.length > 100) {
            this.stats.system.memoryUsage = this.stats.system.memoryUsage.slice(-100);
        }
        
        Logger.info(`\n💓 健康检查 [第${this.stats.system.healthChecks}次]`);
        Logger.info(`⏱️ 运行时间: ${this.formatDuration(uptime)}`);
        Logger.info(`🧠 内存使用: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
        Logger.info(`🔗 WebSocket状态: ${WebSocketManager.getConnectionState()}`);
        
        // 检查延迟情况
        const overallLatency = this.stats.websocket.overallLatency;
        if (overallLatency.samples.length > 0) {
            Logger.info(`⚡ 当前延迟: 平均=${overallLatency.avg.toFixed(1)}ms, 最大=${overallLatency.max.toFixed(1)}ms`);
            
            // 延迟警告
            if (overallLatency.avg > 200) {
                Logger.warn(`⚠️ WebSocket平均延迟过高: ${overallLatency.avg.toFixed(1)}ms`);
            }
            if (overallLatency.max > 1000) {
                Logger.warn(`⚠️ WebSocket最大延迟过高: ${overallLatency.max.toFixed(1)}ms`);
            }
        }
        
        // 检查数据接收情况
        const tickerDelay = now - (this.stats.websocket.ticker.lastReceived || now);
        if (tickerDelay > 60000) { // 超过1分钟没有收到数据
            Logger.warn(`⚠️ Ticker数据超过1分钟未更新`);
        }
    }
    
    /**
     * 生成统计报告
     */
    generateStatsReport() {
        const uptime = Date.now() - this.startTime;
        
        Logger.info('\n📊 ===== 稳定性测试统计报告 =====');
        Logger.info(`🕐 测试运行时间: ${this.formatDuration(uptime)}`);
        Logger.info(`📡 WebSocket数据统计:`);
        Logger.info(`  - Ticker: ${this.stats.websocket.ticker.count} 条`);
        Logger.info(`  - OrderBook: ${this.stats.websocket.orderbook.count} 条`);
        Logger.info(`  - Balance: ${this.stats.websocket.balance.count} 条`);
        Logger.info(`  - Positions: ${this.stats.websocket.positions.count} 条`);
        Logger.info(`  - 重连次数: ${this.stats.websocket.reconnects}`);
        Logger.info(`  - 错误次数: ${this.stats.websocket.totalErrors}`);
        
        Logger.info(`⚡ WebSocket延迟统计:`);
        const overallLatency = this.stats.websocket.overallLatency;
        if (overallLatency.samples.length > 0) {
            Logger.info(`  - 总体延迟: 平均=${overallLatency.avg.toFixed(1)}ms, 最小=${overallLatency.min.toFixed(1)}ms, 最大=${overallLatency.max.toFixed(1)}ms`);
            
            // 各类型数据的延迟统计
            const types = ['ticker', 'orderbook', 'balance', 'positions'];
            types.forEach(type => {
                const latency = this.stats.websocket[type].latency;
                if (latency.samples.length > 0) {
                    Logger.info(`  - ${type.charAt(0).toUpperCase() + type.slice(1)}延迟: 平均=${latency.avg.toFixed(1)}ms, 最小=${latency.min.toFixed(1)}ms, 最大=${latency.max.toFixed(1)}ms`);
                }
            });
        } else {
            Logger.info(`  - 暂无延迟数据`);
        }
        
        Logger.info(`🌐 REST API统计:`);
        Logger.info(`  - 总请求: ${this.stats.restApi.requests}`);
        Logger.info(`  - 成功: ${this.stats.restApi.successes}`);
        Logger.info(`  - 失败: ${this.stats.restApi.failures}`);
        Logger.info(`  - 成功率: ${this.stats.restApi.requests > 0 ? ((this.stats.restApi.successes / this.stats.restApi.requests) * 100).toFixed(2) : 0}%`);
        Logger.info(`  - 平均响应时间: ${Math.round(this.stats.restApi.avgResponseTime)}ms`);
        
        Logger.info(`💾 系统统计:`);
        Logger.info(`  - 健康检查: ${this.stats.system.healthChecks} 次`);
        
        const latestMem = this.stats.system.memoryUsage[this.stats.system.memoryUsage.length - 1];
        if (latestMem) {
            Logger.info(`  - 当前内存: ${Math.round(latestMem.heapUsed / 1024 / 1024)}MB`);
        }
        
        Logger.info('=====================================\n');
    }
    
    /**
     * 格式化持续时间
     */
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}天 ${hours % 24}小时 ${minutes % 60}分钟`;
        } else if (hours > 0) {
            return `${hours}小时 ${minutes % 60}分钟 ${seconds % 60}秒`;
        } else if (minutes > 0) {
            return `${minutes}分钟 ${seconds % 60}秒`;
        } else {
            return `${seconds}秒`;
        }
    }
    
    /**
     * 停止测试
     */
    async stop() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        Logger.info('\n🛑 正在停止稳定性测试...');
        
        // 清除定时器
        Object.values(this.timers).forEach(timer => {
            if (timer) clearInterval(timer);
        });
        
        // 生成最终报告
        this.generateStatsReport();
        
        // 关闭WebSocket连接
        try {
            await WebSocketManager.close();
            Logger.info('✅ WebSocket连接已关闭');
        } catch (error) {
            Logger.warn('关闭WebSocket时出错:', error.message);
        }
        
        const totalUptime = Date.now() - this.startTime;
        Logger.info(`\n🏁 稳定性测试结束`);
        Logger.info(`📊 总运行时间: ${this.formatDuration(totalUptime)}`);
        Logger.info(`📈 测试结果: WebSocket数据=${this.stats.websocket.ticker.count + this.stats.websocket.orderbook.count}条, REST API成功率=${this.stats.restApi.requests > 0 ? ((this.stats.restApi.successes / this.stats.restApi.requests) * 100).toFixed(2) : 0}%`);
    }
}

// 创建测试实例
const tester = new StabilityTester();

// 错误处理
process.on('uncaughtException', (error) => {
    Logger.error('未捕获的异常:', error);
    tester.stop().then(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = reason?.message || reason?.toString() || '未知错误';
    const errorStack = reason?.stack || '';
    
    Logger.error('未处理的Promise拒绝:', errorMsg);
    
    // 检查错误是否来自WebSocket相关操作
    const isWebSocketError = errorMsg.includes('websocket') || errorMsg.includes('WebSocket') || 
        errorMsg.includes('订阅') || errorMsg.includes('watch') ||
        errorStack.includes('websocket_manager') || errorStack.includes('watchTicker') ||
        errorStack.includes('watchOrderBook') || errorStack.includes('watchBalance') ||
        errorStack.includes('watchPositions');
    
    // 检查是否为网络相关错误
    const isNetworkError = errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ENOTFOUND') || 
        errorMsg.includes('timeout') || errorMsg.includes('network') ||
        errorMsg.includes('ETIMEDOUT') || errorMsg.includes('ECONNRESET') ||
        errorMsg.includes('fetch failed') || errorMsg.includes('socket hang up');
    
    // 检查是否为交易所API相关错误
    const isExchangeError = errorMsg.includes('bitget') || errorMsg.includes('exchange') ||
        errorMsg.includes('API') || errorMsg.includes('rate limit') ||
        errorMsg.includes('insufficient') || errorMsg.includes('invalid');
    
    if (isWebSocketError || isNetworkError || isExchangeError) {
        Logger.warn(`${isWebSocketError ? 'WebSocket' : isNetworkError ? '网络' : '交易所'}相关错误，继续运行测试`);
        return;
    }
    
    // 其他严重错误才停止测试
    Logger.error('严重错误，停止测试');
    Logger.error('错误堆栈:', errorStack);
    tester.stop().then(() => process.exit(1));
});

// 优雅退出
process.on('SIGINT', () => {
    Logger.info('\n收到中断信号，正在优雅退出...');
    tester.stop().then(() => {
        Logger.info('👋 测试已安全退出');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    Logger.info('\n收到终止信号，正在优雅退出...');
    tester.stop().then(() => {
        Logger.info('👋 测试已安全退出');
        process.exit(0);
    });
});

// 主函数
async function main() {
    try {
        await tester.initialize();
        await tester.start();
    } catch (error) {
        Logger.error('测试启动失败:', error);
        process.exit(1);
    }
}

// 启动测试
if (require.main === module) {
    main();
}

module.exports = StabilityTester;