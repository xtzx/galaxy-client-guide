# sharp 图片处理

> 高性能图片处理库

---

## 一、技术简介

### 1.1 什么是 sharp

`sharp` 是 Node.js 中最快的图片处理库：

- **高性能**：使用 libvips，比 ImageMagick 快 4-5 倍
- **低内存**：流式处理，不会一次加载整个图片
- **功能丰富**：缩放、裁剪、格式转换、压缩等

### 1.2 支持的格式

| 格式 | 读取 | 写入 |
|-----|-----|-----|
| JPEG | ✅ | ✅ |
| PNG | ✅ | ✅ |
| WebP | ✅ | ✅ |
| GIF | ✅ | ✅ |
| AVIF | ✅ | ✅ |
| TIFF | ✅ | ✅ |
| SVG | ✅ | - |

---

## 二、项目中的使用

### 2.1 使用位置

```
src/common/file.js    # 文件操作模块中使用 sharp 压缩图片
```

### 2.2 图片压缩

```javascript
// src/common/file.js

const sharp = require('sharp');
const fse = require('fs-extra');

async function copyFileToTemp(fileArr) {
    const copyPathObj = {};

    const tasks = fileArr.map(async (item, i) => {
        if (item && item.content && item.contentName) {
            const copyPath = await createDir(item.content);
            copyPathObj[i] = path.join(copyPath, item.contentName);

            // 如果是图片类型
            if (item.type === 2) {
                const { size } = await fse.stat(item.content);

                // 大于 700KB 的图片需要压缩
                if (size / 1024 > 700) {
                    // 使用 sharp 压缩，质量设为 80%
                    await sharp(item.content)
                        .jpeg({ quality: 80 })
                        .toFile(copyPathObj[i]);
                } else {
                    // 不需要压缩，直接复制
                    await fse.copy(item.content, copyPathObj[i]);
                }
            } else {
                await fse.copy(item.content, copyPathObj[i]);
            }
        }
    });

    await Promise.all(tasks);
    return { copyFlag: true, copyPathObj };
}
```

---

## 三、常用操作

### 3.1 基础操作

```javascript
const sharp = require('sharp');

// 读取图片信息
const metadata = await sharp('input.jpg').metadata();
console.log(metadata);
// { width: 1920, height: 1080, format: 'jpeg', ... }

// 调整尺寸
await sharp('input.jpg')
    .resize(300, 200)
    .toFile('output.jpg');

// 只指定宽度，高度自动计算
await sharp('input.jpg')
    .resize(300)
    .toFile('output.jpg');
```

### 3.2 格式转换

```javascript
// JPEG 转 PNG
await sharp('input.jpg')
    .png()
    .toFile('output.png');

// 转 WebP（更小的体积）
await sharp('input.jpg')
    .webp({ quality: 80 })
    .toFile('output.webp');

// 输出到 Buffer
const buffer = await sharp('input.jpg')
    .jpeg({ quality: 80 })
    .toBuffer();
```

### 3.3 图片压缩

```javascript
// JPEG 压缩
await sharp('input.jpg')
    .jpeg({
        quality: 80,           // 质量 0-100
        progressive: true      // 渐进式 JPEG
    })
    .toFile('compressed.jpg');

// PNG 压缩
await sharp('input.png')
    .png({
        compressionLevel: 9,   // 压缩级别 0-9
        palette: true          // 使用调色板
    })
    .toFile('compressed.png');
```

### 3.4 裁剪和旋转

```javascript
// 裁剪
await sharp('input.jpg')
    .extract({
        left: 100,    // 起始 x
        top: 100,     // 起始 y
        width: 300,   // 宽度
        height: 200   // 高度
    })
    .toFile('cropped.jpg');

// 旋转
await sharp('input.jpg')
    .rotate(90)           // 旋转 90 度
    .toFile('rotated.jpg');

// 翻转
await sharp('input.jpg')
    .flip()               // 垂直翻转
    .flop()               // 水平翻转
    .toFile('flipped.jpg');
```

### 3.5 其他效果

```javascript
// 灰度
await sharp('input.jpg')
    .grayscale()
    .toFile('gray.jpg');

// 模糊
await sharp('input.jpg')
    .blur(5)              // 模糊程度
    .toFile('blurred.jpg');

// 锐化
await sharp('input.jpg')
    .sharpen()
    .toFile('sharpened.jpg');
```

---

## 四、项目应用场景

### 4.1 发送图片消息前压缩

```javascript
async function prepareImageForSend(imagePath) {
    const stats = await fse.stat(imagePath);

    // 大于 500KB 压缩
    if (stats.size > 500 * 1024) {
        const compressedPath = imagePath.replace(/\.\w+$/, '_compressed.jpg');

        await sharp(imagePath)
            .resize(1920, 1080, {
                fit: 'inside',           // 保持比例，不超过尺寸
                withoutEnlargement: true // 不放大小图
            })
            .jpeg({ quality: 80 })
            .toFile(compressedPath);

        return compressedPath;
    }

    return imagePath;
}
```

### 4.2 生成头像缩略图

```javascript
async function generateAvatar(imagePath, outputPath) {
    await sharp(imagePath)
        .resize(200, 200, {
            fit: 'cover',    // 裁剪填充
            position: 'center'
        })
        .jpeg({ quality: 90 })
        .toFile(outputPath);
}
```

---

## 五、注意事项

### 5.1 Electron 打包问题

sharp 包含原生模块，打包时需要重新编译：

```bash
# 重新编译 sharp
npm rebuild sharp
```

### 5.2 内存使用

```javascript
// sharp 默认限制并发数
sharp.concurrency(1);  // 设置并发数

// 清理缓存
sharp.cache(false);    // 禁用缓存
```

### 5.3 错误处理

```javascript
try {
    await sharp('input.jpg')
        .resize(300)
        .toFile('output.jpg');
} catch (error) {
    if (error.message.includes('Input file is missing')) {
        console.error('文件不存在');
    } else if (error.message.includes('unsupported image format')) {
        console.error('不支持的图片格式');
    } else {
        console.error('处理失败:', error);
    }
}
```
