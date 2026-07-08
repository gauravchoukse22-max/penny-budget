const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web worker imports its wasm binary directly; treat .wasm as
// a bundleable asset so web preview builds (native iOS/Android don't need this).
config.resolver.assetExts.push('wasm');

module.exports = config;
