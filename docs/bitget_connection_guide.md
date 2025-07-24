# Bitget 合约交易连接指南

本文档旨在指导用户如何使用 CCXT 库连接到 Bitget 交易所的合约市场，包括实盘交易和模拟盘交易。

## 准备工作

在开始之前，请确保您已经：

1.  安装了 `ccxt` 库。
2.  拥有 Bitget 账户并已生成 API 密钥（API Key）、API 密钥（API Secret）和密码（Passphrase）。

## 1. 连接到 Bitget 合约实盘

连接到 Bitget 的实盘合约市场非常直接。您需要在实例化 `bitget` 对象时提供您的 API 凭据。

默认情况下，Bitget 的 `ccxt` 实现会处理合约交易（掉期/永续合约）。您可以通过 `options` 中的 `defaultType` 来显式指定，但通常不是必需的。

### JavaScript 示例代码 (实盘)

```javascript
const ccxt = require('ccxt');

// 实例化 Bitget 交易所
const exchange = new ccxt.bitget({
    'apiKey': 'YOUR_API_KEY',      // 您的 API Key
    'secret': 'YOUR_SECRET_KEY',    // 您的 Secret Key
    'password': 'YOUR_PASSPHRASE',  // 您的 API Passphrase
    'options': {
        'defaultType': 'swap', // 'swap' 指的是合约市场
    },
});

(async () => {
    try {
        // 加载市场
        await exchange.loadMarkets();

        // 获取账户余额 (以 USDT-M 合约账户为例)
        const balance = await exchange.fetchBalance({ 'productType': 'USDT-FUTURES' });
        console.log('USDT-M 合约账户余额:', balance.total);

        // 获取特定交易对的 Ticker 信息
        const ticker = await exchange.fetchTicker('BTC/USDT:USDT');
        console.log('BTC/USDT:USDT Ticker:', ticker);

    } catch (e) {
        console.error(e);
    }
})();
```

## 2. 连接到 Bitget 合约模拟盘

Bitget 提供了模拟盘环境供用户测试交易策略。根据 Bitget 的 API 文档和社区的发现，有两种方式可以进行模拟交易。

### 方法一：使用模拟交易对 (推荐)

这是最简单的方式。您仍然连接到 Bitget 的生产环境，但是交易的是特殊的模拟交易对，例如 `SBTCSUSDT`。这些交易对使用模拟币，不会产生真实损益。<mcreference link="https://www.bitget.com/api-doc/contract/intro" index="4">4</mcreference>

您只需要在调用 `fetchTicker`, `createOrder` 等函数时，使用模拟交易对的 symbol 即可。

### 方法二：使用 Sandbox (沙盒) 环境

CCXT 通过 `sandboxMode` 选项支持连接到交易所的测试环境。对于 Bitget，启用沙盒模式会将请求发送到模拟盘的特定 API 端点，并自动添加 `paptrading=1` 的请求头，这对于模拟盘是必需的。<mcreference link="https://github.com/ccxt/ccxt/issues/25523" index="2">2</mcreference>

### JavaScript 示例代码 (模拟盘 - Sandbox 模式)

```javascript
const ccxt = require('ccxt');

// 实例化 Bitget 交易所并启用沙盒模式
const exchange = new ccxt.bitget({
    'apiKey': 'YOUR_SIMULATED_API_KEY',      // 您在模拟盘申请的 API Key
    'secret': 'YOUR_SIMULATED_SECRET_KEY',    // 您在模拟盘申请的 Secret Key
    'password': 'YOUR_SIMULATED_PASSPHRASE',  // 您在模拟盘申请的 API Passphrase
    'sandboxMode': true, // 启用沙盒模式
});

(async () => {
    try {
        // 加载市场
        await exchange.loadMarkets();

        // 获取模拟盘账户余额 (以 USDT-M 合约账户为例)
        // 在沙盒模式下，ccxt 会自动处理 productType
        const balance = await exchange.fetchBalance();
        console.log('模拟盘合约账户余额:', balance.total);

        // 获取真实交易对的 Ticker 信息 (在模拟盘环境)
        const ticker = await exchange.fetchTicker('BTC/USDT:USDT');
        console.log('BTC/USDT:USDT (模拟盘) Ticker:', ticker);

    } catch (e) {
        console.error(e);
    }
})();
```

## 总结

- **实盘连接**: 直接提供您的 API 凭据实例化 `ccxt.bitget`。
- **模拟盘连接**: 推荐启用 `sandboxMode: true` 选项，并使用在 Bitget 模拟盘上生成的专用 API 凭据。这可以确保您的所有操作都在模拟环境中进行。

请将代码中的 `YOUR_API_KEY`, `YOUR_SECRET_KEY`, 和 `YOUR_PASSPHRASE` 替换为您自己的凭据。