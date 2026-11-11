const DEFAULT_CORS_ORIGINS =
  'https://whatsapppro-web.vercel.app,https://web-9b56.vercel.app,http://localhost:3000,http://localhost:3001';
const ALWAYS_ALLOWED_ORIGINS = [
  'https://whatsapppro-web.vercel.app',
  'https://web-9b56.vercel.app',
];
const VERCEL_ORIGIN_ENV_KEYS = [
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
] as const;

function normalizeOrigin(origin: string): string {
  return origin
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\/+$/, '');
}

function buildAllowedOrigins(rawOrigins?: string, frontendUrl?: string): {
  allowAll: boolean;
  origins: Set<string>;
} {
  const effectiveRaw = rawOrigins ?? process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS;
  const effectiveFrontend = frontendUrl ?? process.env.FRONTEND_URL;

  const parsed = effectiveRaw
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

  if (parsed.includes('*')) {
    return { allowAll: true, origins: new Set() };
  }

  const origins = new Set<string>(parsed);
  for (const fallback of ALWAYS_ALLOWED_ORIGINS) {
    origins.add(normalizeOrigin(fallback));
  }
  if (effectiveFrontend) {
    const normalizedFrontend = normalizeOrigin(effectiveFrontend);
    if (normalizedFrontend) {
      origins.add(normalizedFrontend);
    }
  }
  for (const envKey of VERCEL_ORIGIN_ENV_KEYS) {
    const rawHost = process.env[envKey];
    if (!rawHost) continue;
    const host = normalizeOrigin(rawHost).replace(/^https?:\/\//i, '');
    if (host) {
      origins.add(`https://${host}`);
    }
  }

  return { allowAll: false, origins };
}

export type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;
export type CorsOriginOption =
  | boolean
  | ((origin: string | undefined, callback: CorsOriginCallback) => void);

/**
 * Returns `true` if `CORS_ORIGINS` contains `*`, or an origin validator callback
 * that echoes allowed origins when `credentials: true` is enabled.
 */
export function createCorsOriginOption(
  rawOrigins?: string,
  frontendUrl?: string,
): CorsOriginOption {
  if (rawOrigins !== undefined) {
    const initial = buildAllowedOrigins(rawOrigins, frontendUrl);
    if (initial.allowAll) {
      return true;
    }
  }

  return (origin: string | undefined, callback: CorsOriginCallback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const { allowAll, origins } = buildAllowedOrigins(rawOrigins, frontendUrl);
    if (allowAll || origins.has(normalizeOrigin(origin))) {
      callback(null, true);
      return;
    }

    callback(null, false);
  };
}
