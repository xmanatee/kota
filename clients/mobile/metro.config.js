const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedClientRoot = path.resolve(projectRoot, '../shared');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  ...new Set([...(config.watchFolders ?? []), sharedClientRoot]),
];

module.exports = config;
