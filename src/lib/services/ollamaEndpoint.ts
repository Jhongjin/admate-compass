export type OllamaEndpointSource =
  | 'OLLAMA_BASE_URL'
  | 'VULTR_OLLAMA_URL'
  | 'development-default'
  | 'none';

export interface OllamaEndpointResolution {
  baseUrl?: string;
  configured: boolean;
  source: OllamaEndpointSource;
  isDevelopmentFallback: boolean;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function resolveOllamaEndpoint(): OllamaEndpointResolution {
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim();
  if (baseUrl) {
    return {
      baseUrl: normalizeBaseUrl(baseUrl),
      configured: true,
      source: 'OLLAMA_BASE_URL',
      isDevelopmentFallback: false,
    };
  }

  const vultrUrl = process.env.VULTR_OLLAMA_URL?.trim();
  if (vultrUrl) {
    return {
      baseUrl: normalizeBaseUrl(vultrUrl),
      configured: true,
      source: 'VULTR_OLLAMA_URL',
      isDevelopmentFallback: false,
    };
  }

  if (process.env.NODE_ENV !== 'production') {
    return {
      baseUrl: 'http://127.0.0.1:11434',
      configured: false,
      source: 'development-default',
      isDevelopmentFallback: true,
    };
  }

  return {
    configured: false,
    source: 'none',
    isDevelopmentFallback: false,
  };
}

export function getOllamaEndpointStatus() {
  const endpoint = resolveOllamaEndpoint();
  return {
    configured: endpoint.configured,
    source: endpoint.source,
    isDevelopmentFallback: endpoint.isDevelopmentFallback,
  };
}

export function buildOllamaApiUrl(path: string) {
  const endpoint = resolveOllamaEndpoint();
  if (!endpoint.baseUrl) {
    throw new Error('Ollama endpoint is not configured for this environment.');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${endpoint.baseUrl}${normalizedPath}`;
}
