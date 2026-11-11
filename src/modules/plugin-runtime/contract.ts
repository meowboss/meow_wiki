/** Compatibility entry point for backend consumers; browsers use packages/plugin-sdk. */
export {
  buildPluginPolicy,
  isPluginConnectionMessage,
  isPluginHostSource,
  pluginConnectionSchema,
  pluginManifestSchema,
  pluginMethodSchema,
  pluginRpcRequestSchema,
  SAMPLE_PLUGIN_MANIFEST,
} from '../../../packages/plugin-sdk/index.ts';
export type {
  PluginManifest,
  PluginMethod,
  PluginRpcRequest,
} from '../../../packages/plugin-sdk/index.ts';
