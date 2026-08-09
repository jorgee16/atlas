import {
  Capacitor
} from '@capacitor/core';

export const NATIVE_REGION_ASSET_ORIGIN =
  'https://pub-75539028275a4826aa383fdb89292ed7.r2.dev';

export function defaultRegionAssetOrigin() {
  if (Capacitor.isNativePlatform()) {
    return NATIVE_REGION_ASSET_ORIGIN;
  }

  return (
    globalThis.location?.origin ??
    'http://localhost'
  );
}

export function resolveRegionAssetUrl(
  url,
  {
    baseUrl =
      import.meta.env?.BASE_URL ?? '/',
    origin =
      defaultRegionAssetOrigin()
  } = {}
) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const relativeUrl =
    String(url).replace(/^\//, '');

  return new URL(
    `${baseUrl}${relativeUrl}`,
    origin
  ).href;
}
