# ali-oss 云存储

> 阿里云对象存储服务

---

## 一、技术简介

### 1.1 什么是 OSS

OSS（Object Storage Service）是阿里云的对象存储服务：

- **海量存储**：存储图片、视频、文件等
- **高可用**：99.995% 可用性
- **CDN加速**：全球访问加速
- **按量付费**：存储多少付多少

### 1.2 基本概念

```
┌─────────────────────────────────────────────────────────────────┐
│                    OSS 存储结构                                  │
└─────────────────────────────────────────────────────────────────┘

    Bucket (存储桶)
    ├── 类似于文件系统的"根目录"
    ├── 全局唯一名称
    │
    └── Object (对象)
        ├── 文件 + 元数据
        ├── 通过 Key 访问
        └── 例如: images/avatar/user123.jpg
```

---

## 二、项目中的使用

### 2.1 使用位置

```
src/msg-center/core/utils/aliyunOssManagerUtil.js    # OSS 管理工具
```

### 2.2 完整实现

```javascript
// src/msg-center/core/utils/aliyunOssManagerUtil.js

const OSS = require("ali-oss");
const { httpFetch } = require("../../../common/fetch");
const logUtil = require("../../../init/log");
const { access, decode } = require("../mq/encryptUtil");

// 配置常量
const END_POINT = "http://oss-cn-beijing.aliyuncs.com";
const BUCKET = "genshuixue-public";
const BASIC_DIR = "stormEarth-node/robotFiles/";
const FILE_HOST = "http://file.gsxservice.com/";

// 目录定义
const QRCODE_DIR = "qrCode/";
const FILE_DIR = "file/";
const AVATAR_DIR = "avatar/";
const IMG_MSG_DIR = "imgMsg/";
const VIDEO_MSG_DIR = "videoMsg/";

const AliyunOssManagerUtil = {
    accessKeyId: null,
    secretKey: null,
    securityToken: null,
    ossClient: null,
    expiration: 0,
    fill2UrlMap: new Map(),  // 文件路径到URL的缓存

    /**
     * 上传文件（带缓存）
     */
    async uploadFile(filepath, dir = QRCODE_DIR, wxid, fileName) {
        logUtil.customLog(`[OSS] 上传文件 ${filepath}`);

        // 检查缓存
        if (this.fill2UrlMap.has(filepath)) {
            return this.fill2UrlMap.get(filepath);
        }

        return this.uploadFileNoCache(filepath, dir, wxid, fileName);
    },

    /**
     * 上传文件（不带缓存）
     */
    async uploadFileNoCache(filepath, dir, wxid, fileName) {
        // 检查凭证是否过期
        if (!this.accessKeyId || (this.expiration && Date.now() > this.expiration)) {
            await this.refreshAccess();
        }

        // 构建 OSS 路径
        let filepathArr = filepath.split("\\");
        fileName = fileName || filepathArr[filepathArr.length - 1];
        dir += wxid ? wxid + "/" : "";
        const originPath = `${BASIC_DIR}${dir}${Date.now()}/${fileName}`;

        try {
            // 上传到 OSS
            const result = await this.ossClient.put(originPath, filepath, {
                timeout: 1200000  // 20分钟超时
            });

            const { url } = result;

            // 缓存结果
            this.fill2UrlMap.set(filepath, url);

            logUtil.customLog(`[OSS] 上传成功 ${url}`);
            return url;

        } catch (error) {
            logUtil.customLog(`[OSS] 上传失败: ${error.message}`, { level: 'error' });
            throw error;
        }
    },

    /**
     * 上传 Base64 图片
     */
    async uploadBase64Image(base64Data, objectName) {
        if (!base64Data) {
            return "";
        }

        if (!this.accessKeyId || Date.now() > this.expiration) {
            await this.refreshAccess();
        }

        // Base64 转 Buffer
        const buffer = Buffer.from(base64Data, "base64");

        // 上传
        const result = await this.ossClient.put(objectName, buffer);
        return result.url;
    },

    /**
     * 上传字节数组
     */
    async uploadByteArray(byteArray, dir, filename) {
        if (!this.accessKeyId || Date.now() > this.expiration) {
            await this.refreshAccess();
        }

        const result = await this.ossClient.put(
            dir + "/" + filename,
            Buffer.from(byteArray)
        );
        return result.url;
    },

    /**
     * 刷新 STS 临时凭证
     */
    async refreshAccess() {
        try {
            // 从服务器获取临时凭证
            const accessRes = await httpFetch({
                url: ossAccessKeyUrl,
                data: { access: access(Date.now()) }
            });

            const { accessKey, secretKey, securityToken, expiration } = accessRes.data;

            this.accessKeyId = accessKey;
            this.secretKey = secretKey;
            this.securityToken = securityToken;
            this.expiration = +new Date(expiration);

            // 初始化 OSS 客户端
            this.ossClient = new OSS({
                endpoint: END_POINT,
                accessKeyId: accessKey,
                accessKeySecret: secretKey,
                stsToken: securityToken,  // STS 临时令牌
                bucket: BUCKET
            });

        } catch (error) {
            logUtil.customLog(`[OSS] 获取凭证失败: ${error.message}`, { level: 'error' });
        }
    }
};

module.exports = AliyunOssManagerUtil;
```

### 2.3 业务中的使用

```javascript
// 上传群聊二维码
const qrcodeUrl = await AliyunOssManagerUtil.uploadFile(
    localQrcodePath,
    AliyunOssManagerUtil.QRCODE_DIR,
    wxid
);

// 上传头像
const avatarUrl = await AliyunOssManagerUtil.uploadFile(
    localAvatarPath,
    AliyunOssManagerUtil.AVATAR_DIR,
    wxid
);

// 上传消息图片
const imgUrl = await AliyunOssManagerUtil.uploadFile(
    localImgPath,
    AliyunOssManagerUtil.IMG_MSG_DIR,
    wxid
);
```

---

## 三、常用 API

### 3.1 初始化客户端

```javascript
const OSS = require('ali-oss');

// 使用 AK/SK
const client = new OSS({
    region: 'oss-cn-beijing',
    accessKeyId: 'your-access-key-id',
    accessKeySecret: 'your-access-key-secret',
    bucket: 'your-bucket-name'
});

// 使用 STS 临时凭证（更安全）
const client = new OSS({
    region: 'oss-cn-beijing',
    accessKeyId: 'temp-access-key-id',
    accessKeySecret: 'temp-access-key-secret',
    stsToken: 'security-token',
    bucket: 'your-bucket-name'
});
```

### 3.2 上传文件

```javascript
// 上传本地文件
const result = await client.put('object-key', 'local-file-path');
console.log(result.url);  // 文件 URL

// 上传 Buffer
const buffer = fs.readFileSync('file.jpg');
await client.put('images/file.jpg', buffer);

// 上传 Stream
const stream = fs.createReadStream('large-file.zip');
await client.putStream('files/large-file.zip', stream);
```

### 3.3 下载文件

```javascript
// 下载到本地
await client.get('object-key', 'local-file-path');

// 获取 Buffer
const result = await client.get('object-key');
const buffer = result.content;

// 获取 Stream
const result = await client.getStream('object-key');
result.stream.pipe(fs.createWriteStream('local-file'));
```

### 3.4 其他操作

```javascript
// 检查文件是否存在
try {
    await client.head('object-key');
    console.log('文件存在');
} catch (e) {
    console.log('文件不存在');
}

// 删除文件
await client.delete('object-key');

// 列出文件
const result = await client.list({
    prefix: 'images/',
    'max-keys': 100
});

// 生成签名 URL（临时访问私有文件）
const url = client.signatureUrl('private-object', {
    expires: 3600  // 1小时有效
});
```

---

## 四、STS 临时凭证

### 4.1 为什么使用 STS

```
直接使用 AK/SK：
┌─────────────────┐
│ 客户端          │ ─── 包含 AK/SK ───► 风险：泄露后无法撤销
└─────────────────┘

使用 STS 临时凭证：
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│    客户端       │ ────► │    服务器       │ ────► │   阿里云 STS    │
│                 │       │  获取临时凭证   │       │                 │
└─────────────────┘       └─────────────────┘       └─────────────────┘
                                  │
                                  ▼
                          临时凭证（有效期短）
```

### 4.2 项目中的实现

```javascript
// 服务器返回临时凭证
{
    accessKey: "STS.xxx",
    secretKey: "xxx",
    securityToken: "xxx",
    expiration: "2024-01-22T12:00:00Z"  // 过期时间
}

// 客户端在过期前刷新
if (Date.now() > this.expiration) {
    await this.refreshAccess();
}
```

---

## 五、注意事项

### 5.1 大文件上传

```javascript
// 分片上传（大于 100MB 的文件）
const result = await client.multipartUpload('large-file', 'local-path', {
    parallel: 4,        // 并发数
    partSize: 1024 * 1024 * 5,  // 分片大小 5MB
    progress: (p, checkpoint) => {
        console.log(`上传进度: ${Math.floor(p * 100)}%`);
    }
});
```

### 5.2 超时设置

```javascript
const result = await client.put(objectKey, filePath, {
    timeout: 1200000  // 20分钟，大文件需要更长时间
});
```

### 5.3 错误处理

```javascript
try {
    await client.put(objectKey, filePath);
} catch (error) {
    if (error.code === 'ConnectionTimeoutError') {
        console.error('连接超时');
    } else if (error.code === 'AccessDenied') {
        console.error('权限不足');
    } else if (error.code === 'NoSuchBucket') {
        console.error('Bucket 不存在');
    }
}
```
