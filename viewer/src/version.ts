declare const __PUBLISHER_VERSION__: string;

/** Build-time Publisher component version from viewer/package.json. */
export const APP_VERSION: string =
  typeof __PUBLISHER_VERSION__ === 'string' ? __PUBLISHER_VERSION__ : '0.0.0-dev';
