# fast-xml-parser XML解析

> 高性能 XML 解析器

---

## 一、技术简介

### 1.1 什么是 fast-xml-parser

`fast-xml-parser` 是 JavaScript 中最快的 XML 解析器之一：

- **高性能**：比 xml2js 快 10-50 倍
- **无依赖**：纯 JavaScript 实现
- **双向转换**：XML ↔ JSON
- **可配置**：灵活的解析选项

### 1.2 为什么需要 XML 解析

微信/企微的消息内容多为 XML 格式：

```xml
<msg>
    <appmsg appid="" sdkver="0">
        <title>文章标题</title>
        <des>文章描述</des>
        <type>5</type>
        <url>https://example.com</url>
    </appmsg>
</msg>
```

需要解析为 JavaScript 对象才能处理。

---

## 二、项目中的使用

### 2.1 使用位置

```
src/msg-center/core/utils/xmlUtil.js         # XML 工具
src/msg-center/core/msg-handle/msgHandleBase.js  # 消息解析
src/msg-center/business/convert-service/     # 消息转换服务
```

### 2.2 XML 工具封装

```javascript
// src/msg-center/core/utils/xmlUtil.js

const { XMLParser, XMLBuilder } = require('fast-xml-parser');

// 解析器配置
const parserOptions = {
    ignoreAttributes: false,      // 不忽略属性
    attributeNamePrefix: '@_',    // 属性前缀
    textNodeName: '#text',        // 文本节点名
    parseAttributeValue: true,    // 解析属性值类型
    trimValues: true,             // 去除空白
    parseTagValue: true,          // 解析标签值类型
    isArray: (name, jpath, isLeafNode) => {
        // 某些标签始终解析为数组
        if (['member', 'item'].includes(name)) {
            return true;
        }
        return false;
    }
};

const parser = new XMLParser(parserOptions);

/**
 * 解析 XML 为 JSON
 */
function parseXml(xmlString) {
    try {
        return parser.parse(xmlString);
    } catch (error) {
        console.error('XML 解析失败:', error);
        return null;
    }
}

/**
 * JSON 转 XML
 */
const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
});

function buildXml(jsonObj) {
    return builder.build(jsonObj);
}

module.exports = { parseXml, buildXml };
```

### 2.3 消息解析中的使用

```javascript
// src/msg-center/core/msg-handle/msgHandleBase.js

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
});

/**
 * 解析消息内容
 */
function parseMessageContent(content, msgType) {
    // 文本消息直接返回
    if (msgType === 1) {
        return { text: content };
    }

    // XML 消息需要解析
    try {
        const parsed = parser.parse(content);

        // 处理不同类型
        switch (msgType) {
            case 49:  // 应用消息
                return parseAppMsg(parsed);
            case 47:  // 表情
                return parseEmoji(parsed);
            case 42:  // 名片
                return parseCard(parsed);
            default:
                return parsed;
        }
    } catch (error) {
        console.error('消息解析失败:', content);
        return { raw: content };
    }
}

/**
 * 解析应用消息
 */
function parseAppMsg(parsed) {
    const appmsg = parsed?.msg?.appmsg || {};

    return {
        type: appmsg.type,
        title: appmsg.title,
        desc: appmsg.des,
        url: appmsg.url,
        thumbUrl: appmsg.thumburl
    };
}
```

### 2.4 业务中的使用示例

```javascript
// 解析群聊邀请消息
function parseRoomInvite(content) {
    const parsed = parser.parse(content);

    // <sysmsg type="sysmsgtemplate">
    //   <sysmsgtemplate>
    //     <content_template>
    //       <link_list>
    //         <link name="username">xxx</link>
    //       </link_list>
    //     </content_template>
    //   </sysmsgtemplate>
    // </sysmsg>

    const links = parsed?.sysmsg?.sysmsgtemplate?.content_template?.link_list?.link || [];
    const inviter = links.find(l => l['@_name'] === 'username');

    return {
        inviter: inviter?.['#text']
    };
}
```

---

## 三、常用 API

### 3.1 XML 转 JSON

```javascript
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser();

// 基础解析
const xml = '<root><name>张三</name><age>25</age></root>';
const json = parser.parse(xml);
console.log(json);
// { root: { name: '张三', age: 25 } }
```

### 3.2 带属性解析

```javascript
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
});

const xml = '<user id="123" type="admin"><name>张三</name></user>';
const json = parser.parse(xml);
console.log(json);
// {
//   user: {
//     '@_id': '123',
//     '@_type': 'admin',
//     name: '张三'
//   }
// }
```

### 3.3 JSON 转 XML

```javascript
const { XMLBuilder } = require('fast-xml-parser');

const builder = new XMLBuilder();

const json = { root: { name: '张三', age: 25 } };
const xml = builder.build(json);
console.log(xml);
// <root><name>张三</name><age>25</age></root>
```

### 3.4 格式化输出

```javascript
const builder = new XMLBuilder({
    format: true,           // 格式化
    indentBy: '  '          // 缩进
});

const xml = builder.build(json);
// <root>
//   <name>张三</name>
//   <age>25</age>
// </root>
```

---

## 四、解析选项详解

### 4.1 常用选项

```javascript
const parser = new XMLParser({
    // 属性相关
    ignoreAttributes: false,      // 是否忽略属性
    attributeNamePrefix: '@_',    // 属性名前缀

    // 文本节点
    textNodeName: '#text',        // 文本节点名称
    cdataPropName: '__cdata',     // CDATA 名称

    // 值解析
    parseTagValue: true,          // 自动转换数字
    parseAttributeValue: true,    // 属性值也自动转换
    trimValues: true,             // 去除首尾空白

    // 数组处理
    isArray: (name) => {          // 哪些标签解析为数组
        return ['item', 'member'].includes(name);
    },

    // 命名空间
    removeNSPrefix: true          // 移除命名空间前缀
});
```

### 4.2 数组处理

```javascript
// XML 中单个 item 会被解析为对象，多个才是数组
// 使用 isArray 确保一致性

const parser = new XMLParser({
    isArray: (name, jpath) => {
        // jpath 是路径，如 "root.items.item"
        if (name === 'item') return true;
        return false;
    }
});

// 单个 item
// <items><item>1</item></items>
// 结果：{ items: { item: [1] } }  // 始终是数组
```

### 4.3 CDATA 处理

```javascript
const parser = new XMLParser({
    cdataPropName: '__cdata'
});

const xml = '<msg><![CDATA[文本内容]]></msg>';
const json = parser.parse(xml);
// { msg: { __cdata: '文本内容' } }
```

---

## 五、项目中的常见 XML 结构

### 5.1 应用消息

```xml
<msg>
    <appmsg appid="" sdkver="0">
        <title>标题</title>
        <des>描述</des>
        <type>5</type>
        <url>https://example.com</url>
        <thumburl>https://example.com/thumb.jpg</thumburl>
    </appmsg>
</msg>
```

```javascript
const parsed = parser.parse(xml);
const title = parsed?.msg?.appmsg?.title;
```

### 5.2 名片消息

```xml
<msg>
    <bigheadimgurl>头像URL</bigheadimgurl>
    <smallheadimgurl>小头像</smallheadimgurl>
    <username>微信号</username>
    <nickname>昵称</nickname>
    <sex>1</sex>
</msg>
```

### 5.3 系统消息

```xml
<sysmsg type="sysmsgtemplate">
    <sysmsgtemplate>
        <content_template type="tmpl_type_profile">
            <plain>邀请你加入群聊</plain>
            <link_list>
                <link name="username" type="link_profile">
                    <memberlist>
                        <member>wxid_xxx</member>
                    </memberlist>
                </link>
            </link_list>
        </content_template>
    </sysmsgtemplate>
</sysmsg>
```

---

## 六、与 React 开发对比

### 6.1 前端 XML 处理

```javascript
// 浏览器中通常用 DOMParser
const parser = new DOMParser();
const doc = parser.parseFromString(xml, 'text/xml');
const title = doc.querySelector('title').textContent;

// 或用 fast-xml-parser（也可在浏览器使用）
import { XMLParser } from 'fast-xml-parser';
```

### 6.2 关键区别

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 vs Node.js XML 处理                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  React 前端：                                                   │
│  - 很少处理 XML（主要是 JSON）                                   │
│  - 可用 DOMParser（浏览器内置）                                  │
│  - 可用 fast-xml-parser                                         │
│                                                                 │
│  Node.js 后端：                                                 │
│  - 经常处理各种协议的 XML                                        │
│  - fast-xml-parser 性能最佳                                      │
│  - 需要处理大量 XML 数据                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 七、性能对比

### 7.1 与其他库对比

| 库 | 解析速度 | 特点 |
|---|---|---|
| fast-xml-parser | 最快 | 推荐使用 |
| xml2js | 慢 | 功能丰富 |
| xmldom | 中等 | DOM 风格 |

### 7.2 性能优化

```javascript
// 复用 parser 实例
const parser = new XMLParser(options);

// 避免每次都创建新实例
function parse(xml) {
    return parser.parse(xml);  // 复用
}
```

---

## 八、调试技巧

### 8.1 解析失败处理

```javascript
function safeParseXml(xml) {
    try {
        return parser.parse(xml);
    } catch (error) {
        console.error('XML 解析失败:', xml.substring(0, 100));
        console.error('错误:', error.message);
        return null;
    }
}
```

### 8.2 验证 XML

```javascript
const { XMLValidator } = require('fast-xml-parser');

const result = XMLValidator.validate(xml);
if (result === true) {
    // 有效 XML
} else {
    console.error('无效 XML:', result.err);
}
```

### 8.3 查看解析结果

```javascript
// 开发时打印结构
const parsed = parser.parse(xml);
console.log(JSON.stringify(parsed, null, 2));
```
