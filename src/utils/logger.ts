/**
 * 统一日志入口
 * - dev: debug/info/warn/error 全开
 * - prod: 仅 warn/error
 */

const isDev = import.meta.env.DEV;

function prefix(level: string): string {
  return `[${level}]`;
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev) console.log(prefix('debug'), ...args);
  },
  info: (...args: unknown[]) => {
    if (isDev) console.log(prefix('info'), ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn(prefix('warn'), ...args);
  },
  error: (...args: unknown[]) => {
    console.error(prefix('error'), ...args);
  },
};
