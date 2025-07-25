const pino = require('pino');
const path = require('path');

const logDir = path.join(__dirname, '..', '..', 'logs');

// 使用 pino.destination 并强制同步写入
const streams = [
  {
    level: 'error',
    stream: pino.destination({ dest: path.join(logDir, 'error.log'), sync: true, mkdir: true })
  },
  {
    level: 'debug',
    stream: pino.destination({ dest: path.join(logDir, 'combined.log'), sync: true, mkdir: true })
  }
];

// 在开发环境中，添加美化的控制台输出
if (process.env.NODE_ENV !== 'production') {
  // 设置控制台编码为UTF-8（Windows兼容）
  if (process.platform === 'win32') {
    try {
      process.stdout.setEncoding('utf8');
      process.stderr.setEncoding('utf8');
    } catch (e) {
      // 忽略编码设置错误
    }
  }
  
  streams.push({ 
    stream: require('pino-pretty')({
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
      // 确保中文字符正确显示
      messageFormat: '{msg}',
      customPrettifiers: {
        time: (timestamp) => `[${timestamp}]`
      },
      // 添加UTF-8支持
      destination: process.stdout,
      sync: true
    }) 
  });
}

const logger = pino(
  {
    level: 'debug',
  },
  pino.multistream(streams)
);

module.exports = logger;