'use strict';

const api = window.dshDesktop;
const appRoot = document.getElementById('app');

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function settingRow(label, control) {
  const row = el('div', null, 'setting-item');
  row.append(el('span', label, 'setting-label'), control);
  return row;
}

function toggle(id, checked) {
  const label = el('label', null, 'switch');
  const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
  label.append(input, el('span', null, 'slider'));
  return label;
}

function section(title) {
  const node = el('section', null, 'section');
  node.append(el('div', title, 'section-title'));
  return node;
}

/** 将 KeyboardEvent 主键归一化为 Electron accelerator 键名；不支持的键返回 null */
function normalizeKey(key) {
  const map = {
    ' ': 'Space', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete',
    Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
  };
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  if (/^F\d{1,2}$/.test(key)) return key;
  if (/^[a-zA-Z0-9]$/.test(key)) return key.toUpperCase();
  return null;
}

/** 由 KeyboardEvent 构造 Electron accelerator（如 CommandOrControl+Shift+X）；无效返回 null */
function buildAccelerator(event) {
  const mods = [];
  if (event.ctrlKey) mods.push('CommandOrControl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  if (event.metaKey && !event.ctrlKey) mods.push('Super');
  const key = normalizeKey(event.key);
  if (!key || mods.includes(key)) return null;
  return [...mods, key].join('+');
}

/** 热键捕获输入框：点击后按下组合键即可设置，Esc 取消，失焦还原；双击左侧标题设为「不设置」 */
function hotkeyInput(id, value, labelEl, notSetText) {
  const input = el('input', null, 'text-input hotkey-input');
  input.id = id;
  input.value = value || '';
  input.readOnly = true;
  input.title = '点击后按下新快捷键；Esc 取消；双击左侧标题设为「不设置」';
  let last = value || '';
  let capturing = false;
  const syncDisplay = () => {
    if (!input.value) { input.placeholder = notSetText; input.classList.add('hotkey-unset'); }
    else { input.placeholder = ''; input.classList.remove('hotkey-unset'); }
  };
  const finish = (apply) => {
    capturing = false;
    input.readOnly = true;
    api.hotkeyCaptureEnd();
    if (!apply) input.value = last;
    syncDisplay();
  };
  input.addEventListener('click', () => {
    if (capturing) return;
    capturing = true;
    input.readOnly = false;
    input.value = '';
    input.placeholder = '按下新快捷键…（Esc 取消）';
    input.classList.remove('hotkey-unset');
    input.focus();
    api.hotkeyCaptureStart();
  });
  input.addEventListener('keydown', (event) => {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { finish(false); return; }
    const accel = buildAccelerator(event);
    if (!accel) return; // 单独的修饰键/不支持键 → 继续捕获
    last = accel;
    input.value = accel;
    finish(true);
  });
  input.addEventListener('blur', () => { if (capturing) finish(false); });
  if (labelEl) {
    labelEl.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (capturing) return;
      last = '';
      input.value = '';
      syncDisplay();
    });
  }
  syncDisplay();
  return input;
}

/** 热键设置行：左侧标题 + 捕获输入框；双击标题可设为「不设置」 */
function hotkeySettingRow(label, id, value, notSetText) {
  const row = el('div', null, 'setting-item');
  const labelEl = el('span', label, 'setting-label');
  row.append(labelEl, hotkeyInput(id, value, labelEl, notSetText));
  return row;
}

function renderSettings(data) {
  const { config: cfg, language: lang } = data;
  const header = el('div', null, 'settings-header');
  const headerInner = el('div', null, 'settings-header-inner');
  header.append(headerInner);
  headerInner.append(el('h1', lang.settingsTitle));
  const general = section(lang.settingsGeneral);
  general.append(settingRow(lang.settingAutoLaunch, toggle('autoLaunch', cfg.tray.autoLaunch)));
  general.append(settingRow(lang.settingCloseToTray, toggle('closeToTray', cfg.tray.closeToTray)));
  general.append(settingRow(lang.settingTopMost, toggle('topMost', cfg.tray.topMost)));

  const appearance = section(lang.settingsAppearance);
  const tabPosSelect = el('select', null, 'select-input');
  tabPosSelect.id = 'tabPosition';
  [['top', lang.tabPositionTop], ['left', lang.tabPositionLeft], ['right', lang.tabPositionRight]].forEach(([value, label]) => {
    const option = el('option', label);
    option.value = value;
    option.selected = cfg.window.tabPosition === value;
    tabPosSelect.append(option);
  });
  appearance.append(settingRow(lang.tabPositionLabel, tabPosSelect));

  const language = section(lang.settingsLanguage);
  const select = el('select', null, 'select-input'); select.id = 'language';
  [['zh-CN',lang.langChinese],['en-US',lang.langEnglish],['ja-JP',lang.langJapanese],['ko-KR',lang.langKorean]].forEach(([value,label]) => {
    const option = el('option', label); option.value = value; option.selected = cfg.language === value; select.append(option);
  });
  language.append(settingRow(lang.settingsLanguage, select));

  const hotkey = section(lang.settingsHotkey);
  hotkey.append(hotkeySettingRow(lang.hotkeyToggle, 'hotkey', cfg.hotkey, lang.hotkeyNotSet));
  hotkey.append(hotkeySettingRow(lang.hotkeySettings, 'hotkeySettings', cfg.hotkeySettings, lang.hotkeyNotSet));
  hotkey.append(hotkeySettingRow(lang.hotkeyAbout, 'hotkeyAbout', cfg.hotkeyAbout, lang.hotkeyNotSet));
  hotkey.append(hotkeySettingRow(lang.hotkeyRestartBackend, 'hotkeyRestartBackend', cfg.hotkeyRestartBackend, lang.hotkeyNotSet));
  hotkey.append(hotkeySettingRow(lang.hotkeyNewTab, 'hotkeyNewTab', cfg.hotkeyNewTab, lang.hotkeyNotSet));
  const dsh = section(lang.settingsDshPath);
  const pathInput = el('input', null, 'text-input'); pathInput.id = 'dshPath'; pathInput.value = cfg.dsh.path || ''; pathInput.placeholder = lang.dshPathPlaceholder;
  dsh.append(settingRow(lang.dshPathLabel, pathInput));
  const status = el('div', null, 'status'); status.id = 'dshStatus'; status.innerHTML = data.dshStatusHtml;
  dsh.append(settingRow('DSH 安装状态', status));

  // 刷新/应用按钮固定在标题栏右侧，不随内容滚动
  const actions = el('div', null, 'actions');
  const refresh = el('button', lang.refreshStatus, 'button'); refresh.type = 'button'; refresh.onclick = () => api.refreshDshStatus();
  const save = el('button', lang.btnApply, 'button'); save.type = 'button';
  const saved = el('span', '', 'saved'); saved.id = 'saveState';
  save.onclick = () => {
    api.saveSettings({tray:{autoLaunch:document.getElementById('autoLaunch').checked,closeToTray:document.getElementById('closeToTray').checked,topMost:document.getElementById('topMost').checked},window:{tabPosition:tabPosSelect.value},hotkey:document.getElementById('hotkey').value,hotkeySettings:document.getElementById('hotkeySettings').value,hotkeyAbout:document.getElementById('hotkeyAbout').value,hotkeyRestartBackend:document.getElementById('hotkeyRestartBackend').value,hotkeyNewTab:document.getElementById('hotkeyNewTab').value,language:select.value,dsh:{path:pathInput.value}});
    saved.textContent = '已保存';
  };
  actions.append(refresh, save, saved);
  headerInner.append(actions);
  appRoot.append(header, el('div', null, 'settings-header-spacer'), general, appearance, language, hotkey, dsh);
  api.onDshStatusUpdated((html) => { status.innerHTML = html; });
}

function renderAbout(data) {
  const lang = data.language;
  const card = el('section', null, 'about-card');
  card.append(el('h1', lang.appName), el('p', `${lang.aboutVersion} (${data.appVersion})`, 'brand'), el('p', lang.aboutDescription), el('p', `${lang.aboutAuthor}\n${lang.aboutLicense}`));
  const updateCard = el('section', null, 'section');
  updateCard.append(el('div', 'DSH 更新', 'section-title'));
  const versionStatus = el('div', '点击“检查更新”获取当前版本和最新版本。', 'update-status');
  const actions = el('div', null, 'update-actions');
  const checkButton = el('button', '检查 DSH 更新', 'button');
  const updateButton = el('button', '更新 DSH', 'button secondary');
  updateButton.disabled = true;
  const setBusy = (busy) => { checkButton.disabled = busy; updateButton.disabled = busy; };
  checkButton.onclick = async () => {
    setBusy(true); versionStatus.textContent = '正在检查 DSH 更新…';
    try {
      const result = await api.checkDshUpdate();
      const current = result.currentVersion || '未知';
      const latest = result.latestVersion || '未知';
      versionStatus.textContent = `来源：${result.source || '未知'}　当前：${current}　最新：${latest}${result.hasUpdate ? '　发现可用更新' : '　已是最新或无法比较'}`;
      updateButton.disabled = !result.hasUpdate;
      checkButton.disabled = false;
    } catch (error) {
      versionStatus.textContent = `检查失败：${error.message}`;
      setBusy(false);
    }
  };
  updateButton.onclick = async () => {
    const confirmed = await api.confirm('更新会修改当前 DSH 安装，并可能重启桌面后端。确定继续吗？');
    if (!confirmed) return;
    setBusy(true); versionStatus.textContent = '正在更新 DSH，请勿关闭程序…';
    try {
      const result = await api.updateDsh(true);
      versionStatus.textContent = (result.log || ['DSH 更新完成']).join('\n');
      checkButton.disabled = false;
      updateButton.disabled = true;
    } catch (error) {
      versionStatus.textContent = `更新失败：${error.message}`;
      setBusy(false);
    }
  };
  actions.append(checkButton, updateButton);
  updateCard.append(versionStatus, actions);
  appRoot.append(card, updateCard);
}

api.getInternalPageData().then((data) => {
  document.documentElement.dataset.theme = data.theme;
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'about') renderAbout(data); else renderSettings(data);
}).catch((error) => { appRoot.textContent = `页面加载失败：${error.message}`; });
