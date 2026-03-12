# fs-extra 文件操作

> Node.js 文件系统增强库

---

## 一、技术简介

### 1.1 什么是 fs-extra

`fs-extra` 是 Node.js 原生 `fs` 模块的增强版：

- **完全兼容**：包含所有 `fs` 方法
- **Promise 支持**：所有方法都返回 Promise
- **额外功能**：copy、remove、ensureDir 等

### 1.2 与原生 fs 对比

```javascript
// 原生 fs - 创建嵌套目录（需要递归）
fs.mkdirSync('a/b/c', { recursive: true });

// fs-extra - 更直观
fse.ensureDirSync('a/b/c');

// 原生 fs - 复制目录（需要递归实现）
// ... 需要自己写递归逻辑

// fs-extra - 一行搞定
fse.copySync('src-dir', 'dest-dir');
```

---

## 二、项目中的使用

### 2.1 使用位置

```
src/common/file.js              # 文件操作封装
src/msg-center/core/utils/      # 各种工具
```

### 2.2 项目中的典型用法

```javascript
// src/common/file.js

const fse = require('fs-extra');
const path = require('path');

// 检查文件是否存在
async function existFileArr(fileArr) {
    const filePromises = fileArr.map((item) => {
        if (/^http(s)?:\/\//.test(item.content)) {
            return Promise.resolve(true);  // URL 不检查
        }
        return fse.pathExists(item.content);  // 检查本地文件
    });
    return Promise.all(filePromises);
}

// 创建目录（自动创建父目录）
async function createDir(content) {
    const fileDirName = await getFileMd5(content);
    const dirPath = getDataPath('files/tmp/' + fileDirName);

    if (!(await fse.pathExists(dirPath))) {
        await fse.ensureDir(dirPath);  // 确保目录存在
    }
    return dirPath;
}

// 复制文件
async function copyFileToTemp(fileArr) {
    for (const item of fileArr) {
        if (item.content) {
            const destPath = path.join(tempDir, item.contentName);
            await fse.copy(item.content, destPath);  // 复制文件
        }
    }
}

// 备份登录文件
async function backupLoginFile(loginInfo) {
    const localAccountPath = path.join(dir, 'localAccounts', loginInfo.login_user.id);

    // 确保目录存在
    if (!await fse.pathExists(localAccountPath)) {
        fse.mkdirpSync(localAccountPath);
    }

    // 检查文件是否存在
    const isExistsJson = fse.existsSync(path.join(localAccountPath, 'account.json'));

    if (isExistsJson) {
        // 读取 JSON 文件
        const info = fse.readJSONSync(path.join(localAccountPath, 'account.json'));
        // ...
    }

    // 复制配置文件
    fse.copySync(
        path.join(loginInfo.apppath, 'Global', 'Config.cfg'),
        path.join(localAccountPath, 'Config.cfg')
    );

    // 写入 JSON 文件
    fse.writeJSONSync(
        path.join(localAccountPath, 'account.json'),
        loginInfo
    );
}
```

---

## 三、常用 API

### 3.1 目录操作

```javascript
const fse = require('fs-extra');

// 确保目录存在（不存在则创建，包括父目录）
await fse.ensureDir('/path/to/dir');
fse.ensureDirSync('/path/to/dir');

// 等同于
await fse.mkdirp('/path/to/dir');

// 检查路径是否存在
const exists = await fse.pathExists('/path/to/file');

// 删除目录（包括内容）
await fse.remove('/path/to/dir');
fse.removeSync('/path/to/dir');

// 清空目录（保留目录本身）
await fse.emptyDir('/path/to/dir');
```

### 3.2 文件复制

```javascript
// 复制文件
await fse.copy('/src/file.txt', '/dest/file.txt');

// 复制目录（递归）
await fse.copy('/src/dir', '/dest/dir');

// 带选项
await fse.copy('/src', '/dest', {
    overwrite: true,           // 覆盖已存在文件
    errorOnExist: false,       // 存在时不报错
    filter: (src, dest) => {   // 过滤函数
        return !src.includes('node_modules');
    }
});

// 同步版本
fse.copySync('/src', '/dest');
```

### 3.3 文件移动

```javascript
// 移动文件或目录
await fse.move('/src/file.txt', '/dest/file.txt');

// 覆盖已存在
await fse.move('/src', '/dest', { overwrite: true });
```

### 3.4 JSON 操作

```javascript
// 读取 JSON
const data = await fse.readJson('/path/to/file.json');
const data = fse.readJsonSync('/path/to/file.json');

// 写入 JSON
await fse.writeJson('/path/to/file.json', { key: 'value' });

// 格式化写入
await fse.writeJson('/path/to/file.json', data, { spaces: 2 });

// 确保文件存在后写入
await fse.outputJson('/path/to/file.json', data);
```

### 3.5 确保文件存在

```javascript
// 确保文件存在（不存在则创建空文件）
await fse.ensureFile('/path/to/file.txt');

// 确保文件存在并写入
await fse.outputFile('/path/to/file.txt', 'content');
// 自动创建父目录
```

---

## 四、与原生 fs 对比

### 4.1 Promise vs Callback

```javascript
// 原生 fs（回调风格）
fs.readFile('/file.txt', 'utf8', (err, data) => {
    if (err) throw err;
    console.log(data);
});

// fs-extra（Promise 风格）
const data = await fse.readFile('/file.txt', 'utf8');
console.log(data);
```

### 4.2 递归操作

```javascript
// 原生 fs - 删除目录需要 recursive 选项
fs.rmSync('/dir', { recursive: true, force: true });

// fs-extra - 自动递归
fse.removeSync('/dir');

// 原生 fs - 复制目录需要自己实现递归
// ...

// fs-extra - 自动递归
fse.copySync('/src', '/dest');
```

### 4.3 创建嵌套目录

```javascript
// 原生 fs
fs.mkdirSync('a/b/c/d', { recursive: true });

// fs-extra（更语义化）
fse.ensureDirSync('a/b/c/d');
fse.mkdirpSync('a/b/c/d');
```

---

## 五、项目中的应用场景

### 5.1 临时文件管理

```javascript
const tempDir = path.join(os.tmpdir(), 'galaxy-client');

// 确保临时目录存在
await fse.ensureDir(tempDir);

// 清理临时文件
await fse.emptyDir(tempDir);
```

### 5.2 配置文件备份

```javascript
async function backupConfig(configPath) {
    const backupPath = configPath + '.backup';

    if (await fse.pathExists(configPath)) {
        await fse.copy(configPath, backupPath);
    }
}
```

### 5.3 日志文件轮转

```javascript
async function rotateLog(logPath, maxSize) {
    const stats = await fse.stat(logPath);

    if (stats.size > maxSize) {
        const backupPath = logPath + '.' + Date.now();
        await fse.move(logPath, backupPath);
        await fse.ensureFile(logPath);
    }
}
```

---

## 六、注意事项

### 6.1 同步 vs 异步

```javascript
// 异步（推荐）- 不阻塞事件循环
await fse.copy(src, dest);

// 同步 - 阻塞，但在某些场景更简单
fse.copySync(src, dest);

// 启动时可以用同步，运行时用异步
```

### 6.2 错误处理

```javascript
try {
    await fse.copy(src, dest);
} catch (error) {
    if (error.code === 'ENOENT') {
        console.error('源文件不存在');
    } else if (error.code === 'EACCES') {
        console.error('权限不足');
    } else if (error.code === 'ENOSPC') {
        console.error('磁盘空间不足');
    }
}
```

### 6.3 大文件处理

```javascript
// 复制大文件时使用 Stream
const readStream = fse.createReadStream(src);
const writeStream = fse.createWriteStream(dest);

readStream.pipe(writeStream);

writeStream.on('finish', () => {
    console.log('复制完成');
});
```
