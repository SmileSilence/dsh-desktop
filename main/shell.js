(() => {
  const tabs = document.getElementById('tabs');
  const startupView = document.getElementById('startup-view');
  const startupMessage = document.getElementById('startup-message');
  const startupDetail = document.getElementById('startup-detail');
  const loadingTrack = document.getElementById('loading-track');
  window.dshDesktop.onTabsState((state) => {
    tabs.dataset.position = state.position;
    tabs.hidden = !state.showTabbar;
    tabs.replaceChildren(...state.tabs.map((tab) => {
      const button = document.createElement('button');
      button.className = `tab${tab.id === state.activeId ? ' active' : ''}`;
      button.innerHTML = `<span class="tab-title"></span><span class="tab-close" title="关闭">×</span>`;
      button.querySelector('.tab-title').textContent = tab.title;
      button.addEventListener('click', () => window.dshDesktop.activateTab(tab.id));
      const rename = () => {
        if (!state.canRename) return;
        const titleSpan = button.querySelector('.tab-title');
        if (!titleSpan || button.querySelector('.tab-rename-input')) return;
        const original = tab.title;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-rename-input';
        input.value = original;
        input.maxLength = 40;
        input.setAttribute('aria-label', '重命名页签');
        input.addEventListener('click', (event) => event.stopPropagation()); // 编辑态不切换页签
        titleSpan.replaceWith(input);
        input.focus();
        input.select(); // 全选，便于直接覆盖

        let settled = false;
        let isComposing = false;
        let blurredWhileComposing = false;
        const commit = () => {
          if (settled) return;
          settled = true;
          const value = input.value.trim();
          if (value && value !== original) {
            window.dshDesktop.renameTab(tab.id, value); // 成功后会收到新 tabs-state 重建按钮
          } else {
            input.replaceWith(titleSpan);
            titleSpan.textContent = original; // 空值/未变化 → 还原
          }
        };
        const cancel = () => {
          if (settled) return;
          settled = true;
          input.replaceWith(titleSpan);
          titleSpan.textContent = original;
        };
        input.addEventListener('compositionstart', () => { isComposing = true; });
        input.addEventListener('compositionend', () => {
          isComposing = false;
          if (blurredWhileComposing) commit();
        });
        input.addEventListener('keydown', (event) => {
          if (event.isComposing) return; // IME 组合输入中的按键不触发提交/取消
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
          else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', () => {
          if (isComposing) blurredWhileComposing = true;
          else commit();
        });
      };
      button.title = state.canRename ? '双击或右键重命名' : '单个页签不能重命名';
      button.addEventListener('dblclick', (event) => { event.preventDefault(); rename(); });
      button.addEventListener('contextmenu', (event) => { event.preventDefault(); rename(); });
      if (state.canRename) {
        const renameButton = document.createElement('span');
        renameButton.className = 'tab-rename';
        renameButton.textContent = '✎';
        renameButton.title = '重命名';
        renameButton.addEventListener('click', (event) => { event.stopPropagation(); rename(); });
        button.insertBefore(renameButton, button.querySelector('.tab-close'));
      }
      button.querySelector('.tab-close').addEventListener('click', (event) => { event.stopPropagation(); window.dshDesktop.closeTab(tab.id); });
      return button;
    }), Object.assign(document.createElement('button'), { className: 'new-tab', textContent: '+', title: '新建页签' }));
    tabs.lastElementChild.addEventListener('click', () => window.dshDesktop.newTab());
  });
  window.dshDesktop.requestTabsState();
  window.dshDesktop.onAppReady(() => { startupView.hidden = true; });
  window.dshDesktop.onAppLoadError((detail) => {
    startupMessage.textContent = 'DSH Web 服务启动失败';
    startupDetail.textContent = String(detail || '未知错误');
    startupDetail.hidden = false;
    loadingTrack.hidden = true;
  });
})();
