const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, '../node_modules')];
// Expo's dev-server virtual entry resolves './index' against the workspace root in this
// monorepo; redirect that single request to the mobile entry file.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === './index' || moduleName === './index.ts') {
    try {
      return context.resolveRequest(context, moduleName, platform);
    } catch {
      return { type: 'sourceFile', filePath: path.resolve(__dirname, 'index.ts') };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
