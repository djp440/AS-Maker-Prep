const { EventEmitter } = require('events');
const Logger = require('../shared/logger');
const Config = require('../shared/config');

/**
 * @class MetricsCollector
 * @description 指标收集器，负责收集和记录系统性能、交易和GLFT特有指标
 * 支持实时指标更新、定期报告和历史数据存储
 */
class MetricsCollector extends EventEmitter {
    /**
     * @private
     * @type {MetricsCollector | null}
     */
    static instance = null;

    /**
     * @private
     * @type {Object}
     */
    metrics = {
        // 交易指标
        trading: {
            totalTrades: 0,
            totalVolume: 0,
            totalBuyVolume: 0,
            totalSellVolume: 0,
            pnl: 0,
            realizedPnl: 0,
            unrealizedPnl: 0,
            feesPaid: 0,
            avgTradeSize: 0,
            lastTradeTime: null,
            tradeHistory: [] // 最近的交易记录
        },

        // 性能指标
        performance: {
            apiCallCount: 0,
            apiErrorCount: 0,
            apiSuccessRate: 100,
            apiResponseTimes: [], // 最近的响应时间
            avgApiResponseTime: 0,
            orderFillRate: 100,
            orderFillCount: 0,
            orderTotalCount: 0,
            lastApiCallTime: null
        },

        // GLFT特有指标
        glft: {
            inventoryLimitTriggers: 0,
            halfSpreadHistory: [], // 半价差历史
            avgHalfSpread: 0,
            skewHistory: [], // 偏度历史
            avgSkew: 0,
            inventoryUtilization: 0,
            maxInventoryReached: 0,
            currentInventory: 0,
            inventoryHistory: [], // 库存历史
            quotingTime: 0, // 报价时间统计
            quotingCount: 0
        },

        // 连接指标
        connection: {
            wsConnectionTime: 0,
            wsReconnectCount: 0,
            wsMessageCount: 0,
            wsLastMessageTime: null,
            apiConnectionTime: 0,
            dataLatencyHistory: [], // 数据延迟历史
            avgDataLatency: 0
        },

        // 系统指标
        system: {
            startTime: Date.now(),
            uptime: 0,
            memoryUsage: 0,
            cpuUsage: 0,
            errorCount: 0,
            warningCount: 0,
            lastErrorTime: null
        }
    };

    /**
     * @private
     * @type {Object}
     */
    collectorConfig = {
        // 历史数据保留数量
        historyLimits: {
            tradeHistory: 100,
            apiResponseTimes: 50,
            halfSpreadHistory: 100,
            skewHistory: 100,
            inventoryHistory: 200,
            dataLatencyHistory: 50
        },
        
        // 报告间隔
        reportIntervals: {
            realtime: 60000,    // 1分钟实时报告
            summary: 3600000,   // 1小时汇总报告
            daily: 86400000     // 24小时日报
        },
        
        // 指标计算窗口
        calculationWindows: {
            avgResponseTime: 20,
            avgHalfSpread: 50,
            avgSkew: 50,
            avgDataLatency: 30
        }
    };

    /**
     * @private
     * @type {Object}
     */
    timers = {
        realtimeReport: null,
        summaryReport: null,
        dailyReport: null,
        systemMetrics: null
    };

    /**
     * @private
     * @type {Array<Object>}
     */
    reportHistory = [];

    /**
     * @private
     * @constructor
     */
    constructor() {
        super();
    }

    /**
     * @description 获取MetricsCollector的单例实例
     * @returns {MetricsCollector}
     */
    static getInstance() {
        if (!MetricsCollector.instance) {
            MetricsCollector.instance = new MetricsCollector();
        }
        return MetricsCollector.instance;
    }

    /**
     * @description 初始化指标收集器
     * @param {Object} config - 收集器配置
     */
    initialize(config = {}) {
        // 合并配置
        this.collectorConfig = {
            ...this.collectorConfig,
            ...config,
            historyLimits: { ...this.collectorConfig.historyLimits, ...(config.historyLimits || {}) },
            reportIntervals: { ...this.collectorConfig.reportIntervals, ...(config.reportIntervals || {}) },
            calculationWindows: { ...this.collectorConfig.calculationWindows, ...(config.calculationWindows || {}) }
        };

        // 启动定期报告
        this.startPeriodicReporting();
        
        // 启动系统指标收集
        this.startSystemMetricsCollection();

        Logger.info('[MetricsCollector] 指标收集器初始化完成');
    }

    /**
     * @description 启动定期报告
     * @private
     */
    startPeriodicReporting() {
        // 实时报告
        this.timers.realtimeReport = setInterval(() => {
            this.generateRealtimeReport();
        }, this.collectorConfig.reportIntervals.realtime);

        // 汇总报告
        this.timers.summaryReport = setInterval(() => {
            this.generateSummaryReport();
        }, this.collectorConfig.reportIntervals.summary);

        // 日报
        this.timers.dailyReport = setInterval(() => {
            this.generateDailyReport();
        }, this.collectorConfig.reportIntervals.daily);

        Logger.info('[MetricsCollector] 定期报告已启动');
    }

    /**
     * @description 启动系统指标收集
     * @private
     */
    startSystemMetricsCollection() {
        this.timers.systemMetrics = setInterval(() => {
            this.collectSystemMetrics();
        }, 30000); // 每30秒收集一次系统指标
    }

    /**
     * @description 收集系统指标
     * @private
     */
    collectSystemMetrics() {
        try {
            // 更新运行时间
            this.metrics.system.uptime = Date.now() - this.metrics.system.startTime;

            // 收集内存使用情况
            const memUsage = process.memoryUsage();
            this.metrics.system.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024); // MB

            // 发出系统指标事件
            this.emit('systemMetrics', {
                uptime: this.metrics.system.uptime,
                memoryUsage: this.metrics.system.memoryUsage,
                timestamp: Date.now()
            });

        } catch (error) {
            Logger.error('[MetricsCollector] 收集系统指标失败:', error);
        }
    }

    /**
     * @description 记录交易指标
     * @param {Object} tradeData - 交易数据
     * @param {string} tradeData.symbol - 交易对
     * @param {string} tradeData.side - 交易方向 (buy/sell)
     * @param {number} tradeData.amount - 交易数量
     * @param {number} tradeData.price - 交易价格
     * @param {number} tradeData.fee - 手续费
     * @param {number} tradeData.pnl - 盈亏
     */
    recordTrade(tradeData) {
        try {
            const { symbol, side, amount, price, fee = 0, pnl = 0 } = tradeData;
            const volume = amount * price;
            const timestamp = Date.now();

            // 更新交易指标
            this.metrics.trading.totalTrades++;
            this.metrics.trading.totalVolume += volume;
            this.metrics.trading.feesPaid += fee;
            this.metrics.trading.lastTradeTime = timestamp;

            if (side === 'buy') {
                this.metrics.trading.totalBuyVolume += volume;
            } else if (side === 'sell') {
                this.metrics.trading.totalSellVolume += volume;
            }

            // 更新PnL
            if (pnl !== 0) {
                this.metrics.trading.pnl += pnl;
                this.metrics.trading.realizedPnl += pnl;
            }

            // 计算平均交易大小
            this.metrics.trading.avgTradeSize = 
                this.metrics.trading.totalVolume / this.metrics.trading.totalTrades;

            // 添加到交易历史
            const tradeRecord = {
                timestamp,
                symbol,
                side,
                amount,
                price,
                volume,
                fee,
                pnl
            };

            this.addToHistory('tradeHistory', tradeRecord);

            Logger.debug(`[MetricsCollector] 记录交易: ${side} ${amount} ${symbol} @ ${price}`);
            this.emit('tradeRecorded', tradeRecord);

        } catch (error) {
            Logger.error('[MetricsCollector] 记录交易指标失败:', error);
        }
    }

    /**
     * @description 记录API调用指标
     * @param {Object} apiData - API调用数据
     * @param {boolean} apiData.success - 是否成功
     * @param {number} apiData.responseTime - 响应时间（毫秒）
     * @param {string} apiData.method - API方法
     * @param {Error} apiData.error - 错误对象（如果失败）
     */
    recordApiCall(apiData) {
        try {
            const { success, responseTime, method, error } = apiData;
            const timestamp = Date.now();

            // 更新API调用指标
            this.metrics.performance.apiCallCount++;
            this.metrics.performance.lastApiCallTime = timestamp;

            if (success) {
                // 记录响应时间
                if (responseTime !== undefined) {
                    this.addToHistory('apiResponseTimes', responseTime);
                    this.calculateAverageResponseTime();
                }
            } else {
                this.metrics.performance.apiErrorCount++;
            }

            // 计算成功率
            this.metrics.performance.apiSuccessRate = 
                ((this.metrics.performance.apiCallCount - this.metrics.performance.apiErrorCount) / 
                 this.metrics.performance.apiCallCount) * 100;

            Logger.debug(`[MetricsCollector] 记录API调用: ${method} - ${success ? '成功' : '失败'}`);
            
            this.emit('apiCallRecorded', {
                timestamp,
                success,
                responseTime,
                method,
                error: error?.message
            });

        } catch (error) {
            Logger.error('[MetricsCollector] 记录API调用指标失败:', error);
        }
    }

    /**
     * @description 记录订单执行指标
     * @param {Object} orderData - 订单数据
     * @param {boolean} orderData.filled - 是否成交
     * @param {string} orderData.orderId - 订单ID
     * @param {number} orderData.fillTime - 成交时间（毫秒）
     */
    recordOrderExecution(orderData) {
        try {
            const { filled, orderId, fillTime } = orderData;

            this.metrics.performance.orderTotalCount++;
            
            if (filled) {
                this.metrics.performance.orderFillCount++;
            }

            // 计算成交率
            this.metrics.performance.orderFillRate = 
                (this.metrics.performance.orderFillCount / 
                 this.metrics.performance.orderTotalCount) * 100;

            Logger.debug(`[MetricsCollector] 记录订单执行: ${orderId} - ${filled ? '成交' : '未成交'}`);
            
            this.emit('orderExecutionRecorded', {
                timestamp: Date.now(),
                filled,
                orderId,
                fillTime
            });

        } catch (error) {
            Logger.error('[MetricsCollector] 记录订单执行指标失败:', error);
        }
    }

    /**
     * @description 记录GLFT半价差指标
     * @param {number} halfSpread - 半价差值
     */
    recordHalfSpread(halfSpread) {
        try {
            if (typeof halfSpread !== 'number' || isNaN(halfSpread)) {
                Logger.warn('[MetricsCollector] 无效的半价差值:', halfSpread);
                return;
            }

            this.addToHistory('halfSpreadHistory', halfSpread);
            this.calculateAverageHalfSpread();

            Logger.debug(`[MetricsCollector] 记录半价差: ${halfSpread}`);
            
            this.emit('halfSpreadRecorded', {
                timestamp: Date.now(),
                halfSpread,
                avgHalfSpread: this.metrics.glft.avgHalfSpread
            });

        } catch (error) {
            Logger.error('[MetricsCollector] 记录半价差指标失败:', error);
        }
    }

    /**
     * @description 记录GLFT偏度指标
     * @param {number} skew - 偏度值
     */
    recordSkew(skew) {
        try {
            if (typeof skew !== 'number' || isNaN(skew)) {
                Logger.warn('[MetricsCollector] 无效的偏度值:', skew);
                return;
            }

            this.addToHistory('skewHistory', skew);
            this.calculateAverageSkew();

            Logger.debug(`[MetricsCollector] 记录偏度: ${skew}`);
            
            this.emit('skewRecorded', {
                timestamp: Date.now(),
                skew,
                avgSkew: this.metrics.glft.avgSkew
            });

        } catch (error) {
            Logger.error('[MetricsCollector] 记录偏度指标失败:', error);
        }
    }

    /**
     * @description 记录库存指标
     * @param {Object} inventoryData - 库存数据
     * @param {number} inventoryData.currentInventory - 当前库存
     * @param {number} inventoryData.maxInventory - 最大库存限制
     * @param {boolean} inventoryData.limitTriggered - 是否触发限制
     */
    recordInventory(inventoryData) {
        try {
            const { currentInventory, maxInventory, limitTriggered = false } = inventoryData;

            this.metrics.glft.currentInventory = currentInventory;
            
            // 更新最大库存记录
            if (Math.abs(currentInventory) > Math.abs(this.metrics.glft.maxInventoryReached)) {
                this.metrics.glft.maxInventoryReached = Math.abs(currentInventory);
            }

            // 计算库存利用率
            if (maxInventory > 0) {
                this.metrics.glft.inventoryUtilization = Math.abs(currentInventory) / maxInventory;
            }

            // 记录库存限制触发
            if (limitTriggered) {
                this.metrics.glft.inventoryLimitTriggers++;
            }

            // 添加到库存历史
            this.addToHistory('inventoryHistory', {
                timestamp: Date.now(),
                inventory: currentInventory,
                utilization: this.metrics.glft.inventoryUtilization,
                limitTriggered
            });

            Logger.debug(`[MetricsCollector] 记录库存: ${currentInventory}, 利用率: ${(this.metrics.glft.inventoryUtilization * 100).toFixed(2)}%`);
            
            this.emit('inventoryRecorded', {
                timestamp: Date.now(),
                currentInventory,
                utilization: this.metrics.glft.inventoryUtilization,
                limitTriggered
            });

        } catch (error) {
            Logger.error('[MetricsCollector] 记录库存指标失败:', error);
        }
    }

    /**
     * @description 记录报价指标
     * @param {number} quotingTime - 报价耗时（毫秒）
     */
    recordQuoting(quotingTime) {
        try {
            this.metrics.glft.quotingCount++;
            this.metrics.glft.quotingTime += quotingTime;

            Logger.debug(`[MetricsCollector] 记录报价: 耗时 ${quotingTime}ms`);
            
            this.emit('quotingRecorded', {
                timestamp: Date.now(),
                quotingTime,
                avgQuotingTime: this.metrics.glft.quotingTime / this.metrics.glft.quotingCount
            });

        } catch (error) {
            Logger.error('[MetricsCollector] 记录报价指标失败:', error);
        }
    }

    /**
     * @description 记录连接指标
     * @param {Object} connectionData - 连接数据
     * @param {string} connectionData.type - 连接类型 (websocket/api)
     * @param {number} connectionData.latency - 延迟（毫秒）
     * @param {boolean} connectionData.reconnect - 是否为重连
     */
    recordConnection(connectionData) {
        try {
            const { type, latency, reconnect = false } = connectionData;
            const timestamp = Date.now();

            if (type === 'websocket') {
                this.metrics.connection.wsMessageCount++;
                this.metrics.connection.wsLastMessageTime = timestamp;
                
                if (reconnect) {
                    this.metrics.connection.wsReconnectCount++;
                }
            }

            if (latency !== undefined) {
                this.addToHistory('dataLatencyHistory', latency);
                this.calculateAverageDataLatency();
            }

            Logger.debug(`[MetricsCollector] 记录连接指标: ${type}, 延迟: ${latency}ms`);
            
            this.emit('connectionRecorded', {
                timestamp,
                type,
                latency,
                reconnect
            });

        } catch (error) {
            Logger.error('[MetricsCollector] 记录连接指标失败:', error);
        }
    }

    /**
     * @description 记录错误指标
     * @param {string} level - 错误级别 (error/warning)
     */
    recordError(level = 'error') {
        try {
            const timestamp = Date.now();
            
            if (level === 'error') {
                this.metrics.system.errorCount++;
                this.metrics.system.lastErrorTime = timestamp;
            } else if (level === 'warning') {
                this.metrics.system.warningCount++;
            }

            this.emit('errorRecorded', {
                timestamp,
                level,
                totalErrors: this.metrics.system.errorCount,
                totalWarnings: this.metrics.system.warningCount
            });

        } catch (error) {
            Logger.error('[MetricsCollector] 记录错误指标失败:', error);
        }
    }

    /**
     * @description 添加数据到历史记录
     * @private
     * @param {string} historyKey - 历史记录键
     * @param {*} data - 数据
     */
    addToHistory(historyKey, data) {
        const category = this.getHistoryCategory(historyKey);
        if (!category) return;

        const history = this.metrics[category][historyKey];
        const limit = this.collectorConfig.historyLimits[historyKey];

        history.push(data);
        
        if (history.length > limit) {
            history.shift();
        }
    }

    /**
     * @description 获取历史记录所属类别
     * @private
     * @param {string} historyKey - 历史记录键
     * @returns {string|null} 类别名称
     */
    getHistoryCategory(historyKey) {
        for (const [category, metrics] of Object.entries(this.metrics)) {
            if (metrics[historyKey]) {
                return category;
            }
        }
        return null;
    }

    /**
     * @description 计算平均响应时间
     * @private
     */
    calculateAverageResponseTime() {
        const times = this.metrics.performance.apiResponseTimes;
        const window = this.collectorConfig.calculationWindows.avgResponseTime;
        const recentTimes = times.slice(-window);
        
        if (recentTimes.length > 0) {
            this.metrics.performance.avgApiResponseTime = 
                recentTimes.reduce((sum, time) => sum + time, 0) / recentTimes.length;
        }
    }

    /**
     * @description 计算平均半价差
     * @private
     */
    calculateAverageHalfSpread() {
        const spreads = this.metrics.glft.halfSpreadHistory;
        const window = this.collectorConfig.calculationWindows.avgHalfSpread;
        const recentSpreads = spreads.slice(-window);
        
        if (recentSpreads.length > 0) {
            this.metrics.glft.avgHalfSpread = 
                recentSpreads.reduce((sum, spread) => sum + spread, 0) / recentSpreads.length;
        }
    }

    /**
     * @description 计算平均偏度
     * @private
     */
    calculateAverageSkew() {
        const skews = this.metrics.glft.skewHistory;
        const window = this.collectorConfig.calculationWindows.avgSkew;
        const recentSkews = skews.slice(-window);
        
        if (recentSkews.length > 0) {
            this.metrics.glft.avgSkew = 
                recentSkews.reduce((sum, skew) => sum + skew, 0) / recentSkews.length;
        }
    }

    /**
     * @description 计算平均数据延迟
     * @private
     */
    calculateAverageDataLatency() {
        const latencies = this.metrics.connection.dataLatencyHistory;
        const window = this.collectorConfig.calculationWindows.avgDataLatency;
        const recentLatencies = latencies.slice(-window);
        
        if (recentLatencies.length > 0) {
            this.metrics.connection.avgDataLatency = 
                recentLatencies.reduce((sum, latency) => sum + latency, 0) / recentLatencies.length;
        }
    }

    /**
     * @description 生成实时报告
     * @private
     */
    generateRealtimeReport() {
        try {
            const report = {
                type: 'realtime',
                timestamp: Date.now(),
                period: '1分钟',
                trading: {
                    totalTrades: this.metrics.trading.totalTrades,
                    totalVolume: this.metrics.trading.totalVolume.toFixed(4),
                    avgTradeSize: this.metrics.trading.avgTradeSize.toFixed(4),
                    pnl: this.metrics.trading.pnl.toFixed(4)
                },
                performance: {
                    apiSuccessRate: this.metrics.performance.apiSuccessRate.toFixed(2) + '%',
                    avgResponseTime: Math.round(this.metrics.performance.avgApiResponseTime) + 'ms',
                    orderFillRate: this.metrics.performance.orderFillRate.toFixed(2) + '%'
                },
                glft: {
                    avgHalfSpread: this.metrics.glft.avgHalfSpread.toFixed(6),
                    avgSkew: this.metrics.glft.avgSkew.toFixed(6),
                    inventoryUtilization: (this.metrics.glft.inventoryUtilization * 100).toFixed(2) + '%',
                    currentInventory: this.metrics.glft.currentInventory
                }
            };

            Logger.info('[MetricsCollector] 实时指标报告:', JSON.stringify(report, null, 2));
            this.emit('realtimeReport', report);
            
            return report;

        } catch (error) {
            Logger.error('[MetricsCollector] 生成实时报告失败:', error);
        }
    }

    /**
     * @description 生成汇总报告
     * @private
     */
    generateSummaryReport() {
        try {
            const report = {
                type: 'summary',
                timestamp: Date.now(),
                period: '1小时',
                summary: {
                    uptime: Math.round(this.metrics.system.uptime / 1000 / 60) + '分钟',
                    totalTrades: this.metrics.trading.totalTrades,
                    totalVolume: this.metrics.trading.totalVolume.toFixed(4),
                    totalFees: this.metrics.trading.feesPaid.toFixed(4),
                    pnl: this.metrics.trading.pnl.toFixed(4),
                    apiCalls: this.metrics.performance.apiCallCount,
                    apiErrors: this.metrics.performance.apiErrorCount,
                    wsReconnects: this.metrics.connection.wsReconnectCount,
                    inventoryTriggers: this.metrics.glft.inventoryLimitTriggers,
                    systemErrors: this.metrics.system.errorCount
                }
            };

            Logger.info('[MetricsCollector] 汇总指标报告:', JSON.stringify(report, null, 2));
            this.emit('summaryReport', report);
            
            // 保存到报告历史
            this.reportHistory.push(report);
            if (this.reportHistory.length > 24) { // 保留24小时的汇总报告
                this.reportHistory.shift();
            }
            
            return report;

        } catch (error) {
            Logger.error('[MetricsCollector] 生成汇总报告失败:', error);
        }
    }

    /**
     * @description 生成日报
     * @private
     */
    generateDailyReport() {
        try {
            const report = {
                type: 'daily',
                timestamp: Date.now(),
                period: '24小时',
                performance: {
                    uptime: Math.round(this.metrics.system.uptime / 1000 / 60 / 60) + '小时',
                    totalTrades: this.metrics.trading.totalTrades,
                    totalVolume: this.metrics.trading.totalVolume.toFixed(4),
                    buyVolume: this.metrics.trading.totalBuyVolume.toFixed(4),
                    sellVolume: this.metrics.trading.totalSellVolume.toFixed(4),
                    realizedPnl: this.metrics.trading.realizedPnl.toFixed(4),
                    totalFees: this.metrics.trading.feesPaid.toFixed(4),
                    avgTradeSize: this.metrics.trading.avgTradeSize.toFixed(4)
                },
                quality: {
                    apiSuccessRate: this.metrics.performance.apiSuccessRate.toFixed(2) + '%',
                    orderFillRate: this.metrics.performance.orderFillRate.toFixed(2) + '%',
                    avgApiResponseTime: Math.round(this.metrics.performance.avgApiResponseTime) + 'ms',
                    avgDataLatency: Math.round(this.metrics.connection.avgDataLatency) + 'ms'
                },
                glft: {
                    avgHalfSpread: this.metrics.glft.avgHalfSpread.toFixed(6),
                    avgSkew: this.metrics.glft.avgSkew.toFixed(6),
                    maxInventoryReached: this.metrics.glft.maxInventoryReached,
                    inventoryLimitTriggers: this.metrics.glft.inventoryLimitTriggers,
                    quotingCount: this.metrics.glft.quotingCount,
                    avgQuotingTime: this.metrics.glft.quotingCount > 0 ? 
                        Math.round(this.metrics.glft.quotingTime / this.metrics.glft.quotingCount) + 'ms' : '0ms'
                },
                issues: {
                    wsReconnects: this.metrics.connection.wsReconnectCount,
                    apiErrors: this.metrics.performance.apiErrorCount,
                    systemErrors: this.metrics.system.errorCount,
                    warnings: this.metrics.system.warningCount
                }
            };

            Logger.info('[MetricsCollector] 日度指标报告:', JSON.stringify(report, null, 2));
            this.emit('dailyReport', report);
            
            return report;

        } catch (error) {
            Logger.error('[MetricsCollector] 生成日报失败:', error);
        }
    }

    /**
     * @description 获取当前指标
     * @returns {Object} 当前指标
     */
    getCurrentMetrics() {
        return JSON.parse(JSON.stringify(this.metrics));
    }

    /**
     * @description 获取指标摘要
     * @returns {Object} 指标摘要
     */
    getMetricsSummary() {
        return {
            trading: {
                totalTrades: this.metrics.trading.totalTrades,
                totalVolume: this.metrics.trading.totalVolume,
                pnl: this.metrics.trading.pnl,
                avgTradeSize: this.metrics.trading.avgTradeSize
            },
            performance: {
                apiSuccessRate: this.metrics.performance.apiSuccessRate,
                orderFillRate: this.metrics.performance.orderFillRate,
                avgApiResponseTime: this.metrics.performance.avgApiResponseTime
            },
            glft: {
                avgHalfSpread: this.metrics.glft.avgHalfSpread,
                avgSkew: this.metrics.glft.avgSkew,
                inventoryUtilization: this.metrics.glft.inventoryUtilization,
                inventoryLimitTriggers: this.metrics.glft.inventoryLimitTriggers
            },
            system: {
                uptime: this.metrics.system.uptime,
                errorCount: this.metrics.system.errorCount,
                memoryUsage: this.metrics.system.memoryUsage
            }
        };
    }

    /**
     * @description 重置指标
     * @param {Array<string>} categories - 要重置的类别，不指定则重置所有
     */
    resetMetrics(categories = null) {
        const categoriesToReset = categories || Object.keys(this.metrics);
        
        categoriesToReset.forEach(category => {
            if (this.metrics[category]) {
                // 保留一些不应重置的字段
                const preserveFields = ['startTime'];
                const preserved = {};
                
                preserveFields.forEach(field => {
                    if (this.metrics[category][field] !== undefined) {
                        preserved[field] = this.metrics[category][field];
                    }
                });
                
                // 重置类别
                this.initializeCategory(category);
                
                // 恢复保留字段
                Object.assign(this.metrics[category], preserved);
            }
        });
        
        Logger.info(`[MetricsCollector] 指标已重置: ${categoriesToReset.join(', ')}`);
    }

    /**
     * @description 初始化指标类别
     * @private
     * @param {string} category - 类别名称
     */
    initializeCategory(category) {
        switch (category) {
            case 'trading':
                this.metrics.trading = {
                    totalTrades: 0,
                    totalVolume: 0,
                    totalBuyVolume: 0,
                    totalSellVolume: 0,
                    pnl: 0,
                    realizedPnl: 0,
                    unrealizedPnl: 0,
                    feesPaid: 0,
                    avgTradeSize: 0,
                    lastTradeTime: null,
                    tradeHistory: []
                };
                break;
            case 'performance':
                this.metrics.performance = {
                    apiCallCount: 0,
                    apiErrorCount: 0,
                    apiSuccessRate: 100,
                    apiResponseTimes: [],
                    avgApiResponseTime: 0,
                    orderFillRate: 100,
                    orderFillCount: 0,
                    orderTotalCount: 0,
                    lastApiCallTime: null
                };
                break;
            case 'glft':
                this.metrics.glft = {
                    inventoryLimitTriggers: 0,
                    halfSpreadHistory: [],
                    avgHalfSpread: 0,
                    skewHistory: [],
                    avgSkew: 0,
                    inventoryUtilization: 0,
                    maxInventoryReached: 0,
                    currentInventory: 0,
                    inventoryHistory: [],
                    quotingTime: 0,
                    quotingCount: 0
                };
                break;
            case 'connection':
                this.metrics.connection = {
                    wsConnectionTime: 0,
                    wsReconnectCount: 0,
                    wsMessageCount: 0,
                    wsLastMessageTime: null,
                    apiConnectionTime: 0,
                    dataLatencyHistory: [],
                    avgDataLatency: 0
                };
                break;
            case 'system':
                this.metrics.system = {
                    startTime: Date.now(),
                    uptime: 0,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    errorCount: 0,
                    warningCount: 0,
                    lastErrorTime: null
                };
                break;
        }
    }

    /**
     * @description 停止指标收集
     */
    stop() {
        // 清除所有定时器
        Object.values(this.timers).forEach(timer => {
            if (timer) {
                clearInterval(timer);
            }
        });
        
        this.timers = {
            realtimeReport: null,
            summaryReport: null,
            dailyReport: null,
            systemMetrics: null
        };
        
        Logger.info('[MetricsCollector] 指标收集已停止');
    }

    /**
     * @description 销毁指标收集器
     */
    destroy() {
        this.stop();
        this.removeAllListeners();
        this.reportHistory = [];
        MetricsCollector.instance = null;
        
        Logger.info('[MetricsCollector] 指标收集器已销毁');
    }
}

module.exports = MetricsCollector.getInstance();