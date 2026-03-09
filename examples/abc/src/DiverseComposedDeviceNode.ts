#!/usr/bin/env node
/**
 * One composed Matter device configured by YAML.
 */

import { ColorControl } from "@matter/main/clusters";
import { DeviceTypeId, Endpoint, Environment, Logger, ServerNode, Time, VendorId } from "@matter/main";
import { ColorTemperatureLightDevice } from "@matter/main/devices/color-temperature-light";
import { DimmableLightDevice } from "@matter/main/devices/dimmable-light";
import { ExtendedColorLightDevice } from "@matter/main/devices/extended-color-light";
import { HumiditySensorDevice } from "@matter/main/devices/humidity-sensor";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parse } from "yaml";

type EndpointProfile =
    | "onoff-light"
    | "onoff-socket"
    | "dimmable-light"
    | "ct-light"
    | "extended-light"
    | "temp-sensor"
    | "humidity-sensor";

type NodeConfig = {
    uniqueId?: string;
    port?: number;
    passcode?: number;
    discriminator?: number;
    vendorId?: number;
    productId?: number;
    vendorName?: string;
    productName?: string;
    nodeLabel?: string;
    serialNumber?: string;
    deviceType?: string;
};

type EndpointConfig = {
    id?: string;
    profile: string;
    intervalSeconds?: number;
    temperatureSequence?: number[];
    humiditySequence?: number[];
};

type RootConfig = {
    node?: NodeConfig;
    defaults?: {
        sensorIntervalSeconds?: number;
    };
    endpoints?: EndpointConfig[];
};

type EndpointSpec = {
    profile: EndpointProfile;
    id: string;
    endpoint: Endpoint;
    startUpdater?: () => void;
};

const logger = Logger.get("DiverseComposedDeviceNode");
const environment = Environment.default;

const config = await loadConfig();
const nodeConfig = config.node ?? {};
const endpointConfigs = config.endpoints ?? [];
if (endpointConfigs.length === 0) {
    throw new Error("Config must define at least one endpoint");
}

const passcode = nodeConfig.passcode ?? 20202021;
const discriminator = nodeConfig.discriminator ?? 3840;
const vendorId = nodeConfig.vendorId ?? 0xfff1;
const productId = nodeConfig.productId ?? 0x8000;
const port = nodeConfig.port ?? 5540;
const uniqueId = nodeConfig.uniqueId ?? Time.nowMs.toString();
const vendorName = nodeConfig.vendorName ?? "matter.js";
const productName = nodeConfig.productName ?? "Diverse Composed Device";
const nodeLabel = nodeConfig.nodeLabel ?? productName;
const rootDeviceType = parseProfile(nodeConfig.deviceType) ?? parseProfile(endpointConfigs[0].profile) ?? "onoff-light";
const defaultSensorInterval = Math.max(1, config.defaults?.sensorIntervalSeconds ?? 10);

const server = await ServerNode.create({
    id: uniqueId,
    network: { port },
    commissioning: { passcode, discriminator },
    productDescription: {
        name: productName,
        deviceType: DeviceTypeId(getDeviceType(rootDeviceType)),
    },
    basicInformation: {
        vendorName,
        vendorId: VendorId(vendorId),
        nodeLabel,
        productName,
        productLabel: productName,
        productId,
        serialNumber: nodeConfig.serialNumber ?? `matterjs-${uniqueId}`,
        uniqueId,
    },
});

const specs: EndpointSpec[] = [];
for (let i = 0; i < endpointConfigs.length; i++) {
    const spec = createEndpointSpec(i + 1, endpointConfigs[i], defaultSensorInterval);
    await server.add(spec.endpoint);
    specs.push(spec);
}

await server.start();

for (const spec of specs) {
    spec.startUpdater?.();
}

console.log(`Device started on port ${port}`);
console.log(`Manual setup code and QR are printed by matter.js when needed`);
for (const spec of specs) {
    console.log(`${spec.id}: ${spec.profile}`);
}

async function loadConfig() {
    const configPath = environment.vars.string("config") ?? "examples/abc/config/diverse-device.yml";
    const absolutePath = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
    const content = await readFile(absolutePath, "utf8");
    return parse(content) as RootConfig;
}

function createEndpointSpec(index: number, config: EndpointConfig, defaultSensorInterval: number): EndpointSpec {
    const profile = parseProfile(config.profile);
    if (profile === undefined) {
        throw new Error(`Invalid profile for endpoint ${index}: ${config.profile}`);
    }
    const id = config.id?.trim() || `ep-${index}-${profile}`;
    if (profile === "onoff-light") {
        const endpoint = new Endpoint(OnOffLightDevice, { id });
        return { profile, id, endpoint };
    }
    if (profile === "onoff-socket") {
        const endpoint = new Endpoint(OnOffPlugInUnitDevice, { id });
        return { profile, id, endpoint };
    }
    if (profile === "dimmable-light") {
        const endpoint = new Endpoint(DimmableLightDevice, { id });
        return { profile, id, endpoint };
    }
    if (profile === "ct-light") {
        const endpoint = new Endpoint(ColorTemperatureLightDevice, {
            id,
            colorControl: {
                colorTempPhysicalMinMireds: 1,
                colorTempPhysicalMaxMireds: 65279,
                coupleColorTempToLevelMinMireds: 1,
                colorTemperatureMireds: 250,
                colorMode: ColorControl.ColorMode.ColorTemperatureMireds,
                enhancedColorMode: ColorControl.EnhancedColorMode.ColorTemperatureMireds,
            },
        });
        return { profile, id, endpoint };
    }
    if (profile === "extended-light") {
        const endpoint = new Endpoint(ExtendedColorLightDevice, {
            id,
            colorControl: {
                colorTempPhysicalMinMireds: 1,
                colorTempPhysicalMaxMireds: 65279,
                coupleColorTempToLevelMinMireds: 1,
                colorTemperatureMireds: 250,
                colorMode: ColorControl.ColorMode.ColorTemperatureMireds,
                enhancedColorMode: ColorControl.EnhancedColorMode.ColorTemperatureMireds,
            },
        });
        return { profile, id, endpoint };
    }
    if (profile === "temp-sensor") {
        const sequence = parseNumericSequence(config.temperatureSequence, [2100]);
        const intervalSeconds = Math.max(1, config.intervalSeconds ?? defaultSensorInterval);
        const endpoint = new Endpoint(TemperatureSensorDevice, {
            id,
            temperatureMeasurement: {
                measuredValue: sequence[0],
            },
        });
        const startUpdater = () => {
            if (sequence.length <= 1) return;
            let pointer = 0;
            setInterval(() => {
                pointer = (pointer + 1) % sequence.length;
                endpoint
                    .set({ temperatureMeasurement: { measuredValue: sequence[pointer] } })
                    .catch(error => logger.error(error));
            }, intervalSeconds * 1000);
        };
        return { profile, id, endpoint, startUpdater };
    }
    const sequence = parseNumericSequence(config.humiditySequence, [5000]);
    const intervalSeconds = Math.max(1, config.intervalSeconds ?? defaultSensorInterval);
    const endpoint = new Endpoint(HumiditySensorDevice, {
        id,
        relativeHumidityMeasurement: {
            measuredValue: sequence[0],
        },
    });
    const startUpdater = () => {
        if (sequence.length <= 1) return;
        let pointer = 0;
        setInterval(() => {
            pointer = (pointer + 1) % sequence.length;
            endpoint
                .set({ relativeHumidityMeasurement: { measuredValue: sequence[pointer] } })
                .catch(error => logger.error(error));
        }, intervalSeconds * 1000);
    };
    return { profile, id, endpoint, startUpdater };
}

function getDeviceType(profile: EndpointProfile) {
    switch (profile) {
        case "onoff-socket":
            return OnOffPlugInUnitDevice.deviceType;
        case "dimmable-light":
            return DimmableLightDevice.deviceType;
        case "ct-light":
            return ColorTemperatureLightDevice.deviceType;
        case "extended-light":
            return ExtendedColorLightDevice.deviceType;
        case "temp-sensor":
            return TemperatureSensorDevice.deviceType;
        case "humidity-sensor":
            return HumiditySensorDevice.deviceType;
        default:
            return OnOffLightDevice.deviceType;
    }
}

function parseNumericSequence(value: unknown, fallback: number[]) {
    if (!Array.isArray(value)) return fallback;
    const numbers = value
        .map(entry => Number(entry))
        .filter(entry => Number.isFinite(entry))
        .map(entry => Math.round(entry));
    return numbers.length > 0 ? numbers : fallback;
}

function parseProfile(value?: string): EndpointProfile | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim().toLowerCase();
    switch (normalized) {
        case "onoff":
        case "light":
        case "onoff-light":
            return "onoff-light";
        case "socket":
        case "plug":
        case "onoff-socket":
            return "onoff-socket";
        case "dimmable":
        case "dimmable-light":
            return "dimmable-light";
        case "ct":
        case "color-temperature":
        case "ct-light":
            return "ct-light";
        case "extended":
        case "rgb":
        case "extended-light":
            return "extended-light";
        case "temp":
        case "temperature":
        case "temp-sensor":
            return "temp-sensor";
        case "humidity":
        case "humidity-sensor":
            return "humidity-sensor";
        default:
            return undefined;
    }
}
