# Matter.js 测试环境搭建说明（abc）

## 1. 目标与总体思路

你当前的目标是：高效验证自研 Matter Controller 的配网、建连、读写、命令、订阅能力，并且能扩展到批量回归。

建议分两层测试环境：

- 单节点多 endpoint：快速覆盖多 cluster 行为，只需配网一次，迭代快。
- 多节点批量：验证真实节点生命周期（发现、commission、重连、节点管理）。

这两层不是二选一，而是先后组合：先单节点多 endpoint 稳定功能，再上多节点压全链路。

## 2. 你当前可直接使用的脚本与配置

本目录已经有可运行资产：

- 启动脚本：`examples/abc/src/DiverseComposedDeviceNode.ts`
- 配置文件：`examples/abc/config/diverse-device.yml`
- 根命令：`npm run device-composed-diverse`

启动命令：

```bash
npm run device-composed-diverse -- --storage-path=.matter/abc-dev1 --storage-clear --config=examples/abc/config/diverse-device.yml
```

说明：

- 脚本按 YAML 精确创建 endpoint，不走随机。
- `temp-sensor`/`humidity-sensor` 支持序列化值更新（`temperatureSequence` / `humiditySequence`）。
- `ct-light` 和 `extended-light` 已补齐 ColorControl 关键初始化字段，避免 conformance 启动报错。

## 3. 测试环境布置建议

### A. 功能覆盖（推荐第一阶段）

用 1 个节点，配置 10~50 个 endpoint，混合：

- `onoff-light`
- `onoff-socket`
- `dimmable-light`
- `ct-light`
- `extended-light`
- `temp-sensor`
- `humidity-sensor`

重点验证：

- Controller 配网后的结构发现是否完整。
- 各 endpoint 的 cluster 读写/命令是否正常。
- 订阅是否稳定、值变化是否及时。

### B. 生命周期压测（第二阶段）

再扩展为多节点脚本（每节点独立 `port/discriminator/passcode/storage-path`），做：

- 批量 commissioning
- 批量 reconnect
- 节点上下线恢复

## 4. Matter.js 标准 server 结构（你关心的点）

Matter.js 中“标准 server”大体分三类：

- 完整默认实现（逻辑较多）
  - 例：`level-control/LevelControlServer.ts`
  - 例：`color-control/ColorControlServer.ts`
- 中等实现（含默认行为，可扩展）
  - 例：`on-off/OnOffServer.ts`
  - 例：`temperature-measurement/TemperatureMeasurementServer.ts`
- 骨架型实现（类型/接口为主，业务逻辑需自定义）
  - 例：`microwave-oven-control/MicrowaveOvenControlServer.ts`

核心目录：

- 标准行为实现：`packages/node/src/behaviors/`
- 设备类型定义：`packages/node/src/devices/`

额外说明：

- 很多 behavior/server 文件是 codegen 产物（文件头可见 generated 标记）。
- 来源是 Matter 规范模型 + CHIP/ZAP 数据整合后的生成流程，不是纯手写。

### 4.1 `packages/node/src/behaviors/` 应该怎么用

可以把这一层理解成“Cluster Server 能力库”：

- `XxxBehavior.ts`：行为定义与类型接口（很多是 generated）。
- `XxxServer.ts`：默认 server 实现（有的完整、有的只是骨架）。
- `XxxClient.ts`：客户端访问封装（给 controller 或 peer 侧用）。

你写设备示例时，通常有 3 种接入方式：

1. 直接用设备定义（最省事）  
   `new Endpoint(ColorTemperatureLightDevice, {...})`
2. 覆写标准 server（做定制命令/状态逻辑）  
   例如自定义 `OnOffServer`、`RvcRunModeServer`。
3. 加自定义 cluster behavior（厂商扩展）  
   用 `.with(CustomBehavior)` 把自定义行为挂到设备定义。

### 4.2 哪些 cluster 适合先做“可证明”的实现

建议按“复杂度递进”做 demo，便于给团队证明你在用标准 behaviors：

- 第 1 层（基础交互）
  - `on-off/OnOffServer.ts`
  - `identify/IdentifyServer.ts`
- 第 2 层（调光/颜色）
  - `level-control/LevelControlServer.ts`
  - `color-control/ColorControlServer.ts`
- 第 3 层（测量/订阅）
  - `temperature-measurement/TemperatureMeasurementServer.ts`
  - `relative-humidity-measurement/RelativeHumidityMeasurementServer.ts`
- 第 4 层（配网与生命周期）
  - `general-commissioning/GeneralCommissioningServer.ts`
  - `operational-credentials/OperationalCredentialsServer.ts`
  - `network-commissioning/NetworkCommissioningServer.ts`

### 4.3 快速判断“这个 server 能不能直接用”

看 `XxxServer.ts` 文件：

- 仅 `extends XxxBehavior` 且没有 override：通常是骨架，业务逻辑要你补。
- 有大量命令/状态处理：通常可直接用于测试（如 `LevelControlServer`、`ColorControlServer`）。

看对应 `devices/*.ts` 文件：

- 若 `SupportedBehaviors(...)` 已包含该 server，创建 endpoint 时会自动带上。
- 若注释提示“需手动启用 feature”，就要在 `.with(...)` 或 endpoint 初始化时明确给特性和必要属性。

### 4.4 你可以新增的“证明用”示例矩阵

建议在 `examples/abc` 继续加 4 个最小示例（每个都可被 controller 自动回归）：

- `abc-onoff-basic`：验证配网 + toggle + 订阅回调。
- `abc-dimmer-level`：验证 level 写入、step/move、边界值。
- `abc-ct-color`：验证 color temperature 读写与 mode 切换。
- `abc-sensor-subscribe`：验证传感器周期上报与断线重连后恢复订阅。

每个示例都记录 3 类结果，作为“证明”材料：

- 命令链路：invoke 是否成功（状态码、耗时）。
- 状态链路：attribute read/write 是否符合预期。
- 订阅链路：事件/属性增量是否连续、是否丢帧。

## 5. 你可直接复用的官方示例

### Controller 侧

- `examples/controller/src/ControllerNode.ts`
- `examples/control-onoff/src/OnOffController.ts`
- `examples/controller-shared-fabric/`

### Device/组合设备侧

- `examples/device-onoff/src/DeviceNode.ts`
- `examples/device-onoff-light/src/LightDevice.ts`
- `examples/device-sensor/src/SensorDeviceNode.ts`
- `examples/device-composed-onoff/src/ComposedDeviceNode.ts`
- `examples/device-bridge-onoff/src/BridgedDevicesNode.ts`
- `examples/device-multiple-onoff/src/MultiDeviceNode.ts`

### 自定义/高级 server 实现参考

- `examples/device-onoff-advanced/src/DeviceNodeFull.ts`
- `examples/device-onoff-advanced/src/cluster/MyFancyOwnFunctionality.ts`
- `examples/device-robotic-vacuum-cleaner/src/behaviors/`

## 6. 建议的后续落地

- 保持 `examples/abc/config/*.yml` 作为测试场景模板（smoke/regression/stress）。
- 为 controller 增加按 endpoint-profile 的自动校验用例（read/write/invoke/subscribe）。
- 再补一套多节点启动 + 批量 commissioning 脚本，形成完整 CI 回归入口。

