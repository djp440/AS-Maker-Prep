const { EventEmitter } = require('events');
const Logger = require('../shared/logger');
const Config = require('../shared/config');

/**
 * @class AlertManager
 * @description 告警管理器，负责处理系统告警、风险提醒和通知发送
 * 支持多种告警级别和通知渠道（当前主要通过日志，未来可扩展）
 */
class AlertManager extends EventEmitter {
    /**
     * @private
     * @type {AlertManager | null}
     */
    static instance = null;

    /**
     * @private
     * @type {Object}
     */
    alertConfig = {
        // 告警级别
        levels: {
            INFO: 'info',
            WARNING: 'warning', 
            ERROR: 'error',
            CRITICAL: 'critical'
        },
        
        // 告警频率限制（防止告警轰炸）
        rateLimits: {
            INFO: 60000,      // 1分钟
            WARNING: 300000,  // 5分钟
            ERROR: 600000,    // 10分钟
            CRITICAL: 0       // 不限制
        },
        
        // 告警阈值
        thresholds: {
            reconnectCount: 5,        // 重连次数阈值
            errorRate: 10,            // 错误率阈值（%）
            dataLatency: 5000,        // 数据延迟阈值（毫秒）
            apiFailureCount: 3,       // API连续失败次数
            inventoryUtilization: 0.8 // 库存利用率阈值
        }
    };

    /**
     * @private
     * @type {Map<string, number>}
     */
    lastAlertTimes = new Map();

    /**
     * @private
     * @type {Array<Object>}
     */
    alertHistory = [];

    /**
     * @private
     * @type {Object}
     */
    alertStats = {
        totalAlerts: 0,
        criticalAlerts: 0,
        errorAlerts: 0,
        warningAlerts: 0,
        infoAlerts: 0
    };

    /**
     * @private
     * @constructor
     */
    constructor() {
        super();
    }

    /**
     * @description 获取AlertManager的单例实例
     * @returns {AlertManager}
     */
    static getInstance() {
        if (!AlertManager.instance) {
            AlertManager.instance = new AlertManager();
        }
        return AlertManager.instance;
    }

    /**
     * @description 初始化告警管理器
     * @param {Object} config - 告警配置
     */
    initialize(config = {}) {
        // 合并配置
        this.alertConfig = {
            ...this.alertConfig,
            ...config,
            thresholds: { ...this.alertConfig.thresholds, ...(config.thresholds || {}) },
            rateLimits: { ...this.alertConfig.rateLimits, ...(config.rateLimits || {}) }
        };
        
        Logger.info('[AlertManager] 告警管理器初始化完成');
    }

    /**
     * @description 发送告警
     * @param {string} level - 告警级别 (INFO, WARNING, ERROR, CRITICAL)
     * @param {string} title - 告警标题
     * @param {string} message - 告警消息
     * @param {Object} metadata - 附加元数据
     * @returns {boolean} 是否成功发送告警
     */
    sendAlert(level, title, message, metadata = {}) {
        try {
            // 验证告警级别
            if (!Object.values(this.alertConfig.levels).includes(level)) {
                Logger.error(`[AlertManager] 无效的告警级别: ${level}`);
                return false;
            }

            // 检查频率限制
            const alertKey = `${level}_${title}`;
            if (!this.checkRateLimit(alertKey, level)) {
                Logger.debug(`[AlertManager] 告警被频率限制阻止: ${alertKey}`);
                return false;
            }

            // 创建告警记录
            const alert = {
                id: this.generateAlertId(),
                timestamp: Date.now(),
                level,
                title,
                message,
                metadata,
                resolved: false
            };

            // 记录告警
            this.recordAlert(alert);

            // 发送告警通知
            this.deliverAlert(alert);

            // 发出告警事件
            this.emit('alert', alert);

            return true;

        } catch (error) {
            Logger.error('[AlertManager] 发送告警失败:', error);
            return false;
        }
    }

    /**
     * @description 发送连接相关告警
     * @param {string} type - 告警类型
     * @param {Object} data - 告警数据
     */
    sendConnectionAlert(type, data) {
        switch (type) {
            case 'websocket_disconnected':
                this.sendAlert(
                    this.alertConfig.levels.ERROR,
                    'WebSocket连接断开',
                    `WebSocket连接意外断开，重连次数: ${data.reconnectCount || 0}`,
                    { type: 'connection', ...data }
                );
                break;

            case 'websocket_reconnect_failed':
                this.sendAlert(
                    this.alertConfig.levels.CRITICAL,
                    'WebSocket重连失败',
                    `WebSocket重连失败，已尝试 ${data.attempts} 次`,
                    { type: 'connection', ...data }
                );
                break;

            case 'api_unavailable':
                this.sendAlert(
                    this.alertConfig.levels.ERROR,
                    'API不可用',
                    `交易所API不可用: ${data.error?.message || '未知错误'}`,
                    { type: 'api', ...data }
                );
                break;

            case 'data_latency_high':
                this.sendAlert(
                    this.alertConfig.levels.WARNING,
                    '数据延迟过高',
                    `数据延迟 ${data.latency}ms 超过阈值 ${this.alertConfig.thresholds.dataLatency}ms`,
                    { type: 'performance', ...data }
                );
                break;

            case 'connection_quality_poor':
                this.sendAlert(
                    this.alertConfig.levels.WARNING,
                    '连接质量较差',
                    `连接质量下降，错误率: ${data.errorRate}%`,
                    { type: 'quality', ...data }
                );
                break;

            default:
                Logger.warn(`[AlertManager] 未知的连接告警类型: ${type}`);
        }
    }

    /**
     * @description 发送交易相关告警
     * @param {string} type - 告警类型
     * @param {Object} data - 告警数据
     */
    sendTradingAlert(type, data) {
        switch (type) {
            case 'inventory_limit_exceeded':
                this.sendAlert(
                    this.alertConfig.levels.CRITICAL,
                    '库存限制超出',
                    `库存水平 ${data.currentInventory} 超过限制 ${data.maxInventory}`,
                    { type: 'trading', ...data }
                );
                break;

            case 'inventory_utilization_high':
                this.sendAlert(
                    this.alertConfig.levels.WARNING,
                    '库存利用率过高',
                    `库存利用率 ${(data.utilization * 100).toFixed(2)}% 超过阈值 ${(this.alertConfig.thresholds.inventoryUtilization * 100)}%`,
                    { type: 'trading', ...data }
                );
                break;

            case 'half_spread_anomaly':
                this.sendAlert(
                    this.alertConfig.levels.WARNING,
                    '半价差异常',
                    `半价差计算异常: ${data.halfSpread}，可能影响报价策略`,
                    { type: 'trading', ...data }
                );
                break;

            case 'skew_calculation_error':
                this.sendAlert(
                    this.alertConfig.levels.ERROR,
                    '偏度计算错误',
                    `库存偏度计算出现错误: ${data.error?.message || '未知错误'}`,
                    { type: 'trading', ...data }
                );
                break;

            case 'order_execution_failed':
                this.sendAlert(
                    this.alertConfig.levels.ERROR,
                    '订单执行失败',
                    `订单执行失败: ${data.error?.message || '未知错误'}`,
                    { type: 'trading', ...data }
                );
                break;

            case 'balance_insufficient':
                this.sendAlert(
                    this.alertConfig.levels.CRITICAL,
                    '余额不足',
                    `账户余额不足，无法继续交易: ${data.balance}`,
                    { type: 'trading', ...data }
                );
                break;

            default:
                Logger.warn(`[AlertManager] 未知的交易告警类型: ${type}`);
        }
    }

    /**
     * @description 发送系统相关告警
     * @param {string} type - 告警类型
     * @param {Object} data - 告警数据
     */
    sendSystemAlert(type, data) {
        switch (type) {
            case 'authentication_failed':
                this.sendAlert(
                    this.alertConfig.levels.CRITICAL,
                    '认证失败',
                    `API认证失败: ${data.error?.message || '未知错误'}`,
                    { type: 'system', ...data }
                );
                break;

            case 'startup_validation_failed':
                this.sendAlert(
                    this.alertConfig.levels.CRITICAL,
                    '启动验证失败',
                    `程序启动验证失败: ${data.error?.message || '未知错误'}`,
                    { type: 'system', ...data }
                );
                break;

            case 'uncaught_exception':
                this.sendAlert(
                    this.alertConfig.levels.CRITICAL,
                    '未捕获异常',
                    `发生未捕获异常，可能导致程序退出: ${data.error?.message || '未知错误'}`,
                    { type: 'system', ...data }
                );
                break;

            case 'memory_usage_high':
                this.sendAlert(
                    this.alertConfig.levels.WARNING,
                    '内存使用率过高',
                    `内存使用率 ${data.memoryUsage}% 超过阈值`,
                    { type: 'system', ...data }
                );
                break;

            case 'disk_space_low':
                this.sendAlert(
                    this.alertConfig.levels.WARNING,
                    '磁盘空间不足',
                    `磁盘剩余空间 ${data.freeSpace} 低于阈值`,
                    { type: 'system', ...data }
                );
                break;

            default:
                Logger.warn(`[AlertManager] 未知的系统告警类型: ${type}`);
        }
    }

    /**
     * @description 检查频率限制
     * @private
     * @param {string} alertKey - 告警键
     * @param {string} level - 告警级别
     * @returns {boolean} 是否允许发送
     */
    checkRateLimit(alertKey, level) {
        const now = Date.now();
        const lastTime = this.lastAlertTimes.get(alertKey);
        const rateLimit = this.alertConfig.rateLimits[level.toUpperCase()];

        if (rateLimit === 0) {
            // 不限制频率
            this.lastAlertTimes.set(alertKey, now);
            return true;
        }

        if (!lastTime || (now - lastTime) >= rateLimit) {
            this.lastAlertTimes.set(alertKey, now);
            return true;
        }

        return false;
    }

    /**
     * @description 记录告警
     * @private
     * @param {Object} alert - 告警对象
     */
    recordAlert(alert) {
        // 添加到历史记录
        this.alertHistory.push(alert);

        // 限制历史记录大小
        if (this.alertHistory.length > 1000) {
            this.alertHistory.shift();
        }

        // 更新统计
        this.alertStats.totalAlerts++;
        switch (alert.level) {
            case this.alertConfig.levels.CRITICAL:
                this.alertStats.criticalAlerts++;
                break;
            case this.alertConfig.levels.ERROR:
                this.alertStats.errorAlerts++;
                break;
            case this.alertConfig.levels.WARNING:
                this.alertStats.warningAlerts++;
                break;
            case this.alertConfig.levels.INFO:
                this.alertStats.infoAlerts++;
                break;
        }
    }

    /**
     * @description 发送告警通知
     * @private
     * @param {Object} alert - 告警对象
     */
    deliverAlert(alert) {
        // 当前版本通过日志发送告警
        const logMessage = `[ALERT-${alert.level.toUpperCase()}] ${alert.title}: ${alert.message}`;
        const logMetadata = alert.metadata ? ` | 元数据: ${JSON.stringify(alert.metadata)}` : '';
        
        switch (alert.level) {
            case this.alertConfig.levels.CRITICAL:
            case this.alertConfig.levels.ERROR:
                Logger.error(logMessage + logMetadata);
                break;
            case this.alertConfig.levels.WARNING:
                Logger.warn(logMessage + logMetadata);
                break;
            case this.alertConfig.levels.INFO:
            default:
                Logger.info(logMessage + logMetadata);
                break;
        }

        // 未来可以在这里添加其他通知渠道
        // 例如：钉钉机器人、Telegram Bot、邮件等
        // this.sendToDingTalk(alert);
        // this.sendToTelegram(alert);
        // this.sendEmail(alert);
    }

    /**
     * @description 生成告警ID
     * @private
     * @returns {string} 告警ID
     */
    generateAlertId() {
        return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * @description 解决告警
     * @param {string} alertId - 告警ID
     * @param {string} resolution - 解决方案描述
     */
    resolveAlert(alertId, resolution = '') {
        const alert = this.alertHistory.find(a => a.id === alertId);
        if (alert) {
            alert.resolved = true;
            alert.resolvedAt = Date.now();
            alert.resolution = resolution;
            
            Logger.info(`[AlertManager] 告警已解决: ${alert.title} | 解决方案: ${resolution}`);
            this.emit('alertResolved', alert);
        }
    }

    /**
     * @description 获取告警历史
     * @param {Object} filters - 过滤条件
     * @param {string} filters.level - 告警级别
     * @param {number} filters.since - 起始时间戳
     * @param {number} filters.limit - 限制数量
     * @returns {Array<Object>} 告警历史
     */
    getAlertHistory(filters = {}) {
        let alerts = [...this.alertHistory];

        // 按级别过滤
        if (filters.level) {
            alerts = alerts.filter(alert => alert.level === filters.level);
        }

        // 按时间过滤
        if (filters.since) {
            alerts = alerts.filter(alert => alert.timestamp >= filters.since);
        }

        // 按解决状态过滤
        if (filters.resolved !== undefined) {
            alerts = alerts.filter(alert => alert.resolved === filters.resolved);
        }

        // 限制数量
        if (filters.limit) {
            alerts = alerts.slice(-filters.limit);
        }

        return alerts.sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * @description 获取告警统计
     * @returns {Object} 告警统计
     */
    getAlertStats() {
        const recentAlerts = this.getAlertHistory({ since: Date.now() - 24 * 60 * 60 * 1000 }); // 最近24小时
        
        return {
            ...this.alertStats,
            recent24h: {
                total: recentAlerts.length,
                critical: recentAlerts.filter(a => a.level === this.alertConfig.levels.CRITICAL).length,
                error: recentAlerts.filter(a => a.level === this.alertConfig.levels.ERROR).length,
                warning: recentAlerts.filter(a => a.level === this.alertConfig.levels.WARNING).length,
                info: recentAlerts.filter(a => a.level === this.alertConfig.levels.INFO).length
            },
            unresolved: this.alertHistory.filter(a => !a.resolved).length
        };
    }

    /**
     * @description 清理过期告警
     * @param {number} maxAge - 最大保留时间（毫秒）
     */
    cleanupOldAlerts(maxAge = 7 * 24 * 60 * 60 * 1000) { // 默认7天
        const cutoffTime = Date.now() - maxAge;
        const initialCount = this.alertHistory.length;
        
        this.alertHistory = this.alertHistory.filter(alert => alert.timestamp > cutoffTime);
        
        const removedCount = initialCount - this.alertHistory.length;
        if (removedCount > 0) {
            Logger.info(`[AlertManager] 清理了 ${removedCount} 条过期告警记录`);
        }
    }

    /**
     * @description 重置告警统计
     */
    resetStats() {
        this.alertStats = {
            totalAlerts: 0,
            criticalAlerts: 0,
            errorAlerts: 0,
            warningAlerts: 0,
            infoAlerts: 0
        };
        
        Logger.info('[AlertManager] 告警统计已重置');
    }

    /**
     * @description 获取配置
     * @returns {Object} 当前配置
     */
    getConfig() {
        return { ...this.alertConfig };
    }

    /**
     * @description 更新配置
     * @param {Object} newConfig - 新配置
     */
    updateConfig(newConfig) {
        this.alertConfig = {
            ...this.alertConfig,
            ...newConfig,
            thresholds: { ...this.alertConfig.thresholds, ...(newConfig.thresholds || {}) },
            rateLimits: { ...this.alertConfig.rateLimits, ...(newConfig.rateLimits || {}) }
        };
        
        Logger.info('[AlertManager] 配置已更新');
    }

    /**
     * @description 销毁告警管理器
     */
    destroy() {
        this.removeAllListeners();
        this.alertHistory = [];
        this.lastAlertTimes.clear();
        AlertManager.instance = null;
        
        Logger.info('[AlertManager] 告警管理器已销毁');
    }
}

module.exports = AlertManager.getInstance();