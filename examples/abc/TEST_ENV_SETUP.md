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

