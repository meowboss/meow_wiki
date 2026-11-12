export type Endpoint = { id: string; label: string };
export type Config = { endpoints: Endpoint[]; configured: boolean };
export type ProviderVendor = 'openai' | 'deepseek' | 'custom';
export type Provider = {
  id: string;
  label: string;
  endpointId: string;
  model: string;
  configured: boolean;
  vendor?: ProviderVendor;
  baseURL?: string;
  source?: string;
};

// Keep public metadata only; never retain unexpected credential response fields.
export function providerMetadata(provider: Provider): Provider {
  return {
    id: provider.id,
    label: provider.label,
    endpointId: provider.endpointId,
    model: provider.model,
    configured: provider.configured === true,
    ...(provider.vendor ? { vendor: provider.vendor } : {}),
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
    ...(provider.source ? { source: provider.source } : {}),
  };
}
