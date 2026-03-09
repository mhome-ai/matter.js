# matter.js Controller 代码结构分析（重点：IM 与 Commissioning）

这份文档面向“要把 `matter.js` 当作 controller 核心库”的开发者，重点说明三件事：

1. 代码结构和分层（哪些包最关键）
2. IM（Interaction Model）交互链路（读/写/订阅/调用命令）
3. Commissioning 主流程（发现 -> PASE -> 证书/网络配置 -> CASE -> Complete）

并给出一个可快速上手的最短路径。

---

## 1. 先看整体分层（Controller 视角）

仓库是 monorepo。做 controller 时，核心分层可以理解为：

- **应用层 API（常用入口）**
  - `packages/matter.js/src/CommissioningController.ts`
  - `packages/matter.js/src/device/PairedNode.ts`
  - `examples/controller/src/ControllerNode.ts`（最实用参考）
- **Node/行为层（状态、节点、对端管理）**
  - `packages/node/src/node/client/Peers.ts`
  - `packages/node/src/node/server/InteractionServer.ts`
- **协议层（真正的 Matter 协议实现）**
  - `packages/protocol/src/peer/ControllerCommissioner.ts`
  - `packages/protocol/src/peer/ControllerCommissioningFlow.ts`
  - `packages/protocol/src/action/client/ClientInteraction.ts`
  - `packages/protocol/src/interaction/InteractionMessenger.ts`
- **类型与模型层**
  - `packages/types`（TLV schema、cluster 定义、消息类型）
  - `packages/model`（模型与规范映射）

一句话：`CommissioningController/PairedNode` 是“开发体验层”，`protocol` 才是“协议真身”。

---

## 2. Controller 常用对象关系

你写业务时最常打交道的是下面几个对象：

- `CommissioningController`
  - 生命周期管理：`start()` / `close()`
  - 配网入网：`commissionNode(...)`
  - 获取设备：`getNode(nodeId)` / `getCommissionedNodes()`
- `PairedNode`
  - 节点状态：`isConnected` / `events.stateChanged`
  - 数据与命令：`stateOf(...)` / `commandsOf(...)`
  - 低层 IM：`getInteractionClient()`

典型调用顺序：

1. `new CommissioningController(...)`
2. `await controller.start()`
3. 首次设备：`await controller.commissionNode(...)`
4. 复用设备：`const node = await controller.getNode(nodeId); node.connect();`
5. 读写和命令：`node.stateOf(...)` / `node.commandsOf(...)`

---

## 3. IM（Interaction Model）交互链路（重点）

### 3.1 从业务 API 到协议栈的路径

以“读属性/调用命令/订阅”为例，主链路是：

1. `PairedNode`（业务对象）
2. `packages/matter.js/src/cluster/client/InteractionClient.ts`（高层便捷客户端）
3. `packages/protocol/src/action/client/ClientInteraction.ts`（协议动作执行）
4. `packages/protocol/src/interaction/InteractionMessenger.ts`（IM 消息编解码与收发）
5. `InteractionServer`（设备侧接收并处理）

### 3.2 Read/Write/Invoke/Subscribe 在哪里落地

- **Read**  
  - 入口：`InteractionClient.getMultipleAttributesAndEvents(...)`
  - 协议执行：`ClientInteraction.read(...)`
  - 消息：`InteractionClientMessenger.sendReadRequest(...)` -> `ReportData`
- **Write**
  - 入口：`InteractionClient.setAttribute(...)` / `setMultipleAttributes(...)`
  - 协议执行：`ClientInteraction.write(...)`
  - 特点：支持 timed write、list chunk 写入、group 写限制
- **Invoke**
  - 入口：`InteractionClient.invoke(...)`
  - 协议执行：`ClientInteraction.invoke(...)`
  - 特点：超过 `maxPathsPerInvoke` 自动拆批并行 invoke
- **Subscribe**
  - 入口：`InteractionClient.subscribe...` / `PairedNode.subscribeAllAttributesAndEvents(...)`
  - 协议执行：`ClientInteraction.subscribe(...)`
  - 特点：支持 sustained subscription、断线重连、首次全量 + 后续增量

### 3.3 `PairedNode` 在 IM 上做了什么增强

`PairedNode` 不是纯薄封装，它在 controller 场景做了很多实用增强：

- 自动连接与重连（`NodeStates` 状态机）
- 默认“读全量 + 订阅全量”（可关闭 `autoSubscribe`）
- 将订阅更新映射回本地缓存和 typed API
- 结构变化检测（`Descriptor.partsList/serverList/clientList` 变化后重建 endpoint 结构）
- shutdown/断连后的重连调度（指数退避）

这也是它适合做“controller 产品层封装基础”的原因。

---

## 4. Commissioning 主流程（重点）

### 4.1 总入口

- 应用层调用：`CommissioningController.commissionNode(...)`
- 继续下探：`MatterController.commission(...)`
- 协议层执行：`ControllerCommissioner.commissionWithDiscovery(...)`

### 4.2 发现 + PASE

`ControllerCommissioner.discoverAndEstablishPase(...)` 做这些事：

1. 根据 `identifierData` / `knownAddress` / `discoveryCapabilities` 发现设备
2. 优先尝试 known address，失败再走扫描
3. 对地址建立初始通道（UDP 或 BLE）
4. 通过 `PaseClient` 建立 PASE 安全会话

### 4.3 Step-based Commissioning（核心在 `ControllerCommissioningFlow`）

`ControllerCommissioningFlow.executeCommissioning()` 按步骤跑（含 failsafe 管理）：

- Step 0: 读取初始信息（fabrics、descriptor、basic info、network 特征）
- Step 7: `GeneralCommissioning.armFailSafe`
- Step 8: 监管信息配置（regulatory info；时间同步目前基本跳过）
- Step 10: Device Attestation（DAC/PAI/attestation）
- Step 11-13: CSR -> 生成 NOC -> `addTrustedRootCertificate` + `addNoc`
- Step 15: ACL（默认跳过额外配置）
- Step 16-17（BLE 场景常见）：Wi-Fi/Thread 网络配置与连接
- Step 18-19: 迁移到 CASE（operational discovery + CASE session）
- Step 20: `commissioningComplete`
- Step 98/99: 可选 fabric label update / OTA provider 配置

### 4.4 CASE 完成与收尾

在 `ControllerCommissioner.#commissionConnectedNode(...)` 里：

- 根据设备是否支持并发连接决定是否提前关闭 PASE
- 做 operational discovery 并连接 CASE
- 完成 `commissioningComplete`
- 最终关闭 PASE，返回 `PeerAddress`

如果你要定制流程，可以传 `commissioningFlowImpl`（继承 `ControllerCommissioningFlow`）。

---

## 5. 如何快速上手（做你自己的 controller）

推荐直接从 `examples/controller/src/ControllerNode.ts` 起步，改成你自己的服务化结构。

### 5.1 最短启动路径

1. 初始化环境并创建 `CommissioningController`
2. `await start()`
3. 若无已配对设备：`commissionNode(...)`
4. `getNode(nodeId)` + `node.connect()`
5. 订阅 `node.events.attributeChanged / eventTriggered / stateChanged`
6. 用 `stateOf(...)` 和 `commandsOf(...)` 做业务读写

### 5.2 Commissioning 参数最小集合

至少准备：

- `passcode`
- `discovery.identifierData`（短码/长码/instance id 之一）
- BLE 场景下如需入网：`commissioning.wifiNetwork` 或 `commissioning.threadNetwork`

### 5.3 你做 controller 产品时的建议

- **优先使用 `PairedNode` 的事件和状态机**，避免自己重写 reconnect 逻辑
- **尽量保持 `autoSubscribe=true`**，让本地状态缓存可直接驱动业务
- **把 `commissioningFlowImpl` 留作可插拔点**，便于后续做认证、审计、厂商自定义流程
- **把 NodeId 与 storage id 做稳定映射**，便于多设备管理与重启恢复
- **对 Thread/BLE 场景重点测试 failsafe 与超时**（长流程最容易踩坑）

---

## 6. 你最该盯住的源码文件

如果只看少量文件，优先看这 8 个：

- `examples/controller/src/ControllerNode.ts`
- `packages/matter.js/src/CommissioningController.ts`
- `packages/matter.js/src/device/PairedNode.ts`
- `packages/matter.js/src/cluster/client/InteractionClient.ts`
- `packages/protocol/src/peer/ControllerCommissioner.ts`
- `packages/protocol/src/peer/ControllerCommissioningFlow.ts`
- `packages/protocol/src/action/client/ClientInteraction.ts`
- `packages/protocol/src/interaction/InteractionMessenger.ts`

---

## 7. 给“拿来做 controller”的结论

- 这套代码对 controller 场景是可用且成熟的，尤其是 `CommissioningController + PairedNode` 这层。
- 真正的协议复杂性（IM 分片、chunk、重连、timed 交互、commissioning 步骤）已在下层处理。
- 你的主要工作应放在：
  - 设备生命周期与业务建模
  - 权限/租户与持久化策略
  - 失败重试策略和可观测性（日志、指标、告警）

如果后续你要做“多设备并发 + 任务队列 + 云端同步”版本，建议先在这份链路图基础上把 `PairedNode` 再包一层“DeviceSessionManager”。

