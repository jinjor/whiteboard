export const defaultConfig = {
  MAX_ACTIVE_ROOMS: 10,
  LIVE_DURATION: 7 * 24 * 60 * 60 * 1000,
  ACTIVE_DURATION: 24 * 60 * 60 * 1000,
  HOT_DURATION: 60 * 60 * 1000,
  MAX_ACTIVE_USERS: 10,
};

export type Config = typeof defaultConfig;
