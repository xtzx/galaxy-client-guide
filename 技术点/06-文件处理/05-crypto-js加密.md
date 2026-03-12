# crypto-js 加密

> JavaScript 加密算法库

---

## 一、技术简介

### 1.1 什么是 crypto-js

`crypto-js` 是纯 JavaScript 实现的加密库：

- **多种算法**：MD5、SHA、AES、DES、HMAC 等
- **跨平台**：浏览器和 Node.js 都可用
- **简单易用**：API 设计直观

### 1.2 常见加密算法

| 类型 | 算法 | 用途 |
|-----|-----|-----|
| 哈希 | MD5, SHA-1, SHA-256 | 生成摘要、密码存储 |
| 对称加密 | AES, DES, TripleDES | 数据加密解密 |
| HMAC | HMAC-SHA256 | 消息认证、签名 |
| 编码 | Base64, Hex | 编码转换 |

---

## 二、项目中的使用

### 2.1 使用位置

```
src/msg-center/core/mq/mqttConfig.js    # MQTT 密码签名
src/common/encryptUtil.js               # 自定义加密（不使用 crypto-js）
```

### 2.2 MQTT 密码签名

```javascript
// src/msg-center/core/mq/mqttConfig.js

const CryptoJS = require('crypto-js');

// 密钥
const secretKey = "e10adc3949ba59abb";

// 生成签名密码
function generateSignature() {
    // 当前时间戳
    const timestamp = Date.now();

    // HMAC-SHA1 签名
    const hash = CryptoJS.HmacSHA1(String(timestamp), secretKey);

    // Base64 编码
    const signature = CryptoJS.enc.Base64.stringify(hash);

    // 返回格式：timestamp,signature
    return `${timestamp},${signature}`;
}

// MQTT 连接配置
const mqttConfig = {
    username: 'client_id',
    password: generateSignature(),  // 带签名的密码
    // ...
};
```

### 2.3 签名验证流程

```
客户端                           服务器
  │                                │
  │  1. 生成 timestamp             │
  │  2. HMAC-SHA1(timestamp, key)  │
  │  3. Base64 编码                │
  │                                │
  ├──────────────────────────────►│
  │    timestamp,signature         │
  │                                │
  │                    4. 解析 timestamp
  │                    5. 重新计算签名
  │                    6. 比对验证
  │                                │
  │◄──────────────────────────────┤
  │         验证结果               │
```

---

## 三、常用 API

### 3.1 哈希算法

```javascript
const CryptoJS = require('crypto-js');

// MD5
const md5Hash = CryptoJS.MD5('message');
console.log(md5Hash.toString());
// "78e731027d8fd50ed642340b7c9a63b3"

// SHA-1
const sha1Hash = CryptoJS.SHA1('message');
console.log(sha1Hash.toString());

// SHA-256
const sha256Hash = CryptoJS.SHA256('message');
console.log(sha256Hash.toString());

// SHA-512
const sha512Hash = CryptoJS.SHA512('message');
console.log(sha512Hash.toString());
```

### 3.2 HMAC 签名

```javascript
// HMAC-SHA1
const hmacSha1 = CryptoJS.HmacSHA1('message', 'secret-key');
console.log(hmacSha1.toString());

// HMAC-SHA256
const hmacSha256 = CryptoJS.HmacSHA256('message', 'secret-key');
console.log(hmacSha256.toString());

// 输出 Base64
const base64 = CryptoJS.enc.Base64.stringify(hmacSha256);
console.log(base64);
```

### 3.3 AES 加密

```javascript
// 加密
const encrypted = CryptoJS.AES.encrypt('message', 'secret-key');
console.log(encrypted.toString());  // Base64 密文

// 解密
const decrypted = CryptoJS.AES.decrypt(encrypted, 'secret-key');
const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
console.log(plaintext);  // "message"
```

### 3.4 进阶 AES（指定模式和填充）

```javascript
const key = CryptoJS.enc.Utf8.parse('1234567890123456');  // 16 字节
const iv = CryptoJS.enc.Utf8.parse('1234567890123456');   // 16 字节

// 加密
const encrypted = CryptoJS.AES.encrypt('message', key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,        // CBC 模式
    padding: CryptoJS.pad.Pkcs7     // PKCS7 填充
});

// 解密
const decrypted = CryptoJS.AES.decrypt(encrypted, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
});
```

### 3.5 编码转换

```javascript
// Hex 编码
const hexStr = CryptoJS.enc.Hex.stringify(wordArray);
const wordArray = CryptoJS.enc.Hex.parse(hexStr);

// Base64 编码
const base64Str = CryptoJS.enc.Base64.stringify(wordArray);
const wordArray = CryptoJS.enc.Base64.parse(base64Str);

// UTF-8 编码
const utf8Str = CryptoJS.enc.Utf8.stringify(wordArray);
const wordArray = CryptoJS.enc.Utf8.parse('text');
```

---

## 四、项目中的自定义加密

### 4.1 encryptUtil.js

项目中还有一个自定义加密模块，不使用 crypto-js：

```javascript
// src/common/encryptUtil.js

// 密钥
const key = [0x42, 0x4a, 0x48, 0x4c];  // "BJHL"

// XOR 加密
function xorEncrypt(str) {
    const bytes = Buffer.from(str, 'utf8');
    const result = [];

    for (let i = 0; i < bytes.length; i++) {
        result.push(bytes[i] ^ key[i % key.length]);
    }

    return Buffer.from(result);
}

// Base64 编码
function encode(str) {
    return xorEncrypt(str).toString('base64');
}

// 解密
function decode(base64Str) {
    const bytes = Buffer.from(base64Str, 'base64');
    const result = [];

    for (let i = 0; i < bytes.length; i++) {
        result.push(bytes[i] ^ key[i % key.length]);
    }

    return Buffer.from(result).toString('utf8');
}

module.exports = { encode, decode };
```

### 4.2 两种加密的用途

```
┌─────────────────────────────────────────────────────────────────┐
│                    加密用途分工                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  crypto-js (HMAC-SHA1)                                         │
│  └── MQTT 连接认证                                              │
│      └── 生成带时间戳的签名密码                                  │
│                                                                 │
│  encryptUtil (XOR + Base64)                                    │
│  └── OSS 凭证请求                                               │
│  └── 其他内部数据混淆                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、安全注意事项

### 5.1 密钥管理

```javascript
// ❌ 不要硬编码密钥
const key = "my-secret-key";

// ✅ 从环境变量读取
const key = process.env.SECRET_KEY;

// ✅ 从配置服务获取
const key = await getSecretFromServer();
```

### 5.2 哈希算法选择

```javascript
// ❌ MD5 和 SHA-1 已不安全，不要用于密码
CryptoJS.MD5(password);

// ✅ 使用 SHA-256 或更强
CryptoJS.SHA256(password);

// ✅ 密码存储应使用专门的算法（bcrypt, argon2）
```

### 5.3 加密模式

```javascript
// ❌ ECB 模式不安全
CryptoJS.AES.encrypt(data, key, {
    mode: CryptoJS.mode.ECB
});

// ✅ 使用 CBC 或 GCM 模式
CryptoJS.AES.encrypt(data, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC
});
```

---

## 六、与 React 开发对比

### 6.1 浏览器中使用

```javascript
// React 中也可以用 crypto-js
import CryptoJS from 'crypto-js';

// 或使用 Web Crypto API
const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('message')
);
```

### 6.2 前后端加密一致性

```javascript
// 前端（React）
const encrypted = CryptoJS.AES.encrypt(data, key).toString();

// 后端（Node.js）
const decrypted = CryptoJS.AES.decrypt(encrypted, key)
    .toString(CryptoJS.enc.Utf8);

// 使用相同的库和配置，可以跨端解密
```
