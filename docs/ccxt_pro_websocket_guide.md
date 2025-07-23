# CCXT Pro WebSocket 使用指南 - Bitget 交易所

## 概述

本文档详细说明如何使用 CCXT Pro 框架通过 WebSocket 从 Bitget 交易所获取实时数据。CCXT Pro 是 CCXT 的专业版本，提供了 WebSocket 流式数据支持。

## 前置条件

### 1. 安装 CCXT（包含 Pro 功能）

CCXT Pro 已经与 CCXT 合并，现在可以免费使用 WebSocket 功能：

```bash
# 安装 CCXT（包含 Pro 功能）
cnpm install ccxt
```

### 2. 基本导入

```javascript
// 导入 CCXT Pro 功能
const ccxt = require('ccxt').pro;

// 创建 Bitget 交易所实例
const exchange = new ccxt.bitget({
    'apiKey': 'YOUR_API_KEY',        // 可选，用于私有数据
    'secret': 'YOUR_SECRET',         // 可选，用于私有数据
    'password': 'YOUR_PASSPHRASE',   // 可选，用于私有数据
    'sandbox': false,                // Bitget 没有沙盒环境
    'enableRateLimit': true,
});
```

## 公共数据获取

### 1. 订单簿数据 (Order Book)

```javascript
/**
 * 获取实时订单簿数据
 * @param {string} symbol - 交易对符号，如 'BTC/USDT'
 * @param {number} limit - 订单簿深度限制
 */
async function watchOrderBook(symbol, limit = 20) {
    try {
        while (true) {
            const orderbook = await exchange.watchOrderBook(symbol, limit);
            console.log('订单簿更新:', {
                symbol: orderbook.symbol,
                timestamp: orderbook.timestamp,
                bids: orderbook.bids.slice(0, 5), // 显示前5档买单
                asks: orderbook.asks.slice(0, 5), // 显示前5档卖单
            });
        }
    } catch (error) {
        console.error('订单簿监听错误:', error);
    }
}

// 使用示例
watchOrderBook('BTC/USDT');
```

### 2. 实时价格数据 (Ticker)

```javascript
/**
 * 获取实时价格数据
 * @param {string} symbol - 交易对符号
 */
async function watchTicker(symbol) {
    try {
        while (true) {
            const ticker = await exchange.watchTicker(symbol);
            console.log('价格更新:', {
                symbol: ticker.symbol,
                last: ticker.last,      // 最新价格
                bid: ticker.bid,        // 买一价
                ask: ticker.ask,        // 卖一价
                volume: ticker.baseVolume, // 24h成交量
                change: ticker.change,  // 24h涨跌幅
                timestamp: ticker.timestamp
            });
        }
    } catch (error) {
        console.error('价格监听错误:', error);
    }
}

// 使用示例
watchTicker('BTC/USDT');
```

### 3. 实时交易数据 (Trades)

```javascript
/**
 * 获取实时交易数据
 * @param {string} symbol - 交易对符号
 */
async function watchTrades(symbol) {
    try {
        while (true) {
            const trades = await exchange.watchTrades(symbol);
            // trades 是一个数组，包含最新的交易记录
            const latestTrade = trades[trades.length - 1];
            console.log('最新交易:', {
                symbol: latestTrade.symbol,
                price: latestTrade.price,
                amount: latestTrade.amount,
                side: latestTrade.side, // 'buy' 或 'sell'
                timestamp: latestTrade.timestamp
            });
        }
    } catch (error) {
        console.error('交易数据监听错误:', error);
    }
}

// 使用示例
watchTrades('BTC/USDT');
```

### 4. K线数据 (OHLCV)

```javascript
/**
 * 获取实时K线数据
 * @param {string} symbol - 交易对符号
 * @param {string} timeframe - 时间周期，如 '1m', '5m', '1h', '1d'
 */
async function watchOHLCV(symbol, timeframe = '1m') {
    try {
        while (true) {
            const ohlcvs = await exchange.watchOHLCV(symbol, timeframe);
            const latestCandle = ohlcvs[ohlcvs.length - 1];
            console.log('最新K线:', {
                symbol: symbol,
                timeframe: timeframe,
                timestamp: latestCandle[0],
                open: latestCandle[1],
                high: latestCandle[2],
                low: latestCandle[3],
                close: latestCandle[4],
                volume: latestCandle[5]
            });
        }
    } catch (error) {
        console.error('K线数据监听错误:', error);
    }
}

// 使用示例
watchOHLCV('BTC/USDT', '1m');
```

## 私有数据获取

### 1. 账户余额

```javascript
/**
 * 监听账户余额变化
 */
async function watchBalance() {
    try {
        while (true) {
            const balance = await exchange.watchBalance();
            console.log('余额更新:', {
                timestamp: balance.timestamp,
                free: balance.free,     // 可用余额
                used: balance.used,     // 冻结余额
                total: balance.total    // 总余额
            });
        }
    } catch (error) {
        console.error('余额监听错误:', error);
    }
}

// 使用示例（需要API密钥）
watchBalance();
```

### 2. 订单状态

```javascript
/**
 * 监听订单状态变化
 */
async function watchOrders(symbol = undefined) {
    try {
        while (true) {
            const orders = await exchange.watchOrders(symbol);
            orders.forEach(order => {
                console.log('订单更新:', {
                    id: order.id,
                    symbol: order.symbol,
                    side: order.side,
                    amount: order.amount,
                    price: order.price,
                    status: order.status,
                    filled: order.filled,
                    remaining: order.remaining,
                    timestamp: order.timestamp
                });
            });
        }
    } catch (error) {
        console.error('订单监听错误:', error);
    }
}

// 使用示例（需要API密钥）
watchOrders('BTC/USDT');
```

### 3. 持仓信息

```javascript
/**
 * 监听持仓变化（适用于期货交易）
 */
async function watchPositions(symbols = undefined) {
    try {
        while (true) {
            const positions = await exchange.watchPositions(symbols);
            positions.forEach(position => {
                if (position.contracts > 0) { // 只显示有持仓的
                    console.log('持仓更新:', {
                        symbol: position.symbol,
                        side: position.side,
                        size: position.contracts,
                        entryPrice: position.entryPrice,
                        markPrice: position.markPrice,
                        unrealizedPnl: position.unrealizedPnl,
                        percentage: position.percentage,
                        timestamp: position.timestamp
                    });
                }
            });
        }
    } catch (error) {
        console.error('持仓监听错误:', error);
    }
}

// 使用示例（需要API密钥）
watchPositions();
```

## 多数据流管理

### 1. 同时监听多个数据流

```javascript
/**
 * 同时监听多个数据流的示例
 */
class BitgetDataManager {
    constructor(apiKey, secret, password) {
        this.exchange = new ccxtpro.bitget({
            'apiKey': apiKey,
            'secret': secret,
            'password': password,
            'sandbox': false,
            'enableRateLimit': true,
        });
        this.isRunning = false;
    }

    /**
     * 启动所有数据流
     * @param {string} symbol - 交易对符号
     */
    async start(symbol) {
        this.isRunning = true;
        
        // 并行启动多个数据流
        const promises = [
            this.watchOrderBookLoop(symbol),
            this.watchTickerLoop(symbol),
            this.watchTradesLoop(symbol),
            this.watchBalanceLoop(),
            this.watchOrdersLoop(symbol)
        ];

        try {
            await Promise.all(promises);
        } catch (error) {
            console.error('数据流错误:', error);
        }
    }

    /**
     * 停止所有数据流
     */
    stop() {
        this.isRunning = false;
    }

    async watchOrderBookLoop(symbol) {
        while (this.isRunning) {
            try {
                const orderbook = await this.exchange.watchOrderBook(symbol);
                this.onOrderBookUpdate(orderbook);
            } catch (error) {
                console.error('订单簿错误:', error);
                await this.sleep(1000);
            }
        }
    }

    async watchTickerLoop(symbol) {
        while (this.isRunning) {
            try {
                const ticker = await this.exchange.watchTicker(symbol);
                this.onTickerUpdate(ticker);
            } catch (error) {
                console.error('价格错误:', error);
                await this.sleep(1000);
            }
        }
    }

    async watchTradesLoop(symbol) {
        while (this.isRunning) {
            try {
                const trades = await this.exchange.watchTrades(symbol);
                this.onTradesUpdate(trades);
            } catch (error) {
                console.error('交易数据错误:', error);
                await this.sleep(1000);
            }
        }
    }

    async watchBalanceLoop() {
        while (this.isRunning) {
            try {
                const balance = await this.exchange.watchBalance();
                this.onBalanceUpdate(balance);
            } catch (error) {
                console.error('余额错误:', error);
                await this.sleep(1000);
            }
        }
    }

    async watchOrdersLoop(symbol) {
        while (this.isRunning) {
            try {
                const orders = await this.exchange.watchOrders(symbol);
                this.onOrdersUpdate(orders);
            } catch (error) {
                console.error('订单错误:', error);
                await this.sleep(1000);
            }
        }
    }

    // 事件处理方法
    onOrderBookUpdate(orderbook) {
        console.log('订单簿更新:', orderbook.symbol, orderbook.timestamp);
    }

    onTickerUpdate(ticker) {
        console.log('价格更新:', ticker.symbol, ticker.last);
    }

    onTradesUpdate(trades) {
        console.log('交易更新:', trades.length, '笔新交易');
    }

    onBalanceUpdate(balance) {
        console.log('余额更新:', balance.timestamp);
    }

    onOrdersUpdate(orders) {
        console.log('订单更新:', orders.length, '个订单');
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 使用示例
const dataManager = new BitgetDataManager('your_api_key', 'your_secret', 'your_password');
dataManager.start('BTC/USDT');
```

## 错误处理和重连机制

### 1. 基本错误处理

```javascript
/**
 * 带有错误处理的数据监听
 */
async function robustWatchOrderBook(symbol, maxRetries = 5) {
    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            while (true) {
                const orderbook = await exchange.watchOrderBook(symbol);
                console.log('订单簿:', orderbook.symbol, orderbook.timestamp);
                retries = 0; // 重置重试计数
            }
        } catch (error) {
            retries++;
            console.error(`连接错误 (${retries}/${maxRetries}):`, error.message);
            
            if (retries >= maxRetries) {
                console.error('达到最大重试次数，停止监听');
                break;
            }
            
            // 等待后重试
            const delay = Math.min(1000 * Math.pow(2, retries), 30000); // 指数退避
            console.log(`${delay}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
```

### 2. 连接状态监控

```javascript
/**
 * 监控WebSocket连接状态
 */
class ConnectionMonitor {
    constructor(exchange) {
        this.exchange = exchange;
        this.lastHeartbeat = Date.now();
        this.heartbeatInterval = 30000; // 30秒心跳检查
        this.startHeartbeat();
    }

    startHeartbeat() {
        setInterval(() => {
            const now = Date.now();
            if (now - this.lastHeartbeat > this.heartbeatInterval * 2) {
                console.warn('WebSocket连接可能已断开');
                this.handleDisconnection();
            }
        }, this.heartbeatInterval);
    }

    updateHeartbeat() {
        this.lastHeartbeat = Date.now();
    }

    handleDisconnection() {
        console.log('尝试重新连接...');
        // 这里可以添加重连逻辑
    }
}
```

## 性能优化建议

### 1. 数据缓存

```javascript
/**
 * 带缓存的数据管理器
 */
class CachedDataManager {
    constructor() {
        this.cache = {
            orderbooks: new Map(),
            tickers: new Map(),
            trades: new Map()
        };
        this.cacheTimeout = 5000; // 5秒缓存超时
    }

    /**
     * 获取缓存的订单簿数据
     */
    getCachedOrderBook(symbol) {
        const cached = this.cache.orderbooks.get(symbol);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    /**
     * 缓存订单簿数据
     */
    setCachedOrderBook(symbol, orderbook) {
        this.cache.orderbooks.set(symbol, {
            data: orderbook,
            timestamp: Date.now()
        });
    }
}
```

### 2. 数据压缩和过滤

```javascript
/**
 * 数据过滤器
 */
class DataFilter {
    constructor() {
        this.lastPrices = new Map();
        this.priceChangeThreshold = 0.001; // 0.1% 价格变化阈值
    }

    /**
     * 过滤价格变化
     */
    shouldUpdatePrice(symbol, newPrice) {
        const lastPrice = this.lastPrices.get(symbol);
        if (!lastPrice) {
            this.lastPrices.set(symbol, newPrice);
            return true;
        }

        const changePercent = Math.abs((newPrice - lastPrice) / lastPrice);
        if (changePercent >= this.priceChangeThreshold) {
            this.lastPrices.set(symbol, newPrice);
            return true;
        }

        return false;
    }
}
```

## 注意事项

### 1. API限制
- Bitget 对 WebSocket 连接数有限制
- 建议合理控制订阅的数据流数量
- 使用 `enableRateLimit: true` 避免触发限制

### 2. 网络稳定性
- WebSocket 连接可能因网络问题断开
- 实现自动重连机制
- 使用心跳检测监控连接状态

### 3. 数据处理
- WebSocket 数据是实时的，处理速度要跟上
- 考虑使用队列缓冲高频数据
- 避免在数据处理中执行耗时操作

### 4. 内存管理
- 长时间运行需要注意内存泄漏
- 定期清理过期的缓存数据
- 监控内存使用情况

## 完整示例

```javascript
const ccxt = require('ccxt').pro;

// 完整的 Bitget WebSocket 数据获取示例
class BitgetWebSocketClient {
    constructor(config = {}) {
        this.exchange = new ccxt.bitget({
            'apiKey': config.apiKey,
            'secret': config.secret,
            'password': config.password,
            'sandbox': false,
            'enableRateLimit': true,
            ...config
        });
        
        this.isRunning = false;
        this.subscribers = new Map();
    }

    /**
     * 启动WebSocket客户端
     */
    async start() {
        this.isRunning = true;
        console.log('Bitget WebSocket 客户端已启动');
    }

    /**
     * 停止WebSocket客户端
     */
    async stop() {
        this.isRunning = false;
        await this.exchange.close();
        console.log('Bitget WebSocket 客户端已停止');
    }

    /**
     * 订阅订单簿数据
     */
    async subscribeOrderBook(symbol, callback) {
        const key = `orderbook_${symbol}`;
        this.subscribers.set(key, callback);
        
        this.watchData('orderbook', symbol, callback);
    }

    /**
     * 订阅价格数据
     */
    async subscribeTicker(symbol, callback) {
        const key = `ticker_${symbol}`;
        this.subscribers.set(key, callback);
        
        this.watchData('ticker', symbol, callback);
    }

    /**
     * 通用数据监听方法
     */
    async watchData(type, symbol, callback) {
        while (this.isRunning) {
            try {
                let data;
                switch (type) {
                    case 'orderbook':
                        data = await this.exchange.watchOrderBook(symbol);
                        break;
                    case 'ticker':
                        data = await this.exchange.watchTicker(symbol);
                        break;
                    case 'trades':
                        data = await this.exchange.watchTrades(symbol);
                        break;
                    default:
                        throw new Error(`不支持的数据类型: ${type}`);
                }
                
                if (callback && typeof callback === 'function') {
                    callback(data);
                }
            } catch (error) {
                console.error(`${type} 数据监听错误:`, error);
                await this.sleep(1000);
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 使用示例
async function main() {
    const client = new BitgetWebSocketClient({
        // apiKey: 'your_api_key',
        // secret: 'your_secret',
        // password: 'your_password'
    });

    await client.start();

    // 订阅BTC/USDT订单簿
    client.subscribeOrderBook('BTC/USDT', (orderbook) => {
        console.log('BTC/USDT 订单簿更新:', {
            timestamp: new Date(orderbook.timestamp).toISOString(),
            bestBid: orderbook.bids[0],
            bestAsk: orderbook.asks[0]
        });
    });

    // 订阅ETH/USDT价格
    client.subscribeTicker('ETH/USDT', (ticker) => {
        console.log('ETH/USDT 价格更新:', {
            price: ticker.last,
            change: ticker.change,
            volume: ticker.baseVolume
        });
    });

    // 优雅关闭
    process.on('SIGINT', async () => {
        console.log('\n正在关闭客户端...');
        await client.stop();
        process.exit(0);
    });
}

// 运行示例
if (require.main === module) {
    main().catch(console.error);
}

module.exports = BitgetWebSocketClient;
```

## 总结

使用 CCXT Pro 通过 WebSocket 从 Bitget 获取数据的关键点：

1. **正确安装和配置** CCXT Pro
2. **合理的错误处理**和重连机制
3. **高效的数据处理**和缓存策略
4. **监控连接状态**和性能指标
5. **遵循API限制**和最佳实践

通过本指南，您应该能够成功实现从 Bitget 交易所获取实时数据的功能。记住要根据实际需求调整代码，并始终关注性能和稳定性。