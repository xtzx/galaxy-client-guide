# 工程化改进

> 项目工程化分析与优化建议

---

## 文档目录

| 文档 | 说明 |
|-----|-----|
| [01-项目分析报告.md](./01-项目分析报告.md) | 项目整体分析、技术栈评估、问题清单 |

---

## 快速概览

### 问题优先级

| 优先级 | 问题 | 状态 |
|-------|------|-----|
| P0 | 修复 .gitignore | ⏳ 待处理 |
| P0 | 修复 ESLint 配置 | ⏳ 待处理 |
| P0 | 清理 package.json 依赖分类 | ⏳ 待处理 |
| P1 | 添加 husky + lint-staged | ⏳ 待处理 |
| P1 | 添加 .env 环境变量管理 | ⏳ 待处理 |
| P1 | 完善 npm scripts | ⏳ 待处理 |
| P2 | 添加 Jest 测试框架 | ⏳ 待处理 |
| P2 | 重构 msg-center 目录结构 | ⏳ 待处理 |
| P3 | 评估 TypeScript 迁移 | ⏳ 待处理 |
| P3 | 评估 Electron 升级方案 | ⏳ 待处理 |

### 技术债务

- **Electron 20.0.2** - 版本过旧，受 ffi-napi 限制无法升级
- **Sequelize 7.0.0-alpha.2** - 使用 Alpha 版本
- **Webpack 4.x** - 建议升级到 5.x
- **纯 JavaScript** - 考虑迁移 TypeScript
