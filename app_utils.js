(() => {
  const AppUtils = {
    roleLabels: {
      admin: '管理员',
      jiaowu: '教务',
      director: '总监',
      supervisor: '教学主管',
      regional_manager: '大区经理',
      store_manager: '店长',
      user: '普通用户',
    },
    workflowEditRoles: {
      draft: ['admin', 'jiaowu'],
      scheduling: ['admin', 'jiaowu', 'director', 'supervisor', 'regional_manager', 'store_manager'],
      reviewing: ['admin', 'jiaowu', 'director', 'supervisor', 'regional_manager'],
      confirmed: ['admin', 'jiaowu'],
    },
    escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));
    },
    escapeAttr(value) {
      return AppUtils.escapeHtml(value).replace(/`/g, '&#96;');
    },
    moodLevels: [
      {id: 'hang', label: '夯', tone: '今天排课很顺，能笑着收工'},
      {id: 'top', label: '顶级', tone: '整体稳住，只剩几处微调'},
      {id: 'human', label: '人上人', tone: '有点压力，但还能掌控'},
      {id: 'npc', label: 'NPC', tone: '重复操作变多，脑子开始排队'},
      {id: 'down', label: '拉完了', tone: '今天建议先救火，再谈优雅'},
    ],
    moodAnimals: [
      {icon: '🐱', label: '猫'},
      {icon: '🐶', label: '狗'},
      {icon: '🐰', label: '兔'},
      {icon: '🐼', label: '熊猫'},
      {icon: '🦊', label: '狐狸'},
      {icon: '🐻', label: '熊'},
      {icon: '🐨', label: '考拉'},
      {icon: '🐯', label: '老虎'},
      {icon: '🦁', label: '狮子'},
      {icon: '🐸', label: '青蛙'},
      {icon: '🐹', label: '仓鼠'},
      {icon: '🐧', label: '企鹅'},
      {icon: '🐣', label: '小鸡'},
      {icon: '🐢', label: '乌龟'},
      {icon: '🦭', label: '海豹'},
    ],
    stableIndex(value, size) {
      let hash = 0;
      const text = String(value ?? '');
      for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
      }
      return Math.abs(hash) % Math.max(1, size);
    },
    moodAnimalFor(entry, dateText) {
      const animals = AppUtils.moodAnimals;
      const key = `${dateText || ''}|${entry?.user_id || entry?.email || entry?.name || ''}`;
      return animals[AppUtils.stableIndex(key, animals.length)] || animals[0];
    },
    injectMoodBoardStyles() {
      if (document.getElementById('sharedMoodBoardStyles')) return;
      const style = document.createElement('style');
      style.id = 'sharedMoodBoardStyles';
      style.textContent = `
.mood-dock { position:fixed; top:58px; right:16px; z-index:180; display:flex; flex-direction:column; align-items:flex-end; gap:6px; max-width:calc(100vw - 32px); color:#334155; pointer-events:none; }
.mood-dock > * { pointer-events:auto; }
.mood-pill { appearance:none; -webkit-appearance:none; display:inline-flex; align-items:center; gap:7px; min-height:30px; max-width:min(340px, calc(100vw - 32px)); padding:4px 9px 4px 5px; border:1px solid #dbe1ea; border-radius:999px; background:rgba(255,255,255,.96); color:#334155; box-shadow:0 4px 14px rgba(15,23,42,.10); cursor:pointer; }
.mood-pill:focus-visible, .mood-action-button:focus-visible, .mood-close-button:focus-visible { outline:2px solid #1a237e; outline-offset:2px; }
.mood-pill:hover { border-color:#94a3b8; background:#fff; }
.mood-pill-title { font-size:12px; font-weight:900; white-space:nowrap; }
.mood-pill-count { color:#94a3b8; font-size:11px; font-weight:800; white-space:nowrap; }
.mood-pill-animals { display:inline-flex; align-items:center; gap:2px; min-width:0; overflow:hidden; }
.mood-mini-animal { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:999px; background:#f8fafc; border:1px solid #e2e8f0; font-size:13px; line-height:1; }
.mood-pill-more { color:#64748b; font-size:11px; font-weight:900; }
.mood-panel { width:min(440px, calc(100vw - 32px)); max-height:calc(100vh - 104px); border:1px solid #dbe1ea; border-radius:10px; background:rgba(255,255,255,.98); box-shadow:0 16px 38px rgba(15,23,42,.18), 0 4px 12px rgba(15,23,42,.08); overflow:auto; overscroll-behavior:contain; }
.mood-panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border-bottom:1px solid #eef2f7; background:#f8fafc; }
.mood-panel-title { display:flex; flex-direction:column; gap:2px; min-width:0; }
.mood-panel-title b { color:#111827; font-size:13px; line-height:1; }
.mood-panel-title span { color:#94a3b8; font-size:11px; font-weight:700; }
.mood-panel-actions { display:flex; align-items:center; gap:5px; flex:0 0 auto; }
.mood-level-table { display:flex; flex-direction:column; gap:0; padding:6px; }
.mood-level-cell { appearance:none; -webkit-appearance:none; min-width:0; min-height:34px; display:grid; grid-template-columns:58px minmax(0,1fr) 32px; gap:6px; align-items:center; padding:5px 6px; border:1px dashed transparent; border-radius:7px; background:#fff; cursor:pointer; text-align:left; transition:background .12s,border-color .12s,transform .12s; }
.mood-level-cell:hover { border-color:#94a3b8; background:#f8fafc; }
.mood-level-cell.active { border-style:solid; border-color:#111827; background:#f8fafc; }
.mood-level-cell.drag-over { background:#fff7ed; border-color:#fb923c; color:#9a3412; transform:translateY(-1px); }
.mood-level-title { display:flex; align-items:center; gap:4px; color:#334155; font-size:12px; font-weight:900; line-height:1; white-space:nowrap; }
.mood-level-title small { color:#94a3b8; font-size:10px; font-weight:800; }
.mood-level-entries { display:flex; flex-wrap:wrap; align-items:center; gap:3px; min-height:21px; overflow:hidden; }
.mood-level-count { color:#94a3b8; font-size:11px; font-weight:900; text-align:right; white-space:nowrap; }
.mood-person { flex:0 1 auto; min-width:0; display:inline-flex; align-items:center; gap:3px; max-width:82px; height:20px; padding:1px 5px 1px 2px; border:1px solid #e2e8f0; border-radius:999px; background:#fff; color:#334155; }
.mood-person.me { border-color:#1a237e; background:#eef2ff; color:#172554; }
.mood-animal { display:inline-flex; align-items:center; justify-content:center; width:17px; height:17px; border-radius:999px; background:#fff; font-size:12px; line-height:1; box-shadow:inset 0 0 0 1px rgba(148,163,184,.22); }
.mood-person b { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; font-weight:800; }
.mood-more-chip { display:inline-flex; align-items:center; justify-content:center; height:20px; padding:1px 6px; border:1px solid #e2e8f0; border-radius:999px; background:#fff; color:#64748b; font-size:11px; font-weight:900; }
.mood-empty { color:#b4bfcc; font-size:11px; font-weight:700; line-height:20px; }
.mood-my-chip { display:inline-flex; align-items:center; gap:4px; height:24px; max-width:92px; padding:2px 7px 2px 3px; border:1px solid #d8dee9; border-radius:999px; background:#fff; color:#334155; cursor:grab; user-select:none; }
.mood-my-chip:active { cursor:grabbing; }
.mood-my-chip b { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; font-weight:800; }
.mood-action-button { border:1px solid #d8dee9; border-radius:999px; padding:2px 7px; min-height:22px; color:#64748b; background:#fff; font-size:11px; font-weight:800; cursor:pointer; }
.mood-action-button:hover { border-color:#94a3b8; background:#f8fafc; }
.mood-close-button { border:0; background:transparent; color:#94a3b8; width:22px; height:22px; border-radius:999px; cursor:pointer; font-size:15px; line-height:1; }
.mood-close-button:hover { background:#eef2f7; color:#475569; }
.mood-dock.loading .mood-level-table { opacity:.55; }
@media (max-width: 760px) {
  .mood-dock { top:auto; right:10px; bottom:12px; }
  .mood-panel { max-height:calc(100vh - 84px); }
  .mood-level-cell { grid-template-columns:54px minmax(0,1fr) 28px; }
  .mood-my-chip { flex:0 0 auto; }
}`;
      document.head.appendChild(style);
    },
    async readJson(res, label = '请求') {
      const text = await res.text();
      try {
        return JSON.parse(text || '{}');
      } catch(e) {
        return {error: `${label}返回格式异常`};
      }
    },
    initMoodBoard(options = {}) {
      const root = typeof options.root === 'string' ? document.getElementById(options.root) : options.root;
      if (!root) return null;
      AppUtils.injectMoodBoardStyles();
      root.classList.add('mood-dock');
      const fetcher = options.apiFetch || AppUtils.apiFetch;
      const toast = options.toast || (() => {});
      const refreshMs = Number(options.refreshMs || 45000);
      const state = root._moodBoardState || {
        data: null,
        selectedLevel: '',
        note: '',
        loading: false,
        open: false,
      };
      root._moodBoardState = state;

      const render = () => {
        const data = state.data || {date: '', levels: AppUtils.moodLevels, groups: [], entries: [], me: null, viewer: null};
        const levels = data.levels?.length ? data.levels : AppUtils.moodLevels;
        const groups = data.groups?.length
          ? data.groups
          : levels.map(level => ({
              ...level,
              entries: (data.entries || []).filter(entry => entry.level === level.id),
            }));
        const me = data.me || null;
        const viewer = data.viewer || me || {};
        const viewerName = viewer.name || me?.name || '我';
        const viewerAnimal = AppUtils.moodAnimalFor(viewer, data.date);
        if (!state.selectedLevel) state.selectedLevel = me?.level || levels[0]?.id || '';
        if (!state.note && me?.note) state.note = me.note;
        const total = (data.entries || []).length;
        const visiblePillEntries = (data.entries || []).slice(0, 5);
        const pillAnimals = visiblePillEntries.map(entry => {
          const animal = AppUtils.moodAnimalFor(entry, data.date);
          return `<span class="mood-mini-animal" title="${AppUtils.escapeAttr(entry.name || '')}" aria-hidden="true">${AppUtils.escapeHtml(animal.icon)}</span>`;
        }).join('');
        const entryChipHtml = entry => {
              const animal = AppUtils.moodAnimalFor(entry, data.date);
              const title = [
                entry.name || '',
                entry.level_label || '',
                entry.role_label || '',
                entry.dept_name || '',
                entry.campus || '',
              ].filter(Boolean).join(' · ');
              return `<span class="mood-person ${entry.is_me ? 'me' : ''}" title="${AppUtils.escapeAttr(title)}">
                <span class="mood-animal" aria-hidden="true">${AppUtils.escapeHtml(animal.icon)}</span>
                <b>${AppUtils.escapeHtml(entry.name || '')}</b>
              </span>`;
        };
        const levelTableHtml = groups.map(group => {
          const entries = group.entries || [];
          const visibleEntries = entries.slice(0, 2);
          const hiddenEntries = entries.slice(2);
          const names = entries.map(entry => entry.name || '').filter(Boolean).join('、');
          const cellTitle = [
            `拖到这里：${group.tone || group.label}`,
            names ? `已上墙：${names}` : '',
          ].filter(Boolean).join('｜');
          return `<button type="button" class="mood-level-cell ${state.selectedLevel === group.id ? 'active' : ''}" data-mood-level="${AppUtils.escapeAttr(group.id)}" data-mood-drop-level="${AppUtils.escapeAttr(group.id)}" title="${AppUtils.escapeAttr(cellTitle)}">
            <span class="mood-level-title">
              <span>${AppUtils.escapeHtml(group.label)}</span>
              <small>${AppUtils.escapeHtml(entries.length)}人</small>
            </span>
            <span class="mood-level-entries">
              ${entries.length ? `${visibleEntries.map(entryChipHtml).join('')}${hiddenEntries.length ? `<span class="mood-more-chip" title="${AppUtils.escapeAttr(hiddenEntries.map(entry => entry.name || '').filter(Boolean).join('、'))}">+${AppUtils.escapeHtml(hiddenEntries.length)}</span>` : ''}` : '<span class="mood-empty">待上墙</span>'}
            </span>
            <span class="mood-level-count">${AppUtils.escapeHtml(entries.length)}</span>
          </button>`;
        }).join('');
        root.classList.toggle('loading', state.loading);
        root.innerHTML = `<button type="button" class="mood-pill" data-mood-action="toggle" aria-expanded="${state.open ? 'true' : 'false'}" title="${state.open ? '收起今日心情' : '展开今日心情'}">
          <span class="mood-pill-animals">${pillAnimals || `<span class="mood-mini-animal" aria-hidden="true">${AppUtils.escapeHtml(viewerAnimal.icon)}</span>`}</span>
          <span class="mood-pill-title">今日心情</span>
          <span class="mood-pill-count">${AppUtils.escapeHtml(total)}人</span>
          ${total > visiblePillEntries.length ? `<span class="mood-pill-more">+${AppUtils.escapeHtml(total - visiblePillEntries.length)}</span>` : ''}
        </button>
        ${state.open ? `<section class="mood-panel ${state.loading ? 'loading' : ''}" aria-live="polite" aria-label="今日心情">
          <div class="mood-panel-head">
            <div class="mood-panel-title">
              <b>今日心情</b>
              <span>${AppUtils.escapeHtml(total)} 人已上墙</span>
            </div>
            <div class="mood-panel-actions">
              <span class="mood-my-chip" draggable="true" data-mood-drag="self" title="拖到下方档位上墙">
                <span class="mood-animal" aria-hidden="true">${AppUtils.escapeHtml(viewerAnimal.icon)}</span>
                <b>${AppUtils.escapeHtml(viewerName)}</b>
              </span>
              <button type="button" class="mood-action-button clear" data-mood-action="clear" title="撤下今日心情">撤下</button>
              <button type="button" class="mood-close-button" data-mood-action="toggle" title="收起今日心情" aria-label="收起今日心情">×</button>
            </div>
          </div>
          <div class="mood-level-table">${levelTableHtml}</div>
        </section>` : ''}`;
      };

      const setDropOver = (target, active) => {
        if (!target) return;
        target.classList.toggle('drag-over', active);
      };

      const clearDropOver = () => {
        root.querySelectorAll('.mood-level-cell.drag-over').forEach(el => el.classList.remove('drag-over'));
      };

      const save = async (level = null) => {
        const nextLevel = level || state.selectedLevel;
        if (!nextLevel) return;
        state.selectedLevel = nextLevel;
        try {
          const res = await fetcher('/api/mood-board', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({level: nextLevel, note: ''}),
          });
          const data = await AppUtils.readJson(res, '心情榜');
          if (!res.ok || data.error) throw new Error(data.error || '保存失败');
          state.data = data;
          state.note = '';
          render();
          toast('已上墙');
        } catch(e) {
          toast(e.message || '保存失败');
        }
      };

      const clear = async () => {
        try {
          const res = await fetcher('/api/mood-board', {method: 'DELETE'});
          const data = await AppUtils.readJson(res, '心情榜');
          if (!res.ok || data.error) throw new Error(data.error || '撤下失败');
          state.data = data;
          state.note = '';
          state.selectedLevel = data.levels?.[0]?.id || AppUtils.moodLevels[0].id;
          render();
          toast('已撤下');
        } catch(e) {
          toast(e.message || '撤下失败');
        }
      };

      const load = async (silent = false) => {
        state.loading = !silent;
        if (!silent) render();
        try {
          const res = await fetcher('/api/mood-board');
          const data = await AppUtils.readJson(res, '心情榜');
          if (!res.ok || data.error) throw new Error(data.error || '心情榜加载失败');
          state.data = data;
          state.selectedLevel = data.me?.level || state.selectedLevel || data.levels?.[0]?.id || '';
          state.note = data.me?.note || '';
          state.loading = false;
          render();
        } catch(e) {
          state.loading = false;
          render();
          if (!silent) toast(e.message || '心情榜加载失败');
        }
      };

      if (!root._moodBoardBound) {
        root.addEventListener('click', event => {
          const toggle = event.target.closest('[data-mood-action="toggle"]');
          if (toggle && root.contains(toggle)) {
            state.open = !state.open;
            render();
            return;
          }
          const levelBtn = event.target.closest('[data-mood-level]');
          if (levelBtn && root.contains(levelBtn)) {
            save(levelBtn.dataset.moodLevel || '');
            return;
          }
          const action = event.target.closest('[data-mood-action]');
          if (!action || !root.contains(action)) return;
          if (action.dataset.moodAction === 'clear') clear();
        });
        root.addEventListener('dragstart', event => {
          const chip = event.target.closest('[data-mood-drag="self"]');
          if (!chip || !root.contains(chip)) return;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', 'mood-self');
        });
        root.addEventListener('dragover', event => {
          const drop = event.target.closest('[data-mood-drop-level]');
          if (!drop || !root.contains(drop)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          clearDropOver();
          setDropOver(drop, true);
        });
        root.addEventListener('dragleave', event => {
          const drop = event.target.closest('[data-mood-drop-level]');
          if (!drop || !root.contains(drop)) return;
          setDropOver(drop, false);
        });
        root.addEventListener('drop', event => {
          const drop = event.target.closest('[data-mood-drop-level]');
          if (!drop || !root.contains(drop)) return;
          event.preventDefault();
          clearDropOver();
          save(drop.dataset.moodDropLevel || drop.dataset.moodLevel || '');
        });
        root.addEventListener('dragend', clearDropOver);
        root._moodBoardBound = true;
      }
      if (root._moodBoardTimer) clearInterval(root._moodBoardTimer);
      root._moodBoardTimer = setInterval(() => load(true), refreshMs);
      load(false);
      return {load, save, clear};
    },
    getCookie(name) {
      return document.cookie.split('; ').reduce((found, part) => {
        if (found) return found;
        const eq = part.indexOf('=');
        if (eq < 0) return '';
        return decodeURIComponent(part.slice(0, eq)) === name ? decodeURIComponent(part.slice(eq + 1)) : '';
      }, '');
    },
    apiFetch(url, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      const headers = {...(options.headers || {})};
      const token = AppUtils.getCookie('sched_csrf');
      if (token && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        headers['X-CSRF-Token'] = token;
      }
      return fetch(url, {...options, headers});
    },
  };

  window.AppUtils = AppUtils;
})();
