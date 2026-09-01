'use strict';

const path = require('path');

/**
 * 配置模型（E1 / architecture §15.5 schema）
 * 纯函数 + createConfigStore(deps) 工厂；副作用（fs/日志）由 deps 注入。
 * 常量（DSH_URL、HOTKEY、版本号、安装路径）全部参数化。
 */

const DEFAULTS = {
  window: { x: null, y: null, width: 1200, height: 800, maximized: false, tabPosition: 'top' },
  theme: { mode: 'system' }, // system | dark | light（B1）
  tray: { autoLaunch: false, closeToTray: true, showInTaskbar: true, topMost: false },
  hotkey: 'CommandOrControl+Shift+D', // 切换窗口（显示/隐藏）
  hotkeySettings: 'CommandOrControl+,', // 打开设置
  hotkeyAbout: 'F1', // 打开关于
  hotkeyRestartBackend: 'CommandOrControl+Shift+R', // 重启后端
  hotkeyNewTab: 'CommandOrControl+T', // 新建页签
  dsh: {
    path: '', // DSH 仓库路径，空 = 自动探测
    port: 3080, // C1
    profile: '', // --profile（C1）
    env: {}, // 附加环境变量（C1）
    proxy: '', // 代理（C1）
    checkOnStartup: false // 启动时静默检查本地 DSH 更新（G1，默认关）
  },
  integration: { mode: 'shared-web' },
  bridge: { port: 0, token: '' }, // 运行时生成，不入用户编辑面（D3）
  updater: { lastChecked: null, channel: 'stable' },
  language: 'zh-CN'
};

const LANGUAGES = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];
const THEME_MODES = ['system', 'dark', 'light'];

// 旧版扁平配置 → 新嵌套 schema 的迁移映射（P0.1 兼容历史 config.json）
const LEGACY_FLAT_MAP = {
  autoLaunch: 'tray.autoLaunch',
  closeToTray: 'tray.closeToTray',
  showInTaskbar: 'tray.showInTaskbar',
  topMost: 'tray.topMost',
  hotkey: 'hotkey',
  language: 'language',
  dshPath: 'dsh.path',
  darkMode: null // 特殊处理：boolean → theme.mode
};

/**
 * 深度合并（仅保留 defaults 中存在的键，天然丢弃未知字段并可由调用方告警）
 * 仅当两侧都是普通对象时才递归；标量/数组直接取 loaded（undefined 时保留 defaults）。
 * @param {object} defaults 基座对象
 * @param {object} loaded 用户配置（可含未知字段，将被忽略）
 * @returns {object} 合并后的新对象（不修改入参）
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(defaults, loaded) {
  if (!isPlainObject(defaults) || !isPlainObject(loaded)) {
    return loaded === undefined ? defaults : loaded;
  }
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const def = defaults[key];
    const val = loaded[key];
    if (val === undefined) continue;
    if (isPlainObject(def) && isPlainObject(val)) {
      out[key] = deepMerge(def, val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * 迁移旧版扁平配置（v1.0.0 config.json）到嵌套 schema。
 * @param {object} loaded 原始加载配置
 * @returns {object} 迁移后的嵌套配置（仅含已迁移字段，不合并默认值）
 */
function migrateLegacy(loaded) {
  if (!loaded || typeof loaded !== 'object') return {};
  const out = {};
  for (const [flatKey, nestedPath] of Object.entries(LEGACY_FLAT_MAP)) {
    if (loaded[flatKey] === undefined) continue;
    if (nestedPath === null) {
      // darkMode: true → theme.mode 'dark'；false → 'light'
      if (typeof loaded[flatKey] === 'boolean') {
        out.theme = { ...(out.theme || {}), mode: loaded[flatKey] ? 'dark' : 'light' };
      }
      continue;
    }
    const parts = nestedPath.split('.');
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cursor[parts[i]] = cursor[parts[i]] || {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = loaded[flatKey];
  }
  return out;
}

/**
 * 配置合并纯函数：默认值 ← 加载配置（含旧版迁移）← 环境变量覆盖。
 * 未知字段丢弃；dsh.path 可由 DSH_REPO_ROOT 环境变量覆盖。
 * @param {object} defaults
 * @param {object} loaded
 * @param {object} [env] process.env 形状的对象
 * @returns {object}
 */
function mergeConfig(defaults, loaded, env = {}) {
  const merged = deepMerge(defaults, loaded);
  // 旧版扁平字段迁移（加载配置中存在扁平键时）
  const migrated = migrateLegacy(loaded);
  for (const key of Object.keys(migrated)) {
    merged[key] = deepMerge(merged[key] || {}, migrated[key]);
  }
  // 环境变量优先（C1：DSH_REPO_ROOT → dsh.path）
  if (typeof env.DSH_REPO_ROOT === 'string' && env.DSH_REPO_ROOT.trim()) {
    merged.dsh = { ...merged.dsh, path: env.DSH_REPO_ROOT.trim() };
  }
  return merged;
}

/**
 * 配置校验纯函数（§15.5 schema）。
 * 校验失败保留原值 + 返回 422（不静默覆盖用户数据）；此处返回错误清单。
 * @param {object} cfg
 * @returns {{ ok: boolean, errors: Array<{path:string,message:string}> }}
 */
function validateConfig(cfg) {
  const errors = [];
  const check = (pathName, cond, message) => {
    if (!cond) errors.push({ path: pathName, message });
  };

  check('language', LANGUAGES.includes(cfg.language), `language 必须是 ${LANGUAGES.join('/')}`);

  // window
  const w = cfg.window || {};
  check('window.x', w.x === null || (typeof w.x === 'number' && Number.isFinite(w.x)), 'window.x 必须为数字或 null');
  check('window.y', w.y === null || (typeof w.y === 'number' && Number.isFinite(w.y)), 'window.y 必须为数字或 null');
  check('window.width', Number.isInteger(w.width) && w.width >= 800 && w.width <= 3840, 'window.width 必须是 800..3840 的整数');
  check('window.height', Number.isInteger(w.height) && w.height >= 600 && w.height <= 2160, 'window.height 必须是 600..2160 的整数');
  check('window.maximized', typeof w.maximized === 'boolean', 'window.maximized 必须为布尔值');
  check('window.tabPosition', ['top', 'left', 'right'].includes(w.tabPosition), 'window.tabPosition 必须是 top/left/right');

  // theme
  check('theme.mode', THEME_MODES.includes(cfg.theme?.mode), `theme.mode 必须是 ${THEME_MODES.join('/')}`);

  // tray
  const t = cfg.tray || {};
  check('tray.autoLaunch', typeof t.autoLaunch === 'boolean', 'tray.autoLaunch 必须为布尔值');
  check('tray.closeToTray', typeof t.closeToTray === 'boolean', 'tray.closeToTray 必须为布尔值');
  check('tray.showInTaskbar', typeof t.showInTaskbar === 'boolean', 'tray.showInTaskbar 必须为布尔值');
  check('tray.topMost', typeof t.topMost === 'boolean', 'tray.topMost 必须为布尔值');

  // hotkey：字符串（Electron accelerator 格式宽松校验；空字符串 = 禁用该快捷键）
  for (const hk of ['hotkey', 'hotkeySettings', 'hotkeyAbout', 'hotkeyRestartBackend', 'hotkeyNewTab']) {
    check(hk, typeof cfg[hk] === 'string', `${hk} 必须为字符串（可为空=禁用）`);
  }

  // dsh
  const d = cfg.dsh || {};
  check('dsh.path', typeof d.path === 'string', 'dsh.path 必须为字符串');
  check('dsh.port', Number.isInteger(d.port) && d.port >= 1 && d.port <= 65535, 'dsh.port 必须是 1..65535 的整数');
  check('dsh.profile', typeof d.profile === 'string', 'dsh.profile 必须为字符串');
  check('dsh.env', d.env && typeof d.env === 'object' && !Array.isArray(d.env), 'dsh.env 必须为对象');
  check('dsh.proxy', typeof d.proxy === 'string', 'dsh.proxy 必须为字符串');
  check('dsh.checkOnStartup', typeof d.checkOnStartup === 'boolean', 'dsh.checkOnStartup 必须为布尔值');

  const integration = cfg.integration || {};
  check('integration.mode', integration.mode === 'shared-web', "integration.mode 必须为 'shared-web'");

  // bridge（程序维护）
  const b = cfg.bridge || {};
  check('bridge.port', Number.isInteger(b.port) && b.port >= 0 && b.port <= 65535, 'bridge.port 必须是 0..65535 的整数');
  check('bridge.token', typeof b.token === 'string', 'bridge.token 必须为字符串');

  // updater
  const u = cfg.updater || {};
  check('updater.lastChecked', u.lastChecked === null || typeof u.lastChecked === 'number', 'updater.lastChecked 必须为数字或 null');
  check('updater.channel', u.channel === 'stable', "updater.channel 目前仅支持 'stable'");

  return { ok: errors.length === 0, errors };
}

/**
 * 配置存储工厂（P0.1）。副作用全部经 deps 注入。
 * 写盘使用原子写（X2）：先写 config.json.tmp 再 rename。
 * @param {{ userDataPath: string, fs: object, logger?: {log?:Function, logError?:Function} }} deps
 * @returns {{ load: Function, save: Function, get: Function, set: Function, path: string }}
 */
function createConfigStore(deps) {
  const { userDataPath, fs, logger = {} } = deps;
  const configPath = path.join(userDataPath, 'config.json');
  let current = null;

  function load() {
    let loaded = {};
    try {
      if (fs.existsSync(configPath)) {
        loaded = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch (e) {
      logger.logError?.(`加载配置失败: ${e.message}`);
    }
    current = mergeConfig(DEFAULTS, loaded, process.env);
    const { ok, errors } = validateConfig(current);
    if (!ok) {
      logger.log?.(`配置校验警告: ${errors.map((er) => `${er.path}: ${er.message}`).join('; ')}`);
    }
    return current;
  }

  function save(cfg) {
    const target = cfg ?? current;
    if (!target) throw new Error('配置尚未加载，无法保存');
    const tmp = `${configPath}.tmp`;
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(target, null, 2), 'utf-8');
    fs.renameSync(tmp, configPath);
  }

  function get() {
    return current;
  }

  /** 部分更新（白名单由 mergeConfig 的 schema 收敛保证） */
  function set(patch) {
    const next = mergeConfig(current || DEFAULTS, patch, {});
    const { ok, errors } = validateConfig(next);
    if (!ok) {
      const err = new Error(`配置校验失败: ${errors.map((er) => `${er.path}: ${er.message}`).join('; ')}`);
      err.code = 'EINVALID_CONFIG';
      err.errors = errors;
      throw err;
    }
    current = next;
    save(current);
    return current;
  }

  return { load, save, get, set, path: configPath };
}

module.exports = { DEFAULTS, LANGUAGES, THEME_MODES, mergeConfig, validateConfig, migrateLegacy, createConfigStore };
