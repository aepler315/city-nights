import { cp, mkdir } from 'node:fs/promises';
const source = new URL('../node_modules/cesium/Build/Cesium/', import.meta.url);
const destination = new URL('../public/cesium/', import.meta.url);
await mkdir(destination, { recursive: true });
await Promise.all(['Workers', 'ThirdParty', 'Assets', 'Widgets'].map(name =>
  cp(new URL(name, source), new URL(name, destination), { recursive: true })
));
