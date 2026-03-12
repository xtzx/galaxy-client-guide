# fluent-ffmpeg 视频处理

> 音视频处理工具

---

## 一、技术简介

### 1.1 什么是 FFmpeg

FFmpeg 是一个强大的音视频处理工具，可以：
- 转换格式（MP4 → AVI）
- 提取音频/视频
- 生成缩略图
- 压缩视频
- 裁剪/合并

### 1.2 fluent-ffmpeg

`fluent-ffmpeg` 是 FFmpeg 的 Node.js 封装，提供流畅的链式 API：

```javascript
// 原生 FFmpeg 命令
// ffmpeg -i input.mp4 -ss 00:00:01 -vframes 1 output.jpg

// fluent-ffmpeg 写法
ffmpeg('input.mp4')
    .seekInput(1)
    .frames(1)
    .output('output.jpg')
    .run();
```

---

## 二、项目中的使用

### 2.1 使用位置

```
src/event/ffmpeg.js                    # FFmpeg 初始化
src/msg-center/core/utils/videoUtil.js # 视频处理工具
```

### 2.2 初始化配置

```javascript
// src/event/ffmpeg.js

const path = require('path');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const ffmpeg = require('fluent-ffmpeg');

function initFfmpeg() {
    // 设置 ffmpeg 可执行文件路径
    ffmpeg.setFfmpegPath(ffmpegPath);
    // 设置 ffprobe 可执行文件路径（用于获取媒体信息）
    ffmpeg.setFfprobePath(ffprobePath);
}

module.exports = initFfmpeg;
```

### 2.3 生成视频缩略图

```javascript
// src/msg-center/core/utils/videoUtil.js

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const os = require('os');

/**
 * 生成视频缩略图
 * @param {string} videoPath - 视频文件路径
 * @param {string} outputDir - 输出目录
 * @returns {Promise<string>} - 缩略图路径
 */
function generateThumbnail(videoPath, outputDir) {
    return new Promise((resolve, reject) => {
        const filename = `thumb_${Date.now()}.jpg`;
        const outputPath = path.join(outputDir || os.tmpdir(), filename);

        ffmpeg(videoPath)
            // 从第1秒截取
            .seekInput(1)
            // 只取1帧
            .frames(1)
            // 输出尺寸
            .size('320x240')
            // 输出路径
            .output(outputPath)
            // 完成回调
            .on('end', () => {
                resolve(outputPath);
            })
            // 错误回调
            .on('error', (err) => {
                reject(err);
            })
            // 开始执行
            .run();
    });
}

/**
 * 获取视频信息
 * @param {string} videoPath - 视频文件路径
 * @returns {Promise<Object>} - 视频元数据
 */
function getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                reject(err);
                return;
            }

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');

            resolve({
                duration: metadata.format.duration,  // 时长（秒）
                size: metadata.format.size,          // 文件大小
                width: videoStream?.width,           // 宽度
                height: videoStream?.height,         // 高度
                bitrate: metadata.format.bit_rate,   // 比特率
                format: metadata.format.format_name  // 格式
            });
        });
    });
}

module.exports = { generateThumbnail, getVideoInfo };
```

### 2.4 业务中的使用

```javascript
// 发送视频消息时生成缩略图

const { generateThumbnail, getVideoInfo } = require('../../core/utils/videoUtil');

async function handleVideoMessage(videoPath, wxId) {
    // 1. 获取视频信息
    const videoInfo = await getVideoInfo(videoPath);

    // 2. 生成缩略图
    const thumbPath = await generateThumbnail(videoPath);

    // 3. 构建消息
    const message = {
        type: 'video',
        videoPath,
        thumbPath,
        duration: videoInfo.duration,
        width: videoInfo.width,
        height: videoInfo.height
    };

    // 4. 发送到逆向服务
    sendToReverse(wxId, message);
}
```

---

## 三、常用操作

### 3.1 格式转换

```javascript
// MP4 转 AVI
ffmpeg('input.mp4')
    .output('output.avi')
    .run();

// 指定编码器
ffmpeg('input.mp4')
    .videoCodec('libx264')
    .audioCodec('aac')
    .output('output.mp4')
    .run();
```

### 3.2 提取音频

```javascript
// 从视频提取音频
ffmpeg('video.mp4')
    .noVideo()            // 不要视频
    .audioCodec('libmp3lame')
    .output('audio.mp3')
    .run();
```

### 3.3 视频压缩

```javascript
// 降低比特率压缩
ffmpeg('input.mp4')
    .videoBitrate('1000k')
    .audioBitrate('128k')
    .output('compressed.mp4')
    .run();
```

### 3.4 裁剪视频

```javascript
// 裁剪 10-30 秒
ffmpeg('input.mp4')
    .setStartTime(10)     // 开始时间
    .setDuration(20)      // 持续时间
    .output('clip.mp4')
    .run();
```

---

## 四、注意事项

### 4.1 依赖安装

项目使用 `@ffmpeg-installer/ffmpeg` 自动安装预编译的 FFmpeg：

```json
{
  "dependencies": {
    "fluent-ffmpeg": "^2.1.2",
    "ffmpeg-static-electron": "^2.0.3",
    "ffprobe-static-electron": "^2.0.2"
  }
}
```

### 4.2 Electron 打包

打包时需要确保 FFmpeg 可执行文件被包含：

```yaml
# electron-builder 配置
extraResources:
  - from: "node_modules/@ffmpeg-installer/ffmpeg/ffmpeg.exe"
    to: "ffmpeg.exe"
```

### 4.3 错误处理

```javascript
ffmpeg('input.mp4')
    .output('output.avi')
    .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg error:', err.message);
        console.error('FFmpeg stderr:', stderr);
    })
    .on('end', () => {
        console.log('处理完成');
    })
    .run();
```
