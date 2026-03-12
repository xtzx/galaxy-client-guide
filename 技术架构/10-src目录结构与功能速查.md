# src 目录结构与功能速查

> 本文档提供 src 目录的完整结构和功能说明，帮助快速定位代码位置。

---

## 快速索引

| 功能分类 | 目录/文件 |
|----------|-----------|
| 消息发送/接收 | `msg-center/business/convert-service/` |
| MQTT任务处理 | `msg-center/business/task-mqtt/` |
| 数据库操作 | `msg-center/business/dao-service/` + `sqlite/entities/` |
| 消息分发路由 | `msg-center/dispatch-center/` |
| 定时任务 | `msg-center/business/timer/` |
| 缓存管理 | `msg-center/core/cache/` |
| 配置常量 | `msg-center/core/data-config/` |
| 逆向通信(IPC) | `msg-center/core/reverse/` |
| 前端通信(WS) | `msg-center/core/front/` |
| 日志上报 | `init/` |

---

## 目录结构详解

```
src/
├── electron.js                    # 【入口】主进程入口，初始化Electron应用、创建窗口、注册事件
├── utils.js                       # 【工具】主进程工具库：路径处理、进程管理、文件操作、配置读取
│
├── common/                        # 【公共模块】跨模块共享的工具和常量
│   ├── createStateWindow.js      # 创建状态提示窗口（登录状态、错误提示）
│   ├── encryptUtil.js            # AES/RSA加密解密工具，用于数据安全传输
│   ├── fetch.js                  # HTTP请求封装，支持重试和超时，调用云端API
│   ├── file.js                   # 文件读写、复制、删除等操作封装
│   ├── format.js                 # 数据格式化：日期、JSON、消息内容
│   ├── gid.js                    # 全局唯一ID生成器，用于任务和消息标识
│   ├── inject.js                 # 注入脚本到微信进程（逆向相关）
│   ├── loadUrl.js                # 加载URL到窗口，支持开发/生产环境切换
│   ├── monitor.js                # 性能监控：CPU、内存使用情况采集
│   ├── net.js                    # 网络状态检测、IP获取
│   ├── notify.js                 # 系统通知和内部事件通知（异常告警）
│   ├── processUsageReport.js     # 进程资源使用情况上报
│   ├── recordActivityInfo.js     # 用户活动信息记录
│   ├── reg.js                    # Windows注册表读写操作
│   ├── screenAdapter.js          # 屏幕分辨率适配，多显示器支持
│   ├── shortcut.js               # 全局快捷键注册和管理
│   ├── store.js                  # 持久化存储封装（electron-store）
│   ├── sys.js                    # 系统信息获取：OS版本、机器码、MAC地址
│   ├── urls.js                   # URL配置管理，根据环境返回不同API地址
│   ├── v8Heap.js                 # V8堆内存快照，用于内存泄漏排查
│   └── worker.js                 # Worker线程工具，CPU密集任务卸载
│
├── event/                         # 【事件模块】应用生命周期和IPC事件处理
│   ├── app.js                    # 应用生命周期事件：启动、退出、崩溃恢复
│   ├── changename.js             # 修改机器人昵称事件处理
│   ├── downloadFile.js           # 文件下载事件：云端资源、媒体文件
│   ├── extractZip.js             # ZIP解压事件：更新包、资源包解压
│   ├── ffmpeg.js                 # 音视频转码事件（FFmpeg调用）
│   ├── ipc.js                    # IPC事件注册中心，主进程与渲染进程通信
│   ├── regedit.js                # 注册表操作事件处理
│   ├── store.js                  # 存储相关事件监听
│   └── updater.js                # 自动更新事件：检查更新、下载、安装
│
├── init/                          # 【初始化模块】应用启动时的初始化逻辑
│   ├── habo.js                   # 哈勃上报初始化，错误和事件追踪
│   ├── initLog.js                # 日志系统初始化配置
│   ├── log.js                    # 日志模块：customLog统一日志接口
│   ├── slsLog.js                 # 阿里云SLS日志上报
│   └── window.js                 # 窗口初始化：主窗口、托盘、开发者工具
│
├── msg-center/                    # 【核心】消息中心，处理所有消息收发和业务逻辑
│   │
│   ├── business/                 # 【业务层】具体业务逻辑实现
│   │   │
│   │   ├── baseConvert.js        # 转换服务基类：parseWxId、parseClientMsg
│   │   ├── baseConvertResponse.js # 响应转换基类
│   │   │
│   │   ├── convert-boost/        # 【增强模块】业务增强和辅助逻辑
│   │   │   ├── chatroomMemberBoost.js    # 群成员变动增强处理
│   │   │   ├── friendDeleteBoost.js      # 好友删除后的清理和通知
│   │   │   ├── handler-contact/          # 联系人处理策略
│   │   │   │   ├── abstractGetContactResponseMsgHandler.js  # 获取联系人响应抽象类
│   │   │   │   ├── addChatroomFriendMsgHandler.js           # 群内加好友处理
│   │   │   │   └── checkZombieFansMsgHandler.js             # 僵尸粉检测处理
│   │   │   ├── newFriendBoost.js         # 新好友添加后的处理
│   │   │   ├── noFriendBoost.js          # 非好友关系处理
│   │   │   ├── sendmsgReport.js          # 消息发送上报增强
│   │   │   ├── strategy-oplog/           # 操作日志策略模式
│   │   │   │   ├── abstractOplogResponseMsgStrategy.js  # oplog抽象策略
│   │   │   │   ├── changRemarkMsgStrategy.js            # 修改备注策略
│   │   │   │   └── exitChatroomMsgStrategy.js           # 退群策略
│   │   │   ├── taskBoost.js              # 任务执行增强
│   │   │   ├── updateChatroomMemberInfo.js # 群成员信息更新
│   │   │   └── workwx/                   # 企业微信增强
│   │   │       ├── workWxConversationBoost.js  # 企微会话增强
│   │   │       └── workwxFriendBoost.js        # 企微好友增强
│   │   │
│   │   ├── convert-response/     # 【响应转换】任务执行结果的响应处理
│   │   │   ├── acceptAddFriendTaskResponse.js      # 接受好友请求任务响应
│   │   │   ├── acceptChatroomInviteTaskResponse.js # 接受群邀请任务响应
│   │   │   ├── addChatroomFriendResponse.js        # 群内加好友响应
│   │   │   ├── announcementResponse.js             # 群公告设置响应
│   │   │   ├── batchDeleteFriendResponse.js        # 批量删除好友响应
│   │   │   ├── changeChatroomNameResponse.js       # 修改群名响应
│   │   │   ├── chatroomPrepareTaskResponse.js      # 建群准备响应
│   │   │   ├── cleanUnreadMsgResponse.js           # 清理未读消息响应
│   │   │   ├── deleteFriendTaskResponse.js         # 删除好友任务响应
│   │   │   ├── exitChatroomTaskResponse.js         # 退群任务响应
│   │   │   ├── getContactLabelListDetailTaskService.js  # 标签详情响应
│   │   │   ├── getContactLabelListTaskService.js   # 标签列表响应
│   │   │   ├── getTicketTaskAndAddFriendResponse.js # ticket加好友响应
│   │   │   ├── inviteChatroomMemberResponse.js     # 邀请入群响应
│   │   │   ├── joinChatroomTaskResponse.js         # 加入群聊响应
│   │   │   ├── kickOutTaskResponse.js              # 踢人任务响应
│   │   │   ├── remarkTaskResponse.js               # 修改备注响应(老版本)
│   │   │   ├── remarkWx4TaskResponse.js            # 修改备注响应(微信4.0)
│   │   │   ├── sendEmojiMsgResponse.js             # 发送表情响应
│   │   │   ├── sendFileAndCardMsgResponse.js       # 发送文件/名片响应
│   │   │   ├── sendPictureMsgResponse.js           # 发送图片响应
│   │   │   ├── sendTextmsgResponse.js              # 发送文本响应
│   │   │   ├── sendVideoMsgResponse.js             # 发送视频响应
│   │   │   ├── wx4AddChatroomFriendTaskResponse.js # 微信4.0群内加好友
│   │   │   ├── wx4AddFriendTaskResponse.js         # 微信4.0通过好友
│   │   │   ├── wx4RecvmsgResponse.js               # 微信4.0消息接收
│   │   │   └── workwx/                             # 企业微信响应（20+文件）
│   │   │
│   │   ├── convert-service/      # 【转换服务】消息类型的业务处理（核心）
│   │   │   ├── activeDeleteFriendService.js        # 主动删除好友
│   │   │   ├── addChatroomMemberResponseService.js # 添加群成员响应
│   │   │   ├── addChatroomMemberService.js         # 添加群成员
│   │   │   ├── addContactLabelService.js           # 添加联系人标签
│   │   │   ├── addFriendRequest.js                 # 好友请求处理
│   │   │   ├── cdnDownloadEndService.js            # CDN下载完成
│   │   │   ├── chatroomMemberNameChangeService.js  # 群成员昵称变更
│   │   │   ├── chatroomMembersDetails.js           # 群成员详情
│   │   │   ├── chatroomMembersListDetails.js       # 群成员列表
│   │   │   ├── chatroomMembersMonitor.js           # 群成员监控
│   │   │   ├── chatuserinfoService.js              # 群用户信息缓存
│   │   │   ├── cleanUnreadMsgService.js            # 清理未读消息
│   │   │   ├── crashMsgNoticeService.js            # 崩溃消息通知
│   │   │   ├── createChatroomResponseService.js    # 新建群聊响应
│   │   │   ├── delContactLabelService.js           # 删除联系人标签
│   │   │   ├── fileDecipherInService.js            # 文件解密
│   │   │   ├── friendsListResponseService.js       # 好友列表响应
│   │   │   ├── friendUpdateService.js              # 好友信息更新
│   │   │   ├── getChatroomMemberDetailResponse.js  # 群成员详情响应
│   │   │   ├── getContactResponseMsgService.js     # 获取联系人响应
│   │   │   ├── handleChatroomMemberRespService.js  # 群成员变动处理
│   │   │   ├── handleDelContactService.js          # 删除联系人/退群
│   │   │   ├── loginService.js                     # 登录服务
│   │   │   ├── logoutService.js                    # 登出服务
│   │   │   ├── modContactRemarkResponseService.js  # ★备注修改通知(4.0)
│   │   │   ├── modifyNicknameHeadService.js        # 修改昵称头像
│   │   │   ├── msgRecordService.js                 # 消息记录
│   │   │   ├── oplogResponseService.js             # 操作日志响应
│   │   │   ├── pongService.js                      # 心跳响应
│   │   │   ├── popFrameMsgService.js               # 弹框消息
│   │   │   ├── recvMsgService.js                   # 接收消息(单条)
│   │   │   ├── recvMsgsService.js                  # 接收消息(批量)
│   │   │   ├── robotQuitChatroomService.js         # 机器人退群
│   │   │   ├── sysMsgRecordService.js              # 系统消息记录
│   │   │   ├── userInfoListService.js              # 用户信息列表
│   │   │   ├── userinfoService.js                  # 用户信息(单个)
│   │   │   ├── wx4AddFriendRequestService.js       # 微信4.0好友申请
│   │   │   └── workwx/                             # 企业微信服务（16个文件）
│   │   │
│   │   ├── convert-taskreport/   # 【任务上报】任务执行结果上报
│   │   │   ├── fail/                               # 失败处理
│   │   │   │   └── friendChatResponseFail.js       # 私聊失败处理
│   │   │   └── workwx/                             # 企业微信任务上报
│   │   │
│   │   ├── dao-model/            # 【数据模型】Sequelize ORM 模型定义
│   │   │   ├── chatrooMemberInfoModel.js           # 群成员信息模型
│   │   │   ├── chatroomInfoModel.js                # 群信息模型
│   │   │   ├── friendModel.js                      # 好友模型
│   │   │   ├── friendRelationModel.js              # 好友关系模型
│   │   │   ├── taskinfoModel.js                    # 任务信息模型
│   │   │   └── workwx/                             # 企业微信数据模型（10个文件）
│   │   │
│   │   ├── dao-service/          # 【数据服务】数据库 CRUD 操作封装
│   │   │   ├── chatroomInfoService.js              # 群信息CRUD
│   │   │   ├── chatroomMemberinfoService.js        # 群成员CRUD
│   │   │   ├── friendRelationService.js            # 好友关系CRUD
│   │   │   ├── friendService.js                    # 好友CRUD
│   │   │   ├── taskinfoService.js                  # 任务信息CRUD
│   │   │   └── workwx/                             # 企业微信数据服务（10个文件）
│   │   │       └── wkExternalUserService.js        # ★企微外部联系人服务
│   │   │
│   │   ├── manager/              # 【管理器】复杂业务管理
│   │   │   └── memberDetailTaskManager.js          # 群成员详情任务管理
│   │   │
│   │   ├── strategy-front/       # 【前端策略】发送到前端的策略模式
│   │   │   ├── abstractSendMsg2FrontStrategy.js    # 抽象策略
│   │   │   ├── sendKickOutMsgFrontStrategy.js      # 踢人消息策略
│   │   │   ├── SendLoginMsgFrontStrategy.js        # 登录消息策略
│   │   │   └── SendRemarkMsgFrontStrategy.js       # 备注消息策略
│   │   │
│   │   ├── task-front/           # 【前端任务】来自前端的任务处理
│   │   │   ├── abstractFrontTask.js                # 前端任务抽象类
│   │   │   ├── forwardTask.js                      # 转发任务
│   │   │   ├── frontLoginTask.js                   # 前端登录任务
│   │   │   ├── FrontLogoutTask.js                  # 前端登出任务
│   │   │   ├── getAllconfigTask.js                 # 获取配置任务
│   │   │   ├── GetMqttConnectionStatusTask.js      # MQTT状态查询
│   │   │   ├── killAppTask.js                      # 杀死应用任务
│   │   │   ├── KillTask.js                         # 杀死进程任务
│   │   │   ├── ReportLogicWorkingTask.js           # 上报工作状态
│   │   │   └── UploadTask.js                       # 上传任务
│   │   │
│   │   ├── task-mqtt/            # 【MQTT任务】云端下发任务的执行（核心）
│   │   │   ├── abstractMqttOptService.js           # MQTT任务抽象类
│   │   │   ├── mqttAcceptChatroomInvite.js         # 接受群邀请
│   │   │   ├── mqttAddChatroomFriendService.js     # 群内加好友
│   │   │   ├── mqttAddChatroomFriendWx4Service.js  # 微信4.0群内加好友
│   │   │   ├── mqttBatchDeleteFriendService.js     # 批量删除好友
│   │   │   ├── mqttChangeRemarkService.js          # 修改备注
│   │   │   ├── mqttChangeRemarkWx4Service.js       # 微信4.0修改备注
│   │   │   ├── mqttChatroomNameService.js          # 修改群名
│   │   │   ├── mqttChatService.js                  # ★聊天消息发送
│   │   │   ├── mqttCleanUnreadMsg.js               # 清理未读消息
│   │   │   ├── mqttDeleteFriendService.js          # 删除好友
│   │   │   ├── mqttExitChatroomService.js          # 退出群聊
│   │   │   ├── mqttFriendListService.js            # 获取好友列表
│   │   │   ├── mqttFriendPassService.js            # 通过好友请求
│   │   │   ├── mqttGetContactLabelListService.js   # 获取标签列表
│   │   │   ├── mqttGroupAnnounceService.js         # 群公告设置
│   │   │   ├── mqttJoinChatroomService.js          # 加入群聊
│   │   │   ├── mqttKickOutService.js               # 踢人出群
│   │   │   ├── mqttReplaceFileService.js           # 替换文件
│   │   │   ├── mqttUploadUserLogService.js         # 上传用户日志
│   │   │   ├── mqttUploadUserMonitorService.js     # 上传监控信息
│   │   │   └── wkwx/                               # 企业微信任务（25个文件）
│   │   │
│   │   └── timer/                # 【定时任务】周期性执行的任务
│   │       ├── CheckChatroomNewMemberTimer.js      # 检查群新成员
│   │       ├── delaySendFrontmsgTimer.js           # ★延迟批量发送前端消息
│   │       ├── GalaxyTaskStatusTimer.js            # 任务状态检查
│   │       ├── GetCloudConfigTimer.js              # 获取云端配置
│   │       ├── GetOssAccessKeyTimer.js             # 获取OSS密钥
│   │       ├── HeartBeatTimer.js                   # 心跳上报
│   │       ├── PingTimer.js                        # Ping检测
│   │       ├── ProcessMakeUpTaskTimer.js           # 任务补偿处理
│   │       ├── ReportMonitorInfoTimer.js           # 监控信息上报
│   │       ├── SearchSuicideMarkTimer.js           # 自杀标记检测
│   │       ├── UploadWorkWxContactLabelTimer.js    # 企微标签上传
│   │       └── UploadWxContactLabelTimer.js        # 微信标签上传
│   │
│   ├── core/                      # 【核心层】基础设施和公共组件
│   │   │
│   │   ├── application-config/   # 【环境配置】不同环境的配置
│   │   │   ├── applicationBase.js    # 基础配置
│   │   │   ├── applicationProd.js    # 生产环境
│   │   │   ├── applicationQa.js      # 测试环境
│   │   │   ├── applicationRd.js      # 开发环境
│   │   │   └── index.js              # 配置入口，根据环境加载
│   │   │
│   │   ├── base-service/         # 【基础服务】服务层通用逻辑
│   │   │   ├── convertService.js         # 个人微信转换服务基类
│   │   │   ├── mqttTaskExcuteFilter.js   # MQTT任务执行过滤器
│   │   │   └── wkConvertService.js       # 企业微信转换服务基类
│   │   │
│   │   ├── bo/                    # 【业务对象】数据传输对象定义
│   │   │   ├── cloud/                    # 云端相关BO
│   │   │   │   ├── robotLoginRecord.js   # 机器人登录记录
│   │   │   │   └── upstream/             # 上行数据（11个文件）
│   │   │   ├── galaxy/                   # Galaxy核心BO（66个文件）
│   │   │   │   ├── downstream/           # 下行数据（任务下发）
│   │   │   │   │   ├── clientTaskBo.js   # 客户端任务
│   │   │   │   │   └── quick/            # 快速消息DTO
│   │   │   │   ├── inner/                # 内部数据结构
│   │   │   │   ├── upstream/             # 上行数据（消息上报）
│   │   │   │   │   └── clientMsgBo.js    # ★客户端消息模板
│   │   │   │   ├── msgResNode.js         # 消息节点（三段式）
│   │   │   │   └── msgResNodeType.js     # 消息节点类型
│   │   │   └── wxInfo.js                 # 微信信息
│   │   │
│   │   ├── cache/                # 【缓存管理】内存缓存
│   │   │   ├── chatroomFetchStateManager.js  # 群拉取状态管理
│   │   │   ├── chatroomInfoCache.js          # 群信息缓存
│   │   │   ├── galaxyTaskCache.js            # ★任务缓存
│   │   │   ├── galaxyVersionCache.js         # 版本缓存
│   │   │   ├── LogicWorkingCache.js          # 工作状态缓存
│   │   │   ├── msgFileCache.js               # 消息文件缓存
│   │   │   ├── msgTaskInfoCache.js           # 消息任务缓存
│   │   │   ├── newFriendCache.js             # 新好友缓存
│   │   │   ├── quickSendCache.js             # 快速发送缓存
│   │   │   ├── remarkTaskCache.js            # 备注任务缓存
│   │   │   └── workwx/                       # 企业微信缓存
│   │   │
│   │   ├── cloud/                # 【云端服务】云端交互相关
│   │   │   ├── filter/                       # 过滤器
│   │   │   │   ├── baseClientTypeFilter.js   # 客户端类型过滤
│   │   │   │   └── logicWorkingStatusFilter.js # 工作状态过滤
│   │   │   └── uploadMetric.js               # 指标上报
│   │   │
│   │   ├── data-config/          # 【常量配置】枚举和常量定义（70+文件）
│   │   │   ├── callbackClassify.js           # ★回调分类（三段式）
│   │   │   ├── flowSourceEnum.js             # ★流来源枚举
│   │   │   ├── galaxyCallBackType.js         # ★回调类型常量
│   │   │   ├── galaxyTaskType.js             # ★任务类型常量
│   │   │   ├── prismRecordType.js            # ★上报类型常量
│   │   │   ├── commonConstant.js             # 通用常量
│   │   │   ├── ipcConstant.js                # IPC常量
│   │   │   ├── msgTypeConstant.js            # 消息类型常量
│   │   │   └── ...                           # 其他常量
│   │   │
│   │   ├── factory/              # 【工厂模式】对象创建工厂
│   │   │   └── clientTaskFactory.js          # 客户端任务工厂
│   │   │
│   │   ├── front/                # 【前端通信】与渲染进程通信
│   │   │   ├── frontServer.js                # 前端WebSocket服务
│   │   │   └── sendToFront.js                # 发送消息到前端
│   │   │
│   │   ├── mq/                   # 【消息队列】MQTT客户端
│   │   │   ├── encryptUtil.js                # MQTT消息加密
│   │   │   ├── mqExcuteMsg.js                # ★MQTT消息执行
│   │   │   ├── mqttClass.js                  # MQTT类封装
│   │   │   ├── mqttClientBase.js             # MQTT客户端基类
│   │   │   ├── mqttConfig.js                 # MQTT配置
│   │   │   ├── mqttHelper.js                 # MQTT辅助函数
│   │   │   └── mqttMakeUpManager.js          # MQTT补偿管理
│   │   │
│   │   ├── pool/                 # 【连接池】资源池管理
│   │   │   ├── reversePoolManager.js         # 逆向连接池
│   │   │   └── wkRomMemberInfoPoolManager.js # 群成员信息池
│   │   │
│   │   ├── queue/                # 【队列管理】内存消息队列
│   │   │   ├── MemoryQueueApplication.js     # 队列应用
│   │   │   ├── MemoryQueueExecute.js         # 队列执行
│   │   │   └── mqTask.js                     # MQ任务
│   │   │
│   │   ├── registry-config/      # 【注册表】机器人注册信息
│   │   │   ├── index.js                      # 注册表入口
│   │   │   └── registryList.js               # 注册列表管理
│   │   │
│   │   ├── reverse/              # 【逆向通信】与微信客户端IPC通信（核心）
│   │   │   ├── asyncSelectTask.js            # ★异步任务选择（消息入口）
│   │   │   ├── dll/                          # Windows DLL文件
│   │   │   │   ├── clibrary.js               # C库封装
│   │   │   │   ├── PipeCore.dll              # 管道核心DLL
│   │   │   │   └── ReUtils.dll               # 工具DLL
│   │   │   ├── initIpcTask.js                # ★IPC任务初始化
│   │   │   ├── ipcConfig.js                  # IPC配置
│   │   │   └── ipcUtil.js                    # IPC工具函数
│   │   │
│   │   ├── utils/                # 【核心工具】业务相关工具函数
│   │   │   ├── aliyunOssManagerUtil.js       # 阿里云OSS管理
│   │   │   ├── audioConversionUtil.js        # 音频转换
│   │   │   ├── chatroomUtil.js               # 群聊工具
│   │   │   ├── fileDownload.js               # 文件下载
│   │   │   ├── fileUtils.js                  # 文件工具
│   │   │   ├── getApolloConfig.js            # Apollo配置获取
│   │   │   ├── sleep.js                      # 延时函数
│   │   │   ├── stringLockUtil.js             # 字符串锁
│   │   │   ├── workWxUtils.js                # 企微工具
│   │   │   └── xmlUtil.js                    # XML解析工具
│   │   │
│   │   └── worker-threads/       # 【Worker线程】多线程处理
│   │       └── workerPool.js                 # Worker线程池
│   │
│   ├── dispatch-center/          # 【分发中心】消息路由和分发（核心）
│   │   │
│   │   ├── dispatch/             # 【流处理器】按来源处理消息
│   │   │   ├── cloudFlowInBound.js           # 云端入站（MQTT→逆向）
│   │   │   ├── cloudFlowOutBound.js          # ★云端出站（逆向→MQTT）
│   │   │   ├── frontFlowInBound.js           # 前端入站（前端→逆向）
│   │   │   ├── frontFlowOutBound.js          # 前端出站（逆向→前端）
│   │   │   └── sendToFront.js                # 发送到前端
│   │   │
│   │   ├── handle/               # 【消息处理器】消息处理逻辑
│   │   │   ├── msgHandleBase.js              # ★消息处理基类（三段式）
│   │   │   ├── wxMsgHandle.js                # 个人微信处理器
│   │   │   ├── workWxMsgHandle.js            # 企业微信处理器
│   │   │   ├── wxUserListResponseMsgHandler.js   # 好友列表响应
│   │   │   └── wkUserListResponseMsgHandler.js   # 企微用户列表响应
│   │   │
│   │   ├── dispatchInBound.js    # ★入站分发（MQTT/前端 → 逆向）
│   │   ├── dispatchOutBound.js   # ★出站分发（逆向 → MQTT/前端）
│   │   ├── frontSend.js          # 前端发送服务
│   │   ├── mqttSend.js           # ★MQTT发送服务
│   │   └── reverseSend.js        # 逆向发送服务
│   │
│   └── start/                    # 【启动模块】应用启动入口
│       ├── appStart.js           # ★应用启动（初始化所有模块）
│       ├── frontStart.js         # 前端服务启动
│       ├── reverseStart.js       # 逆向服务启动
│       └── schedual.js           # 定时任务调度器
│
├── preload/                       # 【Preload】Electron预加载脚本
│   └── index.js                  # 预加载入口，暴露API给渲染进程
│
├── renderer/                      # 【渲染进程】前端界面相关
│   └── index.js                  # 渲染进程入口
│
├── sqlite/                        # 【SQLite】数据库相关
│   ├── index.js                  # 数据库初始化入口
│   ├── schema.sql                # 数据库表结构定义
│   ├── entities/                 # ORM实体定义（17个文件）
│   │   ├── friend.js             # 好友表
│   │   ├── friend_relation.js    # 好友关系表
│   │   ├── chatroom_info.js      # 群信息表
│   │   ├── chatroom_member_info.js # 群成员表
│   │   ├── task_info.js          # 任务信息表
│   │   ├── wk_external_users.js  # 企微外部用户表
│   │   └── ...                   # 其他表
│   └── task/                     # 数据库任务
│
└── test/                          # 【测试】测试文件
    ├── mqtt-test.js              # MQTT测试
    ├── wx-test.js                # 微信测试
    └── ...                       # 其他测试
```

---

## 功能快速定位

### 消息处理相关

| 功能 | 文件路径 |
|------|----------|
| 消息入口（IPC接收） | `msg-center/core/reverse/asyncSelectTask.js` |
| 消息分发路由 | `msg-center/dispatch-center/dispatchOutBound.js` |
| 三段式消息处理 | `msg-center/dispatch-center/handle/msgHandleBase.js` |
| 云端出站处理 | `msg-center/dispatch-center/dispatch/cloudFlowOutBound.js` |
| 消息类型服务注册 | `msg-center/dispatch-center/dispatch/cloudFlowOutBound.js` (WxConvertServiceList) |

### 新增消息类型

| 步骤 | 文件路径 |
|------|----------|
| 1.创建Service | `msg-center/business/convert-service/xxxService.js` |
| 2.注册到列表 | `msg-center/dispatch-center/dispatch/cloudFlowOutBound.js` |
| 3.识别消息类型 | `msg-center/dispatch-center/handle/msgHandleBase.js` |

### MQTT任务处理

| 功能 | 文件路径 |
|------|----------|
| 任务入口 | `msg-center/dispatch-center/dispatchInBound.js` |
| 任务执行基类 | `msg-center/business/task-mqtt/abstractMqttOptService.js` |
| 聊天消息发送 | `msg-center/business/task-mqtt/mqttChatService.js` |
| 任务结果上报 | `msg-center/dispatch-center/mqttSend.js` |

### 数据存储

| 功能 | 文件路径 |
|------|----------|
| 数据库初始化 | `sqlite/index.js` |
| ORM实体定义 | `sqlite/entities/` |
| 数据访问服务 | `msg-center/business/dao-service/` |
| 缓存管理 | `msg-center/core/cache/` |

### 配置和常量

| 功能 | 文件路径 |
|------|----------|
| 环境配置 | `msg-center/core/application-config/` |
| 消息类型常量 | `msg-center/core/data-config/galaxyCallBackType.js` |
| 任务类型常量 | `msg-center/core/data-config/galaxyTaskType.js` |
| 上报类型常量 | `msg-center/core/data-config/prismRecordType.js` |

---

## 架构层次

```
┌─────────────────────────────────────────────────────────────┐
│                        Electron 主进程                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │electron │  │ common/ │  │ event/  │  │  init/  │        │
│  │  .js    │  │  工具库  │  │事件处理 │  │初始化   │        │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
├─────────────────────────────────────────────────────────────┤
│                      msg-center (消息中心)                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  dispatch-center (分发中心)                             │  │
│  │  ├── dispatchInBound   (入站：MQTT/前端 → 逆向)        │  │
│  │  ├── dispatchOutBound  (出站：逆向 → MQTT/前端)        │  │
│  │  └── handle/           (消息处理器)                    │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  business (业务层)                                      │  │
│  │  ├── convert-service/  (消息类型处理服务)               │  │
│  │  ├── task-mqtt/        (MQTT任务执行)                  │  │
│  │  ├── dao-service/      (数据访问服务)                   │  │
│  │  └── timer/            (定时任务)                      │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  core (核心层)                                          │  │
│  │  ├── reverse/          (IPC逆向通信)                   │  │
│  │  ├── mq/               (MQTT客户端)                    │  │
│  │  ├── front/            (前端WebSocket)                 │  │
│  │  ├── cache/            (缓存管理)                      │  │
│  │  └── data-config/      (常量配置)                      │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                     │
│  │ sqlite/ │  │preload/ │  │renderer/│                     │
│  │ 数据库   │  │预加载   │  │渲染进程  │                     │
│  └─────────┘  └─────────┘  └─────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

---

> 文档版本：v1.0  
> 更新日期：2026-02-05
