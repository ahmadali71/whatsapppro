const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const sharedTypesDir = path.resolve(projectRoot, 'src/shared-types');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@whatsapp-pro/shared-types': sharedTypesDir,
};

config.resolver.disableHierarchicalLookup = false;
config.maxWorkers = 1;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@whatsapp-pro/shared-types') {
    return context.resolveRequest(
      context,
      path.resolve(sharedTypesDir, 'index.ts'),
      platform
    );
  }
  if (moduleName.startsWith('@whatsapp-pro/shared-types/')) {
    const subPath = moduleName.slice('@whatsapp-pro/shared-types/'.length);
    return context.resolveRequest(
      context,
      path.resolve(sharedTypesDir, subPath),
      platform
    );
  }
  if (moduleName === 'expo-font' || moduleName.startsWith('expo-font/')) {
    return context.resolveRequest(
      { ...context, originModulePath: path.resolve(projectRoot, 'index.js') },
      moduleName,
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
