const Trader = require('./src/core/trader');
const Logger = require('./src/shared/logger');
const Config = require('./src/shared/config');

/**
 * 测试新的订单更新逻辑
 */
class OrderUpdateLogicTest {
    constructor() {
        this.testResults = [];
    }

    /**
     * 运行所有测试
     */
    async runAllTests() {
        console.log('🧪 开始测试订单更新逻辑...');
        
        try {
            await this.testShouldUpdateQuotesLogic();
            await this.testOrderTypeLogic();
            await this.testTradeSideRestrictions();
            
            this.printTestResults();
        } catch (error) {
            console.error('❌ 测试过程中发生错误:', error);
        }
    }

    /**
     * 测试订单更新触发逻辑
     */
    async testShouldUpdateQuotesLogic() {
        console.log('\n📋 测试订单更新触发逻辑...');
        
        // 模拟配置
        const config = {
            HALF_SPREAD_PCT: 0.0004,
            TRADE_SIDE: 'long'
        };
        
        // 创建模拟的 Trader 实例
        const trader = {
            symbol: 'BTC/USDT:USDT',
            config: config,
            lastQuotes: null,
            lastPosition: null,
            networkRecoveryManager: {
                wasRecentlyRecovered: () => false
            },
            getCurrentInventory: () => 0,
            accountService: {
                getPosition: () => ({ contracts: 0, side: null })
            }
        };
        
        // 绑定方法
        trader.shouldUpdateQuotes = Trader.prototype.shouldUpdateQuotes.bind(trader);
        
        // 测试1: 首次启动应该触发更新
        const marketData1 = { midPrice: 50000 };
        const result1 = trader.shouldUpdateQuotes(marketData1);
        this.addTestResult('首次启动触发', result1 === true, `期望: true, 实际: ${result1}`);
        
        // 设置初始报价
        trader.lastQuotes = {
            bidPrice: 49980,
            askPrice: 50020
        };
        trader.lastPosition = { contracts: 0, side: null };
        
        // 测试2: 持仓变化应该触发更新
        trader.accountService.getPosition = () => ({ contracts: 0.01, side: 'long' });
        const result2 = trader.shouldUpdateQuotes(marketData1);
        this.addTestResult('持仓变化触发', result2 === true, `期望: true, 实际: ${result2}`);
        
        // 测试3: 价格大幅偏离且无库存应该触发追单
        trader.lastPosition = { contracts: 0.01, side: 'long' };
        trader.getCurrentInventory = () => 0; // 无库存
        const marketData3 = { midPrice: 50100 }; // 价格上涨，偏离买单较远
        const result3 = trader.shouldUpdateQuotes(marketData3);
        this.addTestResult('追单逻辑触发', result3 === true, `期望: true, 实际: ${result3}`);
        
        // 测试4: 正常情况下不应该频繁更新
        trader.getCurrentInventory = () => 0.005; // 有少量库存
        const marketData4 = { midPrice: 50010 }; // 价格小幅变动
        const result4 = trader.shouldUpdateQuotes(marketData4);
        this.addTestResult('正常情况不频繁更新', result4 === false, `期望: false, 实际: ${result4}`);
    }

    /**
     * 测试订单类型判断逻辑
     */
    async testOrderTypeLogic() {
        console.log('\n📋 测试订单类型判断逻辑...');
        
        const trader = {
            determineBuyOrderType: Trader.prototype.determineBuyOrderType,
            determineSellOrderType: Trader.prototype.determineSellOrderType
        };
        
        // 测试只做多模式
        const tradeSide = 'long';
        
        // 测试1: 无持仓时，买单应该是开多
        const noPosition = { contracts: 0, side: null };
        const buyType1 = trader.determineBuyOrderType(noPosition, tradeSide);
        this.addTestResult('无持仓买单-开多', buyType1 === 'open_long', `期望: open_long, 实际: ${buyType1}`);
        
        // 测试2: 无持仓时，卖单应该是null（只做多模式）
        const sellType1 = trader.determineSellOrderType(noPosition, tradeSide);
        this.addTestResult('无持仓卖单-只做多', sellType1 === null, `期望: null, 实际: ${sellType1}`);
        
        // 测试3: 有多头持仓时，卖单应该是平多
        const longPosition = { contracts: 0.01, side: 'long' };
        const sellType2 = trader.determineSellOrderType(longPosition, tradeSide);
        this.addTestResult('多头持仓卖单-平多', sellType2 === 'close_long', `期望: close_long, 实际: ${sellType2}`);
        
        // 测试4: 有空头持仓时，买单应该是平空
        const shortPosition = { contracts: 0.01, side: 'short' };
        const buyType2 = trader.determineBuyOrderType(shortPosition, tradeSide);
        this.addTestResult('空头持仓买单-平空', buyType2 === 'close_short', `期望: close_short, 实际: ${buyType2}`);
    }

    /**
     * 测试交易方向限制
     */
    async testTradeSideRestrictions() {
        console.log('\n📋 测试交易方向限制...');
        
        const trader = {
            determineBuyOrderType: Trader.prototype.determineBuyOrderType,
            determineSellOrderType: Trader.prototype.determineSellOrderType
        };
        
        const noPosition = { contracts: 0, side: null };
        
        // 测试只做多模式
        const longOnlyBuy = trader.determineBuyOrderType(noPosition, 'long');
        const longOnlySell = trader.determineSellOrderType(noPosition, 'long');
        this.addTestResult('只做多-买单允许', longOnlyBuy === 'open_long', `期望: open_long, 实际: ${longOnlyBuy}`);
        this.addTestResult('只做多-卖单禁止', longOnlySell === null, `期望: null, 实际: ${longOnlySell}`);
        
        // 测试只做空模式
        const shortOnlyBuy = trader.determineBuyOrderType(noPosition, 'short');
        const shortOnlySell = trader.determineSellOrderType(noPosition, 'short');
        this.addTestResult('只做空-买单禁止', shortOnlyBuy === null, `期望: null, 实际: ${shortOnlyBuy}`);
        this.addTestResult('只做空-卖单允许', shortOnlySell === 'open_short', `期望: open_short, 实际: ${shortOnlySell}`);
        
        // 测试双向模式
        const bothBuy = trader.determineBuyOrderType(noPosition, 'both');
        const bothSell = trader.determineSellOrderType(noPosition, 'both');
        this.addTestResult('双向-买单允许', bothBuy === 'open_long', `期望: open_long, 实际: ${bothBuy}`);
        this.addTestResult('双向-卖单允许', bothSell === 'open_short', `期望: open_short, 实际: ${bothSell}`);
    }

    /**
     * 添加测试结果
     */
    addTestResult(testName, passed, details) {
        this.testResults.push({
            name: testName,
            passed: passed,
            details: details
        });
        
        const status = passed ? '✅' : '❌';
        console.log(`  ${status} ${testName}: ${details}`);
    }

    /**
     * 打印测试结果汇总
     */
    printTestResults() {
        console.log('\n📊 测试结果汇总:');
        
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;
        
        console.log(`总测试数: ${totalTests}`);
        console.log(`通过: ${passedTests}`);
        console.log(`失败: ${failedTests}`);
        console.log(`成功率: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
        
        if (failedTests > 0) {
            console.log('\n❌ 失败的测试:');
            this.testResults.filter(r => !r.passed).forEach(result => {
                console.log(`  - ${result.name}: ${result.details}`);
            });
        } else {
            console.log('\n🎉 所有测试都通过了！');
        }
    }
}

// 运行测试
if (require.main === module) {
    const test = new OrderUpdateLogicTest();
    test.runAllTests().catch(console.error);
}

module.exports = OrderUpdateLogicTest;