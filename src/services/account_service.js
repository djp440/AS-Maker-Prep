const { EventEmitter } = require('events');
const WebSocketManager = require('./websocket_manager');
const ExchangeService = require('./exchange_service');
const Logger = require('../shared/logger');
const { getTimestamp } = require('../shared/utils');

/**
 * @class AccountService
 * @description 账户服务类，监听WebSocketManager的私有数据事件，维护账户状态
 * 提供账户余额、持仓、订单等信息的统一访问接口
 */
class AccountService extends EventEmitter {
    /**
     * @private
     * @type {AccountService | null}
     */
    static instance = null;

    /**
     * @private
     * @type {WebSocketManager}
     */
    wsManager = null;

    /**
     * @private
     * @type {ExchangeService}
     */
    exchangeService = null;

    /**
     * @private
     * @type {object}
     * @description 账户余额信息
     */
    balance = {};

    /**
     * @private
     * @type {Map<string, object>}
     * @description 持仓信息，key为交易对符号
     */
    positions = new Map();

    /**
     * @private
     * @type {Map<string, object>}
     * @description 活动订单信息，key为订单ID
     */
    openOrders = new Map();

    /**
     * @private
     * @type {boolean}
     */
    isInitialized = false;

    /**
     * @private
     * @type {number}
     */
    lastSyncTime = 0;

    /**
     * @private
     * @type {number}
     */
    syncInterval = 30000; // 30秒同步一次全量数据

    /**
     * @private
     * @constructor
     */
    constructor() {
        super();
        // 私有构造函数，防止外部实例化
    }

    /**
     * @description 获取AccountService的单例实例
     * @returns {AccountService}
     */
    static getInstance() {
        if (!AccountService.instance) {
            AccountService.instance = new AccountService();
        }
        return AccountService.instance;
    }

    /**
     * @description 初始化账户服务
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            Logger.info('初始化账户服务...');

            // 获取服务实例
            this.wsManager = WebSocketManager;
            this.exchangeService = ExchangeService;

            // 检查依赖服务是否已初始化
            if (!this.exchangeService.isInitialized()) {
                throw new Error('ExchangeService未初始化，请先初始化ExchangeService');
            }

            // 绑定WebSocket事件监听器
            this.bindWebSocketEvents();

            // 执行初始全量数据同步
            await this.syncFullData();

            this.isInitialized = true;
            Logger.info('账户服务初始化完成');

            // 发射初始化完成事件
            this.emit('initialized');

        } catch (error) {
            Logger.error('账户服务初始化失败:', error);
            throw error;
        }
    }

    /**
     * @description 绑定WebSocket事件监听器
     * @private
     */
    bindWebSocketEvents() {
        // 监听余额变化
        this.wsManager.on('balance', (event) => {
            this.handleBalanceUpdate(event.data);
        });

        // 监听订单变化
        this.wsManager.on('orders', (event) => {
            this.handleOrdersUpdate(event.data);
        });

        // 监听持仓变化
        this.wsManager.on('positions', (event) => {
            this.handlePositionsUpdate(event.data);
        });

        // 监听WebSocket重连事件，重连后需要重新同步数据
        this.wsManager.on('reconnected', async () => {
            Logger.info('WebSocket重连成功，重新同步账户数据');
            await this.syncFullData();
        });

        Logger.info('WebSocket事件监听器绑定完成');
    }

    /**
     * @description 处理余额更新事件
     * @private
     * @param {object} balanceData - 余额数据
     */
    handleBalanceUpdate(balanceData) {
        try {
            this.balance = balanceData;
            this.lastSyncTime = getTimestamp();
            
            Logger.debug('余额更新:', {
                timestamp: this.lastSyncTime,
                totalEquity: this.getTotalEquity()
            });

            // 发射余额更新事件
            this.emit('balanceUpdated', this.balance);

        } catch (error) {
            Logger.error('处理余额更新失败:', error);
        }
    }

    /**
     * @description 处理订单更新事件
     * @private
     * @param {Array} ordersData - 订单数据数组
     */
    handleOrdersUpdate(ordersData) {
        try {
            // 更新活动订单映射
            ordersData.forEach(order => {
                if (order.status === 'open' || order.status === 'partial') {
                    this.openOrders.set(order.id, order);
                } else {
                    // 订单已完成或取消，从活动订单中移除
                    this.openOrders.delete(order.id);
                }
            });

            this.lastSyncTime = getTimestamp();
            
            Logger.debug('订单更新:', {
                timestamp: this.lastSyncTime,
                openOrdersCount: this.openOrders.size
            });

            // 发射订单更新事件
            this.emit('ordersUpdated', Array.from(this.openOrders.values()));

        } catch (error) {
            Logger.error('处理订单更新失败:', error);
        }
    }

    /**
     * @description 处理持仓更新事件
     * @private
     * @param {Array} positionsData - 持仓数据数组
     */
    handlePositionsUpdate(positionsData) {
        try {
            // 更新持仓映射
            positionsData.forEach(position => {
                if (position.contracts > 0) {
                    this.positions.set(position.symbol, position);
                } else {
                    // 持仓为0，从持仓映射中移除
                    this.positions.delete(position.symbol);
                }
            });

            this.lastSyncTime = getTimestamp();
            
            Logger.debug('持仓更新:', {
                timestamp: this.lastSyncTime,
                positionsCount: this.positions.size
            });

            // 发射持仓更新事件
            this.emit('positionsUpdated', Array.from(this.positions.values()));

        } catch (error) {
            Logger.error('处理持仓更新失败:', error);
        }
    }

    /**
     * @description 通过REST API进行全量数据同步
     * @returns {Promise<void>}
     */
    async syncFullData() {
        try {
            Logger.info('开始全量数据同步...');

            // 并行获取所有数据
            const [balance, positions, openOrders] = await Promise.all([
                this.exchangeService.fetchBalance(),
                this.exchangeService.fetchPositions(),
                this.exchangeService.fetchOpenOrders()
            ]);

            // 更新余额
            this.balance = balance;

            // 更新持仓
            this.positions.clear();
            positions.forEach(position => {
                if (position.contracts > 0) {
                    this.positions.set(position.symbol, position);
                }
            });

            // 更新活动订单
            this.openOrders.clear();
            openOrders.forEach(order => {
                if (order.status === 'open' || order.status === 'partial') {
                    this.openOrders.set(order.id, order);
                }
            });

            this.lastSyncTime = getTimestamp();
            
            Logger.info('全量数据同步完成:', {
                timestamp: this.lastSyncTime,
                totalEquity: this.getTotalEquity(),
                positionsCount: this.positions.size,
                openOrdersCount: this.openOrders.size
            });

            // 发射数据同步完成事件
            this.emit('dataSynced', {
                balance: this.balance,
                positions: Array.from(this.positions.values()),
                openOrders: Array.from(this.openOrders.values())
            });

        } catch (error) {
            Logger.error('全量数据同步失败:', error);
            throw error;
        }
    }

    /**
     * @description 获取总资产价值
     * @returns {number} 总资产价值（USDT）
     */
    getTotalEquity() {
        try {
            if (!this.balance || !this.balance.info) {
                return 0;
            }

            // 根据交易所返回的数据结构获取总资产
            // Bitget的余额结构可能包含total字段
            if (this.balance.info.totalEquity) {
                return parseFloat(this.balance.info.totalEquity);
            }

            // 如果没有totalEquity字段，尝试计算USDT余额
            if (this.balance.USDT && this.balance.USDT.total) {
                return this.balance.USDT.total;
            }

            // 兜底：返回0
            return 0;

        } catch (error) {
            Logger.error('获取总资产失败:', error);
            return 0;
        }
    }

    /**
     * @description 获取指定交易对的持仓信息
     * @param {string} symbol - 交易对符号
     * @returns {object|null} 持仓信息，如果没有持仓则返回null
     */
    getPosition(symbol) {
        return this.positions.get(symbol) || null;
    }

    /**
     * @description 获取指定交易对的活动订单
     * @param {string} [symbol] - 交易对符号，不传则返回所有活动订单
     * @returns {Array} 活动订单列表
     */
    getOpenOrders(symbol = undefined) {
        const allOrders = Array.from(this.openOrders.values());
        
        if (symbol) {
            return allOrders.filter(order => order.symbol === symbol);
        }
        
        return allOrders;
    }

    /**
     * @description 计算标准化库存（核心计算方法）
     * @param {string} symbol - 交易对符号
     * @returns {number} 标准化库存值，范围[-1, 1]，正值表示多头，负值表示空头
     */
    getNormalizedInventory(symbol) {
        try {
            const position = this.getPosition(symbol);
            
            if (!position) {
                return 0; // 无持仓
            }

            // 获取持仓大小和方向
            const size = Math.abs(position.contracts || 0);
            const side = position.side; // 'long' 或 'short'
            
            if (size === 0) {
                return 0;
            }

            // 这里需要根据具体的风险管理策略来计算标准化库存
            // 简单实现：基于持仓价值占总资产的比例
            const totalEquity = this.getTotalEquity();
            if (totalEquity === 0) {
                return 0;
            }

            // 计算持仓价值
            const positionValue = size * (position.markPrice || position.entryPrice || 0);
            
            // 计算标准化库存（持仓价值 / 总资产）
            let normalizedInventory = positionValue / totalEquity;
            
            // 限制在[-1, 1]范围内
            normalizedInventory = Math.max(-1, Math.min(1, normalizedInventory));
            
            // 根据持仓方向调整符号
            if (side === 'short') {
                normalizedInventory = -normalizedInventory;
            }

            return normalizedInventory;

        } catch (error) {
            Logger.error(`计算标准化库存失败 ${symbol}:`, error);
            return 0;
        }
    }

    /**
     * @description 获取所有持仓信息
     * @returns {Array} 持仓信息列表
     */
    getAllPositions() {
        return Array.from(this.positions.values());
    }

    /**
     * @description 获取账户余额信息
     * @returns {object} 余额信息
     */
    getBalance() {
        return this.balance;
    }

    /**
     * @description 检查服务是否已初始化
     * @returns {boolean}
     */
    isServiceInitialized() {
        return this.isInitialized;
    }

    /**
     * @description 获取最后同步时间
     * @returns {number} 时间戳
     */
    getLastSyncTime() {
        return this.lastSyncTime;
    }

    /**
     * @description 手动触发数据同步
     * @returns {Promise<void>}
     */
    async forceSyncData() {
        await this.syncFullData();
    }

    /**
     * @description 启动定期数据同步
     * @private
     */
    startPeriodicSync() {
        setInterval(async () => {
            try {
                const now = getTimestamp();
                if (now - this.lastSyncTime > this.syncInterval) {
                    Logger.debug('执行定期数据同步');
                    await this.syncFullData();
                }
            } catch (error) {
                Logger.error('定期数据同步失败:', error);
            }
        }, this.syncInterval);
    }

    /**
     * @description 清理资源
     */
    cleanup() {
        try {
            // 移除所有事件监听器
            this.wsManager.removeAllListeners('balance');
            this.wsManager.removeAllListeners('orders');
            this.wsManager.removeAllListeners('positions');
            this.wsManager.removeAllListeners('reconnected');

            // 清空数据
            this.balance = {};
            this.positions.clear();
            this.openOrders.clear();

            this.isInitialized = false;
            Logger.info('账户服务资源清理完成');

        } catch (error) {
            Logger.error('账户服务资源清理失败:', error);
        }
    }
}

module.exports = AccountService.getInstance();