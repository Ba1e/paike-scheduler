let courses = [];
let relatedRoomCourses = [];
let relatedRooms = {};
let originalData = [];
let originalById = new Map();
let originalLoadedVersion = null;
let originalLoadPromise = null;
let originalLoadRequestVersion = null;
let allTeachers = [], allCampuses = [], allSubjects = [];
let capUndoStack = [];
let loadedVersion = null;
let currentUser = null;
let currentWorkflow = null;
let cachedConflictCount = 0;
let schedulePage = 1;
const SCHEDULE_PAGE_SIZE = 120;
let conflictStatusMap = {};
let conflictDataCache = null;
let conflictFullFetchPromise = null;
let conflictRenderSeq = 0;
let conflictListRenderSignature = '';
let capacityStatsCache = null;
let capacityRenderSignature = '';
let capacityHeadSignature = '';
let heatmapRenderSignature = '';
let derivedCourseSignature = '';
let heatmapData = null;
let heatmapVisibleLimit = 60;
let heatmapFilterSignature = '';
const HEATMAP_PAGE_SIZE = 60;
const CAMPUS_COLORS = {};
const COLOR_PALETTE = ['#1565c0','#c62828','#2e7d32','#e65100','#6a1b9a','#00838f','#4e342e','#283593','#558b2f','#ad1457','#f57f17'];
let expandedSuggestionGroups = new Set();
let conflictVisibleLimit = 20;
let conflictFilterSignature = '';
let userEditingUntil = 0;
let selectedCourseIds = new Set();
let currentSchedulePageIds = [];
let pendingCancelCourseId = null;
let pendingMergeSourceId = null;
let draggingMergeSourceId = null;
let suppressMergeClickUntil = 0;
let presenceTimer = null;
let dataRefreshTimer = null;
let authExpired = false;
let latestPresenceUsers = [];
let presenceState = {activity: 'online', tab: 'schedule', courseId: '', field: ''};
let presencePingInFlight = false;
let presencePingQueued = false;
let pendingReasonResolve = null;
let pendingBatchReviewResolve = null;
let pendingAppConfirmResolve = null;
let currentActionReason = '';
let modalFocusStack = [];
let inlineSaveQueue = Promise.resolve();
const APP_MODAL_IDS = [
  'importModal',
  'newCourseModal',
  'detailModal',
  'reasonModal',
  'confirmModal',
  'batchReviewModal',
  'lifecycleRecordsModal',
  'cancelCourseModal',
  'mergeCourseModal',
  'newTermModal',
  'editTermModal',
  'deleteTermModal',
];

function visibleAppModals() {
  return APP_MODAL_IDS
    .map(id => document.getElementById(id))
    .filter(modal => modal && !modal.classList.contains('hidden'));
}

function appModalFocusableElements(modal) {
  if (!modal) return [];
  const selector = [
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(',');
  return [...modal.querySelectorAll(selector)].filter(el => {
    if (el.closest('[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

function showAppModal(id, focusSelector = null) {
  const modal = document.getElementById(id);
  if (!modal) return null;
  if (modal.classList.contains('hidden')) {
    modalFocusStack.push({id, element: document.activeElement});
  }
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  setTimeout(() => {
    const target = focusSelector ? modal.querySelector(focusSelector) : null;
    const focusable = appModalFocusableElements(modal);
    (target || focusable[0] || modal).focus?.();
  }, 0);
  return modal;
}

function hideAppModal(id, options = {}) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = '';
  const stackIndex = modalFocusStack.map(item => item.id).lastIndexOf(id);
  const item = stackIndex >= 0 ? modalFocusStack.splice(stackIndex, 1)[0] : null;
  if (options.restoreFocus !== false && item?.element && document.contains(item.element)) {
    setTimeout(() => item.element.focus?.(), 0);
  }
}

function closeAppModalById(id) {
  if (id === 'newCourseModal') closeNewCourseModal();
  else if (id === 'detailModal') closeDetailModal();
  else if (id === 'reasonModal') closeReasonModal(null);
  else if (id === 'confirmModal') closeConfirmModal(false);
  else if (id === 'batchReviewModal') closeBatchReviewModal(null);
  else if (id === 'lifecycleRecordsModal') closeLifecycleRecordsModal();
  else if (id === 'cancelCourseModal') closeCancelCourseModal();
  else if (id === 'mergeCourseModal') closeMergeCourseModal();
  else if (id === 'deleteTermModal') hideAppModal('deleteTermModal');
  else hideAppModal(id);
}

function handleAppModalKeydown(event) {
  const modals = visibleAppModals();
  const modal = modals[modals.length - 1];
  if (!modal) return false;
  if (modal.id === 'reasonModal' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    closeReasonModal('');
    return true;
  }
  if (modal.id === 'confirmModal' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    closeConfirmModal(true);
    return true;
  }
  if (modal.id === 'batchReviewModal' && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    closeBatchReviewModal(true);
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeAppModalById(modal.id);
    return true;
  }
  if (event.key !== 'Tab') return false;
  const focusable = appModalFocusableElements(modal);
  if (!focusable.length) {
    event.preventDefault();
    modal.focus?.();
    return true;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

// 自动检测API基础路径：/dept/<dept>/<term>/  或  /dept/<dept>/
const API_BASE = (() => {
  const path = window.location.pathname;
  const m = path.match(/^\/dept\/([^/]+)\/([^/]+)\//);
  if (m) return `/dept/${m[1]}/${m[2]}`;
  const m2 = path.match(/^\/dept\/([^/]+)\//);
  return m2 ? `/dept/${m2[1]}` : '';
})();
const DEPT_ID = (() => { const m = window.location.pathname.match(/^\/dept\/([^/]+)\//); return m ? m[1] : ''; })();
const TERM_ID = (() => { const m = window.location.pathname.match(/^\/dept\/[^/]+\/([^/]+)\//); return m ? m[1] : ''; })();

function getCookie(name) {
  if (window.AppUtils) return window.AppUtils.getCookie(name);
  return document.cookie.split('; ').reduce((found, part) => {
    if (found) return found;
    const eq = part.indexOf('=');
    if (eq < 0) return '';
    return decodeURIComponent(part.slice(0, eq)) === name ? decodeURIComponent(part.slice(eq + 1)) : '';
  }, '');
}

function stopBackgroundPolling() {
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
  if (dataRefreshTimer) {
    clearInterval(dataRefreshTimer);
    dataRefreshTimer = null;
  }
  presencePingQueued = false;
  renderPresenceIndicator([]);
}

function handleAuthExpired() {
  if (authExpired) return;
  authExpired = true;
  currentUser = null;
  stopBackgroundPolling();
  setSyncStatus('expired');
  showToast('登录已过期，请重新登录');
  setTimeout(() => {
    if (authExpired && !window.location.pathname.startsWith('/auth')) {
      window.location.href = '/auth';
    }
  }, 1200);
}

async function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {'ngrok-skip-browser-warning': '1', ...(options.headers || {})};
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['X-CSRF-Token'] = getCookie('sched_csrf');
    if (loadedVersion) headers['X-Data-Version'] = loadedVersion;
  }
  const res = await fetch(url, {...options, headers});
  if (res.status === 401) handleAuthExpired();
  return res;
}

async function readJsonResponse(res, fallbackLabel = '请求') {
  const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
  const text = await res.text();
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text || '{}');
    } catch(e) {
      return {error: `${fallbackLabel}返回内容格式异常`, code: 'invalid_json'};
    }
  }
  const statusText = res.status ? `${res.status}${res.statusText ? ' ' + res.statusText : ''}` : '未知状态';
  return {
    error: `${fallbackLabel}失败：服务器返回 ${statusText}`,
    code: 'non_json_response',
    response_preview: text.slice(0, 160),
  };
}

function dataCacheKey(name) {
  return `sched:data:${DEPT_ID || 'root'}:${TERM_ID || 'default'}:${name}`;
}

function readDataCache(name) {
  try {
    return JSON.parse(sessionStorage.getItem(dataCacheKey(name)) || 'null');
  } catch(e) {
    return null;
  }
}

function writeDataCache(name, etag, text) {
  if (!etag || !text) return;
  try {
    sessionStorage.setItem(dataCacheKey(name), JSON.stringify({etag, text, savedAt: Date.now()}));
  } catch(e) {
    // Browser storage may be full or disabled; loading still works without this cache.
  }
}

function clearDataCache(name) {
  try {
    sessionStorage.removeItem(dataCacheKey(name));
  } catch(e) {}
}

async function fetchCachedText(url, cacheName) {
  const cached = readDataCache(cacheName);
  const headers = {};
  if (cached?.etag && cached?.text) headers['If-None-Match'] = cached.etag;
  let res = await apiFetch(url, {headers});
  if (res.status === 304 && cached?.text) {
    return {res, text: cached.text, fromCache: true};
  }
  if (res.status === 304) {
    clearDataCache(cacheName);
    res = await apiFetch(url, {headers: {'Cache-Control': 'no-cache'}});
  }
  if (!res.ok) throw new Error('server error');
  const text = await res.text();
  writeDataCache(cacheName, res.headers.get('ETag'), text);
  return {res, text, fromCache: false};
}

function invalidateConflictDataCache() {
  conflictDataCache = null;
  conflictFullFetchPromise = null;
  conflictListRenderSignature = '';
}

function invalidateCapacityStatsCache() {
  capacityStatsCache = null;
  capacityRenderSignature = '';
  capacityHeadSignature = '';
  heatmapData = null;
  heatmapRenderSignature = '';
  heatmapFilterSignature = '';
}

function courseDerivedFields(c) {
  return [
    c?.id ?? '',
    c?.teacher || '',
    c?.slot || '',
    c?.timeRange || '',
    c?.room || '',
    c?.period || '',
    c?.classType || '',
    c?.campus || '',
    c?.season || '',
    c?.day || '',
    c?.subject || '',
    getActualGrade(c) || '',
    c?.name || '',
    c?.code || '',
    c?.currentCount ?? '',
    courseLifecycleStatus(c),
    c?.merged_into_id ?? '',
    c?.merged_into_code || '',
    c?.merged_count_added ?? '',
    JSON.stringify(c?.merge_sources || []),
  ];
}

function courseDerivedViewSignature() {
  return JSON.stringify(courses.map(courseDerivedFields));
}

function markCourseDataChanged({force = false} = {}) {
  const nextSignature = courseDerivedViewSignature();
  if (force || nextSignature !== derivedCourseSignature) {
    derivedCourseSignature = nextSignature;
    invalidateConflictDataCache();
    invalidateCapacityStatsCache();
  }
  refreshConflictCache();
}

function mergeLocalCourse(updated) {
  if (!updated) return false;
  const idx = findCourseIndex(updated.id);
  if (idx < 0) return false;
  const beforeSignature = JSON.stringify(courseDerivedFields(courses[idx]));
  courses[idx] = {...courses[idx], ...updated};
  const afterSignature = JSON.stringify(courseDerivedFields(courses[idx]));
  return beforeSignature !== afterSignature;
}

function mergeLocalCourses(updatedCourses = []) {
  let changed = false;
  updatedCourses.filter(Boolean).forEach(updated => {
    if (mergeLocalCourse(updated)) changed = true;
  });
  if (changed) markCourseDataChanged();
  else refreshConflictCache();
}

function removeLocalCourse(id) {
  const before = courses.length;
  courses = courses.filter(c => String(c.id) !== String(id));
  if (courses.length !== before) markCourseDataChanged();
  else refreshConflictCache();
}

function normalizeDataVersion(version) {
  if (version == null || version === '') return null;
  const text = String(version);
  return text.startsWith('sqlite:') ? text : `sqlite:${text}`;
}

function setLoadedVersion(version) {
  const normalized = normalizeDataVersion(version);
  if (normalized !== loadedVersion) {
    invalidateConflictDataCache();
    invalidateCapacityStatsCache();
  }
  loadedVersion = normalized;
}

function applyResponseVersion(res) {
  const version = res.headers.get('X-Data-Version');
  if (version) setLoadedVersion(version);
}

async function handleVersionConflict(res, data) {
  if (res.status === 403 && data && data.error && data.error.includes('流程状态')) {
    setSyncStatus('');
    showToast(data.error);
    await confirmAction({
      title: '流程状态不可编辑',
      message: data.error,
      confirmText: '知道了',
    });
    return true;
  }
  const code = data && data.code;
  const isDataVersionConflict = ['version_conflict', 'missing_data_version'].includes(code)
    || Boolean(data && data.current_version && [409, 428].includes(res.status));
  if (!isDataVersionConflict) return false;
  setSyncStatus('');
  const msg = data.error || '数据已被其他人修改，请刷新后再操作';
  showToast(msg);
  await loadData();
  await confirmAction({
    title: '数据版本已更新',
    message: msg + '\n\n页面已刷新到最新版本，请核对后重新提交刚才的修改。',
    confirmText: '知道了',
  });
  return true;
}

const slotLabels = {A:'08:00-10:00',B:'10:20-12:20',C:'13:30-15:30',D:'15:50-17:50',E:'18:30-20:30'};
const slotLabelsQingshao = {A:'08:30-10:30',B:'10:40-12:40',C:'14:00-16:00',D:'16:10-18:10',E:'18:30-20:30'};
const currentSlotLabels = DEPT_ID === 'qingshao' ? slotLabelsQingshao : slotLabels;
const FIELD_LABELS = {teacher:'授课教师', slot:'时段', timeRange:'上课时间', room:'教室', period:'期数', classType:'班型', campus:'校区', name:'班级名称', lifecycle_status:'班级状态', currentCount:'当前人数', merged_into_code:'合并至班级', room_occupancy_notice:'教室占用提醒', create:'新增', delete:'删除'};
const SUMMER_PERIODS = ['1期','2期','3期'];
const AUTUMN_PERIODS = ['周五','周六','周日'];
const SUITE_SUBJECTS = ['博文','双语','益智','科学','实践'];
const SLOT_ORDER = ['A','B','C','D','E'];

function escapeHtml(value) {
  if (window.AppUtils) return window.AppUtils.escapeHtml(value);
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
function escapeAttr(value) {
  if (window.AppUtils) return window.AppUtils.escapeAttr(value);
  return escapeHtml(value).replace(/`/g, '&#96;');
}
function escapeSelectorValue(value) {
  return window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
}
function findCourseIndex(id) {
  return courses.findIndex(c => String(c.id) === String(id));
}
function findCourse(id) {
  const idx = findCourseIndex(id);
  return idx >= 0 ? courses[idx] : null;
}
function getOriginal(c) {
  if (!c || !isOriginalReady()) return null;
  return originalById.get(String(c.id)) || originalData[c.id] || {};
}

function resetOriginalData() {
  originalData = [];
  originalById = new Map();
  originalLoadedVersion = null;
}

function applyOriginalPayload(text, version) {
  const parsed = JSON.parse(text || '[]');
  originalData = Array.isArray(parsed) ? parsed : [];
  originalById = new Map(originalData.map((c, i) => [String(c.id ?? i), c]));
  originalLoadedVersion = version || loadedVersion || '';
}

function isOriginalReady() {
  return Boolean(originalLoadedVersion && (!loadedVersion || originalLoadedVersion === loadedVersion));
}

function loadOriginalDataInBackground({render = true} = {}) {
  const requestVersion = loadedVersion || '';
  if (originalLoadPromise && originalLoadRequestVersion === requestVersion) return originalLoadPromise;
  originalLoadRequestVersion = requestVersion;
  originalLoadPromise = (async () => {
    try {
      const result = await fetchCachedText(`${API_BASE}/api/original`, 'original');
      const responseVersion = normalizeDataVersion(result.res.headers.get('X-Data-Version') || requestVersion || loadedVersion || '') || '';
      if (!requestVersion || requestVersion === loadedVersion) {
        applyOriginalPayload(result.text, responseVersion);
        if (render && responseVersion === loadedVersion) renderSchedule();
      }
    } catch(e) {
      if (!isOriginalReady()) resetOriginalData();
    } finally {
      originalLoadPromise = null;
      originalLoadRequestVersion = null;
    }
  })();
  return originalLoadPromise;
}

function normalizeSelectedCourseIds() {
  if (!canEditNow()) {
    selectedCourseIds.clear();
    return;
  }
  const existing = new Set(courses.filter(isActiveCourse).map(c => String(c.id)));
  selectedCourseIds = new Set([...selectedCourseIds].filter(id => existing.has(String(id))));
}

function updateBatchToolbar() {
  normalizeSelectedCourseIds();
  const canBatchEdit = canEditNow();
  const toolbar = document.getElementById('batchToolbar');
  if (toolbar) {
    toolbar.classList.toggle('is-visible', selectedCourseIds.size > 0);
    toolbar.classList.toggle('is-readonly', !canBatchEdit);
  }
  const countEl = document.getElementById('batchSelectedCount');
  if (countEl) countEl.textContent = `已选 ${selectedCourseIds.size} 门课`;
  const hint = document.getElementById('batchHint');
  if (hint) {
    hint.textContent = canBatchEdit
      ? (selectedCourseIds.size > 20 ? '单次最多 20 门课，请减少选择后再应用。' : '批量操作会先做冲突检测，失败不会保存。')
      : '当前流程状态不可批量修改。';
    hint.style.color = canBatchEdit && selectedCourseIds.size > 20 ? '#c62828' : '#777';
  }
  const pageBox = document.getElementById('batchSelectPage');
  if (pageBox) {
    const pageSelected = currentSchedulePageIds.filter(id => selectedCourseIds.has(String(id))).length;
    pageBox.checked = currentSchedulePageIds.length > 0 && pageSelected === currentSchedulePageIds.length;
    pageBox.indeterminate = pageSelected > 0 && pageSelected < currentSchedulePageIds.length;
    pageBox.disabled = !canBatchEdit || currentSchedulePageIds.length === 0;
  }
  ['batchField', 'batchValue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canBatchEdit;
  });
  document.querySelectorAll('[data-batch-control="1"]').forEach(el => {
    el.disabled = !canBatchEdit || (el.dataset.batchApply === '1' && selectedCourseIds.size === 0);
  });
}

function toggleSelectCurrentPage(force) {
  if (!canEditNow()) return;
  const shouldSelect = typeof force === 'boolean'
    ? force
    : currentSchedulePageIds.some(id => !selectedCourseIds.has(String(id)));
  currentSchedulePageIds.forEach(id => {
    const key = String(id);
    if (shouldSelect) selectedCourseIds.add(key);
    else selectedCourseIds.delete(key);
  });
  renderSchedule();
}

function clearBatchSelection() {
  selectedCourseIds.clear();
  renderSchedule();
}

function renderBatchValueControl() {
  const field = document.getElementById('batchField')?.value || 'teacher';
  const wrap = document.getElementById('batchValueWrap');
  if (!wrap) return;
  if (field === 'slot') {
    wrap.innerHTML = `<select id="batchValue">${['A','B','C','D','E'].map(s => `<option value="${s}">${s}段 ${escapeHtml(currentSlotLabels[s] || '')}</option>`).join('')}</select>`;
  } else if (field === 'period') {
    wrap.innerHTML = `<select id="batchValue">${['1期','2期','3期','周五','周六','周日'].map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('')}</select>`;
  } else if (field === 'classType') {
    wrap.innerHTML = `<select id="batchValue"><option value="">清空</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></select>`;
  } else {
    const placeholder = field === 'teacher' ? '输入教师姓名' : '输入教室名称';
    wrap.innerHTML = `<input id="batchValue" type="text" placeholder="${placeholder}">`;
  }
  document.getElementById('batchValue')?.addEventListener('input', () => markUserEditing(4000));
}

function sundayAfternoonBatchWarnings(updates = []) {
  const warnings = [];
  updates.forEach(item => {
    const course = findCourse(item.id);
    const fields = item.fields || {};
    if (isSundayAfternoonSchedule(course, fields)) {
      const label = course ? `${course.code || ''} ${course.name || ''}`.trim() : `课程 ${item.id}`;
      const period = fields.period ?? course?.period ?? '';
      const day = fields.day ?? course?.day ?? '';
      const slot = fields.slot ?? course?.slot ?? '';
      warnings.push(`${label}：${period || day} ${slot}段`);
    }
  });
  return warnings;
}

function closeBatchReviewModal(confirmed = null) {
  const reasonInput = document.getElementById('batchReviewReason');
  const reasonHint = document.getElementById('batchReviewReasonHint');
  const reason = reasonInput ? reasonInput.value.trim() : '';
  hideAppModal('batchReviewModal');
  const resolve = pendingBatchReviewResolve;
  pendingBatchReviewResolve = null;
  if (confirmed && reason) currentActionReason = reason;
  if (reasonInput) reasonInput.value = '';
  if (reasonHint) reasonHint.textContent = '';
  if (resolve) resolve(confirmed ? {reason} : null);
}

function reviewBatchUpdate({ids, field, label, value, warnings}) {
  const body = document.getElementById('batchReviewBody');
  const sampleCourses = ids
    .slice(0, 6)
    .map(id => findCourse(id))
    .filter(Boolean);
  if (!body) {
    showToast('批量复核弹窗未加载，请刷新页面后重试');
    return Promise.resolve(null);
  }
  const sampleHtml = sampleCourses.length
    ? sampleCourses.map(c => `
      <div class="batch-review-course">
        <b>${escapeHtml(c.code || '')}</b>
        <span>${escapeHtml(c.name || '')}</span>
        <em>${escapeHtml([shortCampus(c.campus), getActualGrade(c), c.subject, c.period && c.slot ? `${c.period}${c.slot}` : ''].filter(Boolean).join(' · '))}</em>
      </div>
    `).join('')
    : '<div class="batch-review-empty">未找到课程明细，请刷新后重试。</div>';
  const warningHtml = warnings.length ? `
    <div class="batch-review-warning">
      <b>周日返校提醒</b>
      <p>以下课程会被安排在周日 C/D/E 段，这类安排仅建议用于特殊班级。</p>
      ${warnings.slice(0, 6).map(w => `<div>${escapeHtml(w)}</div>`).join('')}
      ${warnings.length > 6 ? `<div>等 ${escapeHtml(warnings.length)} 门课</div>` : ''}
    </div>
  ` : '';
  body.innerHTML = `
    <div class="batch-review-summary">
      <div><span>修改数量</span><b>${escapeHtml(ids.length)}</b></div>
      <div><span>修改字段</span><b>${escapeHtml(label)}</b></div>
      <div><span>目标值</span><b>${escapeHtml(value || '清空')}</b></div>
    </div>
    ${warningHtml}
    <div class="batch-review-list">
      <div class="batch-review-title">影响课程预览</div>
      ${sampleHtml}
      ${ids.length > sampleCourses.length ? `<div class="batch-review-more">另有 ${escapeHtml(ids.length - sampleCourses.length)} 门课将一起修改</div>` : ''}
    </div>
  `;
  const reasonInput = document.getElementById('batchReviewReason');
  const reasonHint = document.getElementById('batchReviewReasonHint');
  if (reasonInput) reasonInput.value = currentActionReason || '';
  if (reasonHint) reasonHint.textContent = '';
  if (pendingBatchReviewResolve) closeBatchReviewModal(null);
  showAppModal('batchReviewModal', '#batchReviewReason');
  return new Promise(resolve => {
    pendingBatchReviewResolve = resolve;
  });
}

function showBatchIssues(conflicts = [], errors = []) {
  const rows = [];
  conflicts.forEach((item, idx) => {
    const course = findCourse(item.id);
    const label = item.label || [course?.code, course?.name].filter(Boolean).join(' ') || `课程 ${item.id}`;
    const parts = [item.error || '修改后存在冲突'];
    if (item.teacher_conflict) {
      parts.push(`教师冲突：${item.teacher_conflict.code || ''} ${item.teacher_conflict.name || ''}`.trim());
    }
    if (item.room_conflict) {
      parts.push(`教室冲突：${item.room_conflict.code || ''} ${item.room_conflict.name || ''}`.trim());
    }
    if (item.shared_room_conflict) {
      const c = item.shared_room_conflict;
      parts.push(`跨部门教室冲突：${c.dept_label || c.dept_id || ''} ${c.code || ''} ${c.name || ''}`.trim());
    }
    rows.push([`冲突 ${idx + 1}`, `${label}\n${parts.filter(Boolean).join('\n')}`]);
  });
  errors.forEach((item, idx) => {
    const course = findCourse(item.id);
    const label = [course?.code, course?.name].filter(Boolean).join(' ') || `课程 ${item.id}`;
    rows.push([`错误 ${idx + 1}`, `${label}\n${item.error || '无法修改'}`]);
  });
  if (rows.length) openDetailModal('批量修改复核', rows);
}

function conflictCourseText(course) {
  if (!course) return '';
  const time = [course.period, course.slot ? `${course.slot}段` : '', course.day].filter(Boolean).join(' ');
  return [
    course.code,
    course.name,
    course.teacher,
    course.campus,
    time,
    course.room,
  ].filter(Boolean).join(' · ');
}

function showMutationIssue(title, data = {}, contextRows = []) {
  const rows = [...contextRows];
  const addConflict = (label, course) => {
    if (course) rows.push([label, conflictCourseText(course) || (course.name || course.code || '冲突课程')]);
  };
  addConflict('教师冲突', data.teacher_conflict);
  addConflict('教室冲突', data.room_conflict);
  addConflict('跨部门教室冲突', data.shared_room_conflict);
  if (!rows.length && data.error) rows.push(['原因', data.error]);
  showToast(data.error || title || '修改失败');
  if (rows.length) openDetailModal(title || '修改失败', rows);
}

async function applyBatchUpdate() {
  if (!canEditNow()) {
    showToast('当前流程状态下不可批量修改');
    return;
  }
  const ids = [...selectedCourseIds];
  if (!ids.length) {
    showToast('请先勾选课程');
    return;
  }
  if (ids.length > 20) {
    showToast('单次最多批量修改 20 门课');
    return;
  }
  const field = document.getElementById('batchField')?.value || '';
  const valueEl = document.getElementById('batchValue');
  const value = valueEl ? valueEl.value.trim() : '';
  if (!field) return;
  if (field !== 'classType' && !value) {
    showToast('请填写批量修改内容');
    return;
  }
  const label = FIELD_LABELS[field] || field;
  const fields = {[field]: value};
  if (field === 'slot') fields.timeRange = currentSlotLabels[value] || '';
  const updates = ids.map(id => ({id, fields}));
  const review = await reviewBatchUpdate({
    ids,
    field,
    label,
    value,
    warnings: sundayAfternoonBatchWarnings(updates),
  });
  if (!review) return;
  const reason = review.reason || '';
  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/courses/batch`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        updates,
        reason,
        partial_success: true,
      }),
    });
    const data = await res.json();
    if (await handleVersionConflict(res, data)) return;
    if (!res.ok || data.error) throw new Error(data.error || 'batch failed');
    applyResponseVersion(res);
    mergeLocalCourses(data.courses || []);
    const failedIds = [
      ...(data.conflicts || []).map(x => String(x.id)),
      ...(data.errors || []).map(x => String(x.id)),
    ];
    selectedCourseIds = new Set(failedIds);
    setSyncStatus('saved');
    const successCount = data.courses?.length || 0;
    const issueCount = (data.conflicts?.length || 0) + (data.errors?.length || 0);
    showToast(issueCount ? `已修改 ${successCount} 门，${issueCount} 门需复核` : `已批量修改 ${successCount || ids.length} 门课`);
    renderAll();
    if (issueCount) showBatchIssues(data.conflicts || [], data.errors || []);
  } catch(e) {
    setSyncStatus('');
    showToast('批量修改失败');
  }
}
const WORKFLOW_EDIT_ROLES = window.AppUtils?.workflowEditRoles || {
  draft: ['admin','jiaowu'],
  scheduling: ['admin','jiaowu','director','supervisor','regional_manager','store_manager'],
  reviewing: ['admin','jiaowu','director','supervisor','regional_manager'],
  confirmed: ['admin','jiaowu'],
};
const ROLE_LABELS = window.AppUtils?.roleLabels || {admin:'管理员',jiaowu:'教务',director:'总监',supervisor:'教学主管',regional_manager:'大区经理',store_manager:'店长',user:'普通用户'};

function workflowEditState() {
  const status = (currentWorkflow && currentWorkflow.status) || 'draft';
  const role = currentUser && currentUser.role;
  const allowed = WORKFLOW_EDIT_ROLES[status] || [];
  return {
    status,
    canEdit: !!role && allowed.includes(role),
    allowedLabels: allowed.map(r => ROLE_LABELS[r] || r),
  };
}

function canEditNow() {
  return workflowEditState().canEdit;
}

function isSundayAfternoonSchedule(course, fields = {}) {
  const period = String(fields.period ?? course?.period ?? '');
  const day = String(fields.day ?? course?.day ?? '');
  const slot = String(fields.slot ?? course?.slot ?? '');
  return (period.includes('周日') || day.includes('周日')) && ['C', 'D', 'E'].includes(slot);
}

function sundayAfternoonWarning(course, fields = {}) {
  if (!isSundayAfternoonSchedule(course, fields)) return '';
  const label = course ? `${course.code || ''} ${course.name || ''}`.trim() : '该课程';
  const period = fields.period ?? course?.period ?? '';
  const day = fields.day ?? course?.day ?? '';
  const slot = fields.slot ?? course?.slot ?? '';
  return `注意：${label} 将安排在${period || day} ${slot}段。周日学生下午通常返校，C/D/E段仅适合特殊班级。\n\n确认仍然保存吗？`;
}

async function confirmSundayAfternoonIfNeeded(course, fields = {}) {
  const warning = sundayAfternoonWarning(course, fields);
  if (!warning) return true;
  return confirmAction({
    title: '周日返校提醒',
    message: warning.replace(/\n\n确认仍然保存吗？$/, ''),
    confirmText: '仍然保存',
  });
}

async function confirmSundayAfternoonBatch(updates = []) {
  const warnings = [];
  updates.forEach(item => {
    const course = findCourse(item.id);
    const fields = item.fields || {};
    if (isSundayAfternoonSchedule(course, fields)) {
      const label = course ? `${course.code || ''} ${course.name || ''}`.trim() : `课程 ${item.id}`;
      const period = fields.period ?? course?.period ?? '';
      const day = fields.day ?? course?.day ?? '';
      const slot = fields.slot ?? course?.slot ?? '';
      warnings.push(`${label}：${period || day} ${slot}段`);
    }
  });
  if (!warnings.length) return true;
  return confirmAction({
    title: '周日返校提醒',
    message: `以下课程将安排在周日 C/D/E 段。周日学生下午通常返校，C/D/E段仅适合特殊班级。\n\n${warnings.slice(0, 6).join('\n')}${warnings.length > 6 ? `\n等 ${warnings.length} 门课` : ''}`,
    confirmText: '仍然保存',
  });
}

function canApplySuggestion(s) {
  if (!canEditNow()) return false;
  if (s.category === 'low_enrollment_release') {
    const role = currentUser && currentUser.role;
    return ['admin', 'jiaowu', 'director', 'supervisor', 'regional_manager'].includes(role);
  }
  if (['需复核', '需协调'].includes(s.risk)) return false;
  const role = currentUser && currentUser.role;
  if (['admin', 'jiaowu'].includes(role)) return true;
  if (['teacher_time', 'teacher_substitute', 'coordinated_swap'].includes(s.category)) {
    return ['director', 'supervisor', 'regional_manager'].includes(role);
  }
  if (s.category === 'room_swap') {
    if (role !== 'store_manager') return false;
    return !currentUser.campus || !s.campus || currentUser.campus === s.campus;
  }
  return false;
}

const SUGGESTION_CATEGORY_RANK = {
  teacher_substitute: 0,
  teacher_time: 1,
  coordinated_swap: 2,
  suite_reflow: 3,
  suite_coordination: 4,
  low_enrollment_release: 5,
  room_swap: 0,
};

function suggestionCategoryRank(category) {
  return SUGGESTION_CATEGORY_RANK[category] ?? 9;
}

function suggestionActionBlockedLabel(s) {
  if (s.category === 'low_enrollment_release') {
    if (!canEditNow()) return '';
    return '主管复核项';
  }
  if (['需复核', '需协调'].includes(s.risk)) return '需人工复核后手动处理';
  if (!canEditNow()) return '';
  const role = currentUser && currentUser.role;
  if (['admin', 'jiaowu'].includes(role)) return '';
  if (['teacher_time', 'teacher_substitute', 'coordinated_swap'].includes(s.category)) return '主管处理项';
  if (s.category === 'room_swap') return '店长处理项';
  return '';
}

function updateEditLockUI() {
  const state = workflowEditState();
  const hint = document.getElementById('wfEditHint');
  if (hint) {
    hint.textContent = state.canEdit
      ? `当前你可以编辑；${state.allowedLabels.join('、')}可操作`
      : `当前不可编辑；${state.allowedLabels.join('、')}可操作`;
  }
  document.body.classList.toggle('editing-locked', !state.canEdit);
  const newBtn = document.getElementById('newCourseBtn');
  if (newBtn) {
    newBtn.disabled = !state.canEdit;
    newBtn.title = state.canEdit ? '' : '当前流程状态下不可新增排课';
    newBtn.style.opacity = state.canEdit ? '1' : '0.45';
  }
  updateUndoBtn();
  updatePermissionHint();
}

function updatePermissionHint() {
  const el = document.getElementById('permissionHint');
  if (!el || !currentUser) return;
  const role = currentUser.role;
  if (['admin','jiaowu'].includes(role)) el.textContent = '权限：可跨部门查看和调整';
  else if (['director','supervisor','regional_manager'].includes(role)) el.textContent = '权限：只能调整本部门课程';
  else if (role === 'store_manager') el.textContent = `权限：只能调整${currentUser.campus || '本校区'}课程`;
  else el.textContent = '权限：仅查看';
}

function closeReasonModal(result = null) {
  hideAppModal('reasonModal');
  const input = document.getElementById('reasonModalInput');
  const remember = document.getElementById('reasonModalRemember');
  const value = input ? input.value.trim() : '';
  const resolve = pendingReasonResolve;
  pendingReasonResolve = null;
  if (result !== null && remember?.checked && value) currentActionReason = value;
  if (input) input.value = '';
  if (resolve) resolve(result === null ? null : value);
}

function askActionReason(action, hint = '高风险操作建议记录原因，便于后续追溯。', options = {}) {
  const modal = document.getElementById('reasonModal');
  const title = document.getElementById('reasonModalTitle');
  const hintEl = document.getElementById('reasonModalHint');
  const input = document.getElementById('reasonModalInput');
  const remember = document.getElementById('reasonModalRemember');
  if (!modal || !input) return Promise.resolve('');
  if (pendingReasonResolve) closeReasonModal(null);
  if (title) title.textContent = `${action}原因`;
  if (hintEl) hintEl.textContent = hint;
  input.value = options.prefill ?? currentActionReason ?? '';
  if (remember) remember.checked = Boolean(input.value);
  showAppModal('reasonModal', '#reasonModalInput');
  return new Promise(resolve => {
    pendingReasonResolve = resolve;
  });
}

function closeConfirmModal(confirmed = false) {
  hideAppModal('confirmModal');
  const resolve = pendingAppConfirmResolve;
  pendingAppConfirmResolve = null;
  if (resolve) resolve(Boolean(confirmed));
}

function confirmAction(options = {}) {
  const {
    title = '确认操作',
    message = '',
    confirmText = '确认',
    danger = false,
  } = options;
  const modal = document.getElementById('confirmModal');
  const titleEl = document.getElementById('confirmModalTitle');
  const bodyEl = document.getElementById('confirmModalBody');
  const submit = document.getElementById('confirmModalSubmit');
  if (!modal || !bodyEl) {
    showToast('确认弹窗未加载，请刷新页面后重试');
    return Promise.resolve(false);
  }
  if (pendingAppConfirmResolve) closeConfirmModal(false);
  if (titleEl) {
    titleEl.textContent = title;
    titleEl.style.color = danger ? '#b91c1c' : '#1a237e';
  }
  bodyEl.textContent = message;
  if (submit) {
    submit.textContent = confirmText;
    submit.style.background = danger ? '#b91c1c' : '#1a237e';
  }
  showAppModal('confirmModal', '#confirmModalSubmit');
  return new Promise(resolve => {
    pendingAppConfirmResolve = resolve;
  });
}

function defaultActionReason(action) {
  return currentActionReason || action || '';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
function setSyncStatus(s) {
  const el = document.getElementById('syncStatus');
  el.className = 'sync-status ' + s;
  el.textContent = s === 'saving' ? '保存中...' : s === 'saved' ? '已保存' : s === 'expired' ? '需重新登录' : '已连接';
}

function activeTabName() {
  return document.querySelector('.tab.active')?.dataset?.tab || 'schedule';
}

function tabPresenceLabel(tab) {
  return {
    schedule: '课程排表',
    overview: '校区课表总览',
    capacity: '教师产能表',
    classrooms: '教室空挡表',
    heatmap: '产能热力图',
    conflicts: '冲突汇总',
    changelog: '修改记录',
  }[tab] || tab || '当前页面';
}

function currentPresenceCourseId() {
  const active = document.activeElement;
  const row = active?.closest?.('tr[data-id]');
  if (row?.dataset?.id) return row.dataset.id;
  if (selectedCourseIds.size === 1) return [...selectedCourseIds][0];
  return '';
}

function setPresenceState(next = {}, pingNow = false) {
  presenceState = {
    ...presenceState,
    tab: activeTabName(),
    ...next,
  };
  if (!presenceState.courseId && !presenceState.field && presenceState.activity !== 'editing') {
    presenceState.courseId = currentPresenceCourseId();
  }
  if (pingNow) pingPresence();
}

function currentPresencePayload() {
  const courseId = presenceState.courseId || currentPresenceCourseId();
  const tab = activeTabName();
  const activity = presenceState.activity || (courseId ? 'viewing' : 'online');
  return {
    cursor: courseId || '',
    activity,
    tab,
    course_id: courseId || '',
    field: presenceState.field || '',
  };
}

function markPresenceViewingCourse(id, pingNow = false) {
  if (!id) return;
  setPresenceState({activity: 'viewing', courseId: String(id), field: ''}, pingNow);
}

function markPresenceEditingElement(el) {
  const id = el?.dataset?.id || el?.closest?.('tr[data-id]')?.dataset?.id || '';
  const field = el?.dataset?.field || '';
  if (!id) return;
  setPresenceState({activity: 'editing', courseId: String(id), field}, true);
}

function presenceCounts(users = latestPresenceUsers) {
  const list = Array.isArray(users) ? users : [];
  const editing = list.filter(u => presenceActivityType(u) === 'editing').length;
  const viewing = list.filter(u => ['viewing', 'selecting'].includes(presenceActivityType(u))).length;
  return {
    total: list.length,
    editing,
    viewing,
    online: Math.max(0, list.length - editing - viewing),
  };
}

function presenceUserName(u) {
  return u?.name || u?.email || '未知用户';
}

function presenceCourseId(u) {
  return String(u?.course_id || u?.cursor || '');
}

function samePresenceCourse(u, courseId) {
  return courseId && presenceCourseId(u) === String(courseId);
}

function presenceOverlapAlerts(users = latestPresenceUsers) {
  const list = Array.isArray(users) ? users : [];
  const currentCourseId = currentPresenceCourseId() || presenceState.courseId || '';
  const currentTab = activeTabName();
  const sameCourseEditors = list.filter(u => presenceActivityType(u) === 'editing' && samePresenceCourse(u, currentCourseId));
  const sameCourseViewers = list.filter(u => ['viewing', 'selecting'].includes(presenceActivityType(u)) && samePresenceCourse(u, currentCourseId));
  const sameTabEditors = list.filter(u => (
    presenceActivityType(u) === 'editing'
    && !samePresenceCourse(u, currentCourseId)
    && (u.tab || '') === currentTab
  ));
  const compactNames = group => group.slice(0, 3).map(presenceUserName).join('、') + (group.length > 3 ? ` 等${group.length}人` : '');
  const alerts = [];
  if (sameCourseEditors.length) {
    alerts.push({
      level: 'bad',
      title: '同一课程正在编辑',
      detail: `${compactNames(sameCourseEditors)} 正在编辑当前课程，保存前建议先核对最新状态。`,
    });
  }
  if (!sameCourseEditors.length && sameCourseViewers.length) {
    alerts.push({
      level: 'warn',
      title: '同一课程有人查看',
      detail: `${compactNames(sameCourseViewers)} 正在查看当前课程，可先确认是否正在协同处理。`,
    });
  }
  if (sameTabEditors.length) {
    alerts.push({
      level: 'warn',
      title: '同页面有人编辑',
      detail: `${compactNames(sameTabEditors)} 正在${tabPresenceLabel(currentTab)}编辑其他课程。`,
    });
  }
  return alerts;
}

function renderPresenceIndicator(users) {
  const el = document.getElementById('presenceIndicator');
  if (!el) return;
  const list = Array.isArray(users) ? users : [];
  latestPresenceUsers = list;
  el.classList.toggle('visible', list.length > 0);
  el.classList.remove('has-editors');
  if (!list.length) {
    el.textContent = '';
    el.title = '';
    el.setAttribute('aria-expanded', 'false');
    renderPresencePopover();
    return;
  }
  const counts = presenceCounts(list);
  el.classList.toggle('has-editors', counts.editing > 0);
  el.textContent = counts.editing
    ? `协作 ${counts.total} · 编辑${counts.editing} 查看${counts.viewing}`
    : `协作 ${counts.total} · 查看${counts.viewing}`;
  el.title = list.map(describePresenceUser).join('\n');
  renderPresencePopover();
  el.setAttribute('aria-expanded', document.getElementById('presencePopover')?.classList.contains('show') ? 'true' : 'false');
}

function describePresenceCursor(cursor) {
  if (!cursor) return '在线';
  const course = findCourse(cursor);
  if (!course) return `课程 ${cursor}`;
  return [course.code, course.name].filter(Boolean).join(' ') || `课程 ${cursor}`;
}

function presenceActivityType(u) {
  return u.activity || (u.cursor || u.course_id ? 'viewing' : 'online');
}

function presenceActivityLabel(activity) {
  return {
    editing: '编辑中',
    viewing: '查看中',
    selecting: '选择中',
    online: '在线',
  }[activity] || '在线';
}

function presenceAgeText(secondsAgo) {
  const seconds = Number(secondsAgo);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 8) return '刚刚';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}秒前`;
  return `${Math.round(seconds / 60)}分钟前`;
}

function presenceCourseText(u) {
  const courseId = u.course_id || u.cursor || '';
  return courseId ? describePresenceCursor(courseId) : '';
}

function describePresenceAction(u) {
  const activity = presenceActivityType(u);
  const field = u.field ? (FIELD_LABELS[u.field] || u.field) : '';
  const courseText = presenceCourseText(u);
  const tabText = tabPresenceLabel(u.tab || '');
  if (activity === 'editing') {
    return `正在编辑：${[courseText, field].filter(Boolean).join(' · ') || tabText}`;
  }
  if (activity === 'viewing') {
    return `正在查看：${courseText || tabText}`;
  }
  if (activity === 'selecting') {
    return courseText ? `正在选择：${courseText}` : `正在查看：${tabText}`;
  }
  return `在线：${tabText}`;
}

function describePresenceUser(u) {
  const name = u.name || u.email || '未知用户';
  const role = u.role ? `${u.role}` : '';
  const campus = u.campus ? ` · ${u.campus}` : '';
  const age = presenceAgeText(u.seconds_ago);
  return `${name}${campus} · ${describePresenceAction(u)}${role ? ` · ${role}` : ''}${age ? ` · ${age}` : ''}`;
}

function presenceActionSummary(u, courseText, field, tabText) {
  const activity = presenceActivityType(u);
  if (activity === 'editing') {
    if (courseText && field) return '正在编辑课程字段';
    return field ? `正在编辑 ${field}` : '正在编辑课程';
  }
  if (activity === 'viewing') return courseText ? '正在查看课程' : `正在查看 ${tabText}`;
  if (activity === 'selecting') return courseText ? '正在选择课程' : `正在查看 ${tabText}`;
  return `在线停留 ${tabText}`;
}

function renderPresencePopover() {
  const pop = document.getElementById('presencePopover');
  if (!pop) return;
  if (!latestPresenceUsers.length) {
    pop.classList.remove('show');
    pop.innerHTML = '';
    document.getElementById('presenceIndicator')?.setAttribute('aria-expanded', 'false');
    return;
  }
  const groups = [
    ['editing', '正在编辑'],
    ['viewing', '正在查看'],
    ['online', '在线'],
  ].map(([key, label]) => {
    const users = latestPresenceUsers.filter(u => {
      const activity = presenceActivityType(u);
      if (key === 'viewing') return activity === 'viewing' || activity === 'selecting';
      if (key === 'online') return !['editing', 'viewing', 'selecting'].includes(activity);
      return activity === key;
    });
    return {key, label, users};
  }).filter(g => g.users.length);
  const counts = presenceCounts(latestPresenceUsers);
  const alerts = presenceOverlapAlerts(latestPresenceUsers);
  pop.innerHTML = `<div class="presence-head">
    <div>
      <h4>当前协作</h4>
      <div class="presence-head-subtitle">显示其他在线用户正在查看或编辑的位置</div>
    </div>
    <div class="presence-summary">
      <span>编辑 ${escapeHtml(counts.editing)}</span>
      <span>查看 ${escapeHtml(counts.viewing)}</span>
      <span>在线 ${escapeHtml(counts.online)}</span>
    </div>
  </div>${alerts.length ? `<div class="presence-alerts">
    ${alerts.map(item => `<div class="presence-alert ${escapeAttr(item.level)}">
      <b>${escapeHtml(item.title)}</b>
      <span>${escapeHtml(item.detail)}</span>
    </div>`).join('')}
  </div>` : ''}${groups.map(group => `
    <div class="presence-group">
      <div class="presence-group-title"><span>${escapeHtml(group.label)}</span><span>${escapeHtml(group.users.length)}人</span></div>
      ${group.users.map(u => {
        const name = presenceUserName(u);
        const activity = presenceActivityType(u);
        const badgeType = activity === 'editing' ? 'editing' : ['viewing', 'selecting'].includes(activity) ? 'viewing' : '';
        const role = u.role ? ROLE_LABELS[u.role] || u.role : '';
        const campus = u.campus ? shortCampus(u.campus) : '';
        const field = u.field ? (FIELD_LABELS[u.field] || u.field) : '';
        const courseText = presenceCourseText(u);
        const tabText = tabPresenceLabel(u.tab || '');
        const age = presenceAgeText(u.seconds_ago);
        const meta = [role, campus, tabText, age].filter(Boolean).join(' · ');
        const actionText = presenceActionSummary(u, courseText, field, tabText);
        const courseLine = courseText
          ? `<span class="presence-course">${escapeHtml(courseText)}</span>`
          : '';
        const fieldLine = field ? `<span class="presence-field">${escapeHtml(field)}</span>` : '';
        return `<div class="presence-user ${escapeAttr(badgeType)}">
          <div class="presence-user-head">
            <b>${escapeHtml(name)}</b>
            <span class="presence-badge ${escapeAttr(badgeType)}">${escapeHtml(presenceActivityLabel(activity))}</span>
          </div>
          <span class="presence-action">${escapeHtml(actionText)}</span>
          ${courseLine}
          ${fieldLine}
          <span class="presence-meta">${escapeHtml(meta || describePresenceAction(u))}</span>
        </div>`;
      }).join('')}
    </div>
  `).join('')}`;
}

function closePresencePopover() {
  document.getElementById('presencePopover')?.classList.remove('show');
  document.getElementById('presenceIndicator')?.setAttribute('aria-expanded', 'false');
}

function togglePresencePopover(event) {
  event?.stopPropagation?.();
  const pop = document.getElementById('presencePopover');
  if (!pop || !latestPresenceUsers.length) return;
  renderPresencePopover();
  pop.classList.toggle('show');
  document.getElementById('presenceIndicator')?.setAttribute('aria-expanded', pop.classList.contains('show') ? 'true' : 'false');
}

async function pingPresence() {
  if (authExpired) return;
  if (!DEPT_ID || !TERM_ID || !currentUser) return;
  if (presencePingInFlight) {
    presencePingQueued = true;
    return;
  }
  presencePingInFlight = true;
  try {
    const res = await apiFetch(`${API_BASE}/api/presence`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(currentPresencePayload()),
    });
    if (!res.ok) return;
    const data = await res.json();
    renderPresenceIndicator(data.users || []);
  } catch(e) {
  } finally {
    presencePingInFlight = false;
    if (presencePingQueued && !authExpired) {
      presencePingQueued = false;
      setTimeout(pingPresence, 50);
    }
  }
}

function startPresence() {
  if (presenceTimer || !DEPT_ID || !TERM_ID || !currentUser) return;
  pingPresence();
  presenceTimer = setInterval(pingPresence, 15000);
}

function debounce(fn, delay = 180) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function markUserEditing(ms = 12000) {
  userEditingUntil = Date.now() + ms;
}

function isUserEditing() {
  if (Date.now() < userEditingUntil) return true;
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const modalOpen = visibleAppModals().length > 0;
  return modalOpen || Boolean(el.closest('input, textarea, select, [contenteditable="true"], .multi-select.open'));
}

function renderScheduleFromFilter() {
  schedulePage = 1;
  renderSchedule();
}

function setLifecycleFilter(status) {
  const el = document.getElementById('filterLifecycle');
  if (!el) return;
  el.value = status;
  renderScheduleFromFilter();
}

function clearMultiSelect(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el._selected = [];
  el.querySelectorAll('.ms-dropdown input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  renderMultiSelectTrigger(el);
}

function clearScheduleFilters() {
  ['filterSeason', 'filterPeriod', 'filterCampus', 'filterSubject', 'filterTeacher', 'filterSlot', 'filterDesc'].forEach(clearMultiSelect);
  const search = document.getElementById('filterSearch');
  if (search) search.value = '';
  const lifecycle = document.getElementById('filterLifecycle');
  if (lifecycle) lifecycle.value = '';
  const conflictOnly = document.getElementById('filterConflictOnly');
  if (conflictOnly) conflictOnly.checked = false;
  const changedOnly = document.getElementById('filterChangedOnly');
  if (changedOnly) changedOnly.checked = false;
}

function setScheduleQuickFilter(type) {
  clearScheduleFilters();
  const lifecycle = document.getElementById('filterLifecycle');
  const conflictOnly = document.getElementById('filterConflictOnly');
  const changedOnly = document.getElementById('filterChangedOnly');
  if (type === 'conflict') {
    if (conflictOnly) conflictOnly.checked = true;
  } else if (type === 'changed') {
    if (!isOriginalReady()) {
      showToast('正在加载原始对比数据，稍后显示已修改项');
      loadOriginalDataInBackground({render: true});
    }
    if (changedOnly) changedOnly.checked = true;
  } else if (type !== 'all') {
    if (lifecycle) lifecycle.value = type;
  }
  renderScheduleFromFilter();
}

const debouncedRenderScheduleFromFilter = debounce(renderScheduleFromFilter, 180);
const debouncedRenderCapacity = debounce(renderCapacity, 180);
const debouncedRenderClassroomBoard = debounce(renderClassroomBoard, 180);
const debouncedRenderConflicts = debounce(renderConflicts, 180);
const debouncedRenderHeatmap = debounce(renderHeatmap, 180);

async function loadData(silent, options = {}) {
  try {
    if (authExpired) return;
    if (silent && isUserEditing()) return;
    let version = null;
    if (silent) {
      const versionRes = await apiFetch(`${API_BASE}/api/version`);
      if (versionRes.ok) {
        version = await versionRes.json();
        if (loadedVersion && normalizeDataVersion(version.version) === loadedVersion) {
          if (!isOriginalReady()) loadOriginalDataInBackground({render: options.render !== false});
          return;
        }
      }
    }
    const courseResult = await fetchCachedText(`${API_BASE}/api/courses`, 'courses');
    applyResponseVersion(courseResult.res);
    const text1 = courseResult.text;
    if (!text1.startsWith('[') && !text1.startsWith('{')) throw new Error('not json');
    const coursePayload = JSON.parse(text1);
    if (Array.isArray(coursePayload)) {
      courses = coursePayload;
      relatedRoomCourses = [];
      relatedRooms = {};
    } else {
      courses = coursePayload.courses || [];
      relatedRoomCourses = coursePayload.related_room_courses || [];
      relatedRooms = coursePayload.related_rooms || {};
    }
    if (!isOriginalReady()) resetOriginalData();
    const activeCoursesForOptions = courses.filter(isActiveCourse);
    allTeachers = [...new Set(activeCoursesForOptions.filter(c=>c.teacher).map(c=>c.teacher))].sort();
    allCampuses = [...new Set(activeCoursesForOptions.map(c=>c.campus).filter(Boolean))].sort();
    allSubjects = [...new Set(activeCoursesForOptions.filter(c=>c.subject).map(c=>c.subject))].sort();
    if (!loadedVersion && version) setLoadedVersion(version.version);
    markCourseDataChanged();
    initFilters();
    const activeCourseList = courses.filter(isActiveCourse);
    document.getElementById('totalClasses').textContent = activeCourseList.length;
    document.getElementById('totalTeachers').textContent = [...new Set(activeCourseList.filter(c=>c.teacher).map(c=>c.teacher))].length;
    document.getElementById('totalCampuses').textContent = [...new Set(activeCourseList.map(c=>c.campus).filter(Boolean))].length;
    if (options.render !== false) renderAll();
    loadOriginalDataInBackground({render: options.render !== false});
  } catch(e) { if (!silent) showToast('加载失败，请检查网络'); }
}

function initFilters() {
  const lifecycle = document.getElementById('filterLifecycle')?.value || '';
  const optionCourses = lifecycle
    ? courses.filter(c => courseLifecycleStatus(c) === lifecycle)
    : courses.filter(isActiveCourse);
  populateMultiSelect('filterSeason', [...new Set(optionCourses.map(c=>c.season).filter(Boolean))].sort(), debouncedRenderScheduleFromFilter);
  populateMultiSelect('filterPeriod', ['1期','2期','3期','周五','周六','周日'], debouncedRenderScheduleFromFilter);
  populateMultiSelect('filterCampus', [...new Set(optionCourses.map(c=>c.campus).filter(Boolean))].sort(), debouncedRenderScheduleFromFilter);
  populateMultiSelect('filterSubject', [...new Set(optionCourses.filter(c=>c.subject).map(c=>c.subject))].sort(), debouncedRenderScheduleFromFilter);
  populateMultiSelect('filterTeacher', [...new Set(optionCourses.filter(c=>c.teacher).map(c=>c.teacher))].sort(), debouncedRenderScheduleFromFilter);
  populateMultiSelect('filterSlot', ['A','B','C','D','E'], debouncedRenderScheduleFromFilter);
  populateMultiSelect('filterDesc', [...new Set(optionCourses.filter(c=>c.desc).map(c=>getDescType(c.desc)))].sort(), debouncedRenderScheduleFromFilter);
  populateSelect('capSubject', allSubjects);
  populateSelect('capCampus', allCampuses);
  populateSelect('roomCampus', currentUser && currentUser.role === 'store_manager' && currentUser.campus ? [currentUser.campus] : allCampuses);
  populateSelect('roomSeason', [...new Set(courses.filter(isActiveCourse).map(c=>c.season).filter(Boolean))].sort());
  refreshRoomPeriodOptions();
}

function getPeriodsForSeason(season) {
  if (season === '暑假') return SUMMER_PERIODS;
  if (season === '秋季') return AUTUMN_PERIODS;
  return [...SUMMER_PERIODS, ...AUTUMN_PERIODS];
}

function refreshRoomPeriodOptions() {
  const season = document.getElementById('roomSeason')?.value || '';
  const period = document.getElementById('roomPeriod');
  if (!period) return;
  const cur = period.value;
  const options = getPeriodsForSeason(season);
  period.innerHTML = '<option value="">全部</option>' + options.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('');
  period.value = options.includes(cur) ? cur : '';
}

function getDescType(desc) {
  if (!desc) return '';
  if (desc.includes('续班')) return '续班';
  if (desc.includes('新增班')) return '新增班';
  if (desc.includes('预设班未开通')) return '预设班(未开通)';
  if (desc.includes('预设班')) return '预设班';
  return desc;
}

function renderDescTag(desc) {
  const type = getDescType(desc);
  if (!type) return '';
  if (type === '续班') return '<span class="desc-tag renew">续班</span>';
  if (type === '新增班') return '<span class="desc-tag new-class">新增班</span>';
  if (type === '预设班(未开通)') return '<span class="desc-tag preset-inactive">预设班</span>';
  if (type === '预设班') return '<span class="desc-tag preset">预设班</span>';
  return '<span class="desc-tag">' + escapeHtml(type) + '</span>';
}
function populateSelect(id, opts) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('multi-select')) {
    populateMultiSelect(id, opts);
    return;
  }
  const nextSignature = JSON.stringify(opts);
  if (el._optionsSignature === nextSignature) return;
  el._optionsSignature = nextSignature;
  const cur = el.value;
  while(el.options.length > 1) el.remove(1);
  opts.forEach(o => { const op = document.createElement('option'); op.value=o; op.textContent=o; el.appendChild(op); });
  el.value = cur;
}

const PINYIN_BOUNDARIES = [
  ['a', '阿'], ['b', '芭'], ['c', '擦'], ['d', '搭'], ['e', '蛾'],
  ['f', '发'], ['g', '噶'], ['h', '哈'], ['j', '击'], ['k', '喀'],
  ['l', '垃'], ['m', '妈'], ['n', '拿'], ['o', '哦'], ['p', '啪'],
  ['q', '七'], ['r', '然'], ['s', '撒'], ['t', '塌'], ['w', '挖'],
  ['x', '昔'], ['y', '压'], ['z', '匝'],
];
const pinyinCollator = typeof Intl !== 'undefined' && Intl.Collator
  ? new Intl.Collator('zh-Hans-CN-u-co-pinyin')
  : null;

function pinyinInitialForChar(ch) {
  const text = String(ch || '');
  if (!text) return '';
  if (/^[a-z]$/i.test(text)) return text.toLowerCase();
  if (/^[0-9]$/.test(text)) return text;
  if (!pinyinCollator) return '';
  let initial = '';
  for (const [letter, boundary] of PINYIN_BOUNDARIES) {
    if (pinyinCollator.compare(text, boundary) >= 0) initial = letter;
    else break;
  }
  return initial;
}

function pinyinInitials(text) {
  return [...String(text || '')].map(pinyinInitialForChar).join('');
}

function normalizeSearchText(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, '');
}

function optionMatchesSearch(option, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const text = String(option || '');
  const normalizedText = normalizeSearchText(text);
  if (normalizedText.startsWith(q) || normalizedText.includes(q)) return true;
  const initials = pinyinInitials(text);
  return initials.startsWith(q) || initials.includes(q);
}

function populateMultiSelect(id, opts, onChange) {
  const container = document.getElementById(id);
  if (!container) return;
  const selected = container._selected || [];
  const searchable = container.dataset.searchable === '1';
  if (onChange) container._onChange = onChange;

  let trigger = container.querySelector('.ms-trigger');
  let dropdown = container.querySelector('.ms-dropdown');
  let searchInput = container.querySelector('.ms-search');
  let optionsBox = container.querySelector('.ms-options');
  if (!trigger) {
    trigger = document.createElement('div');
    trigger.className = 'ms-trigger';
    container.appendChild(trigger);
    dropdown = document.createElement('div');
    dropdown.className = 'ms-dropdown';
    container.appendChild(dropdown);
    if (searchable) {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'ms-search-wrap';
      searchInput = document.createElement('input');
      searchInput.className = 'ms-search';
      searchInput.type = 'text';
      searchInput.placeholder = container.dataset.searchPlaceholder || '输入关键词搜索';
      searchWrap.appendChild(searchInput);
      dropdown.appendChild(searchWrap);
    }
    optionsBox = document.createElement('div');
    optionsBox.className = 'ms-options';
    dropdown.appendChild(optionsBox);

    trigger.addEventListener('click', (e) => {
      if (e.target.classList.contains('ms-remove')) return;
      document.querySelectorAll('.multi-select.open').forEach(ms => { if (ms !== container) ms.classList.remove('open'); });
      container.classList.toggle('open');
      if (container.classList.contains('open') && searchInput) {
        setTimeout(() => searchInput.focus(), 0);
      }
      e.stopPropagation();
    });
    dropdown.addEventListener('click', e => e.stopPropagation());
    if (searchInput) {
      searchInput.addEventListener('input', () => renderMultiSelectOptions(container));
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          container.classList.remove('open');
          trigger.focus?.();
        }
      });
    }
  }

  const nextSignature = JSON.stringify(opts);
  const normalizedSelected = selected.filter(s => opts.includes(s));
  const selectedChanged = normalizedSelected.length !== selected.length;
  if (container._optionsSignature === nextSignature && !selectedChanged) {
    renderMultiSelectTrigger(container);
    renderMultiSelectOptions(container);
    return;
  }
  container._optionsSignature = nextSignature;
  container._selected = normalizedSelected;
  container._options = opts;

  renderMultiSelectOptions(container);
  renderMultiSelectTrigger(container);
}

function renderMultiSelectOptions(container) {
  const optionsBox = container.querySelector('.ms-options');
  if (!optionsBox) return;
  const opts = container._options || [];
  const selected = container._selected || [];
  const query = container.querySelector('.ms-search')?.value || '';
  const visible = opts.filter(o => optionMatchesSearch(o, query));
  optionsBox.innerHTML = visible.length ? visible.map(o => {
    const checked = selected.includes(o) ? 'checked' : '';
    const initials = pinyinInitials(o);
    return `<label title="${escapeAttr(initials)}"><input type="checkbox" value="${escapeAttr(o)}" ${checked}><span>${escapeHtml(o)}</span></label>`;
  }).join('') : '<div class="ms-empty">没有匹配项</div>';

  optionsBox.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      markUserEditing(4000);
      const val = cb.value;
      if (cb.checked) {
        if (!container._selected) container._selected = [];
        if (!container._selected.includes(val)) container._selected.push(val);
      } else {
        container._selected = (container._selected || []).filter(v => v !== val);
      }
      renderMultiSelectTrigger(container);
      (container._onChange || renderSchedule)();
    });
  });
}

function renderMultiSelectTrigger(container) {
  const trigger = container.querySelector('.ms-trigger');
  const selected = container._selected || [];
  const placeholder = container.dataset.placeholder || '全部';
  if (selected.length === 0) {
    trigger.innerHTML = `<span class="ms-placeholder">${escapeHtml(placeholder)}</span>`;
  } else {
    trigger.innerHTML = selected.map(s => `<span class="ms-tag">${escapeHtml(s)}<span class="ms-remove" data-val="${escapeAttr(s)}">&times;</span></span>`).join('');
  }
  trigger.querySelectorAll('.ms-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = btn.dataset.val;
      container._selected = (container._selected || []).filter(v => v !== val);
      const cb = container.querySelector(`.ms-dropdown input[value="${escapeSelectorValue(val)}"]`);
      if (cb) cb.checked = false;
      renderMultiSelectTrigger(container);
      renderMultiSelectOptions(container);
      (container._onChange || renderSchedule)();
    });
  });
}

function getMultiSelectValues(id) {
  const el = document.getElementById(id);
  return el._selected || [];
}

function isChanged(c) {
  if (isInsertedCourse(c)) return true;
  if (!isOriginalReady()) return false;
  const orig = getOriginal(c);
  if (!orig) return false;
  const fields = [
    'teacher', 'slot', 'room', 'period', 'classType', 'currentCount',
    'lifecycle_status', 'lifecycle_reason', 'lifecycle_at', 'lifecycle_by',
    'merged_into_code',
  ];
  if (fields.some(field => String(c[field] ?? '') !== String(orig[field] ?? ''))) return true;
  return JSON.stringify(c.merge_sources || []) !== JSON.stringify(orig.merge_sources || []);
}
function isInsertedCourse(c) {
  return c && (c.desc === '插空新增' || c.created_by_action === 'insert_course');
}
function courseLifecycleStatus(c) {
  return (c && (c.lifecycle_status || c.course_status)) || 'active';
}
function isActiveCourse(c) {
  return !['cancelled', 'merged'].includes(courseLifecycleStatus(c));
}
function lifecycleLabel(c) {
  const status = courseLifecycleStatus(c);
  if (status === 'cancelled') return '已取消';
  if (status === 'merged') return c.merged_into_code ? `已合并至 ${c.merged_into_code}` : '已合并';
  return '';
}
function renderLifecycleTag(c) {
  const label = lifecycleLabel(c);
  if (!label) return '';
  const status = courseLifecycleStatus(c);
  const cls = status === 'cancelled' ? 'cancelled' : 'merged';
  const parts = [
    c.lifecycle_reason ? `原因：${c.lifecycle_reason}` : '',
    c.lifecycle_at ? `时间：${c.lifecycle_at}` : '',
    c.lifecycle_by ? `操作人：${c.lifecycle_by}` : '',
    c.merged_into_code ? `目标班：${c.merged_into_code} ${c.merged_into_name || ''}` : '',
  ].filter(Boolean);
  const title = parts.join('\n');
  return `<button type="button" class="desc-tag ${cls}" title="${escapeAttr(title)}" data-schedule-action="lifecycle-detail" data-id="${escapeAttr(c.id)}">${escapeHtml(label)}</button>`;
}
function showLifecycleDetail(id) {
  const course = findCourse(id);
  if (!course) return;
  const label = lifecycleLabel(course);
  if (!label) return;
  const rows = [
    ['状态', label],
    ['原因', course.lifecycle_reason || '未填写'],
    ['时间', course.lifecycle_at || ''],
    ['操作人', course.lifecycle_by || ''],
    ['目标班', course.merged_into_code ? `${course.merged_into_code} ${course.merged_into_name || ''}` : ''],
  ].filter(row => row[1]);
  openDetailModal('班级状态明细', rows);
}
function renderMergeSourcesTag(c) {
  const sources = Array.isArray(c?.merge_sources) ? c.merge_sources : [];
  if (!sources.length) return '';
  const title = sources.map(s => {
    const name = [s.code, s.name].filter(Boolean).join(' ');
    const count = s.currentCount ? ` ${s.currentCount}人` : '';
    const reason = s.reason ? ` 原因：${s.reason}` : '';
    return `${name}${count}${reason}`.trim();
  }).filter(Boolean).join('\n');
  return `<button type="button" class="desc-tag absorbed" title="${escapeAttr(title)}" data-schedule-action="merge-sources" data-id="${escapeAttr(c.id)}">已吸收 ${sources.length} 班</button>`;
}
function showMergeSources(id) {
  const course = findCourse(id);
  const sources = Array.isArray(course?.merge_sources) ? course.merge_sources : [];
  if (!sources.length) {
    showToast('暂无合并来源');
    return;
  }
  const rows = sources.map((s, idx) => {
    const name = [s.code, s.name].filter(Boolean).join(' ') || `来源班 ${idx + 1}`;
    const meta = [
      s.currentCount ? `${s.currentCount}人` : '人数未填',
      s.merged_at || '',
      s.reason ? `原因：${s.reason}` : '',
    ].filter(Boolean).join(' · ');
    return [`来源 ${idx + 1}`, `${name}${meta ? '\n' + meta : ''}`];
  });
  openDetailModal(`已吸收 ${sources.length} 个班级`, rows);
}
function courseRecordTitle(c) {
  return [c?.code, c?.name].filter(Boolean).join(' ') || `班级 ${c?.id ?? ''}`;
}
function courseRecordMeta(c) {
  return [
    shortCampus(c?.campus || ''),
    getActualGrade(c || {}),
    c?.subject || '',
    c?.classType ? `${c.classType}班型` : '',
    c?.period && c?.slot ? `${c.period}${c.slot}` : (c?.period || c?.slot || ''),
  ].filter(Boolean).join(' · ');
}
function lifecycleRecordSearchText(c) {
  return [
    courseRecordTitle(c),
    courseRecordMeta(c),
    c.lifecycle_reason,
    c.lifecycle_by,
    c.lifecycle_at,
    c.merged_into_code,
    c.merged_into_name,
    ...(Array.isArray(c.merge_sources) ? c.merge_sources.map(s => [s.code, s.name, s.reason, s.merged_by].filter(Boolean).join(' ')) : []),
  ].filter(Boolean).join(' ').toLowerCase();
}
function renderRecordChip(text, cls = '') {
  return text ? `<span class="lifecycle-record-chip ${cls}">${escapeHtml(text)}</span>` : '';
}
function countText(value) {
  const n = parseCourseCount(value);
  return n === null ? '人数未填' : `${n}人`;
}
function courseLessonKind(course) {
  const text = [
    course?.classKind,
    course?.class_type,
    course?.desc,
    course?.name,
    course?.room,
    course?.capacity,
  ].filter(Boolean).join(' ');
  const capacity = parseCourseCount(course?.capacity);
  if (text.includes('小组') || capacity === 6) return '小组';
  if (text.includes('素养') || capacity === 20) return '素养';
  return '';
}
function lowEnrollmentInfo(course) {
  const kind = courseLessonKind(course);
  const threshold = kind === '素养' ? 12 : (kind === '小组' ? 5 : null);
  const count = parseCourseCount(course?.currentCount);
  if (!kind || threshold === null || count === null) return null;
  return {kind, threshold, count, low: count < threshold};
}
function cancelSuiteContext(course) {
  if (!course || !SUITE_SUBJECTS.includes(courseSubject(course))) return [];
  return courses
    .filter(c => isActiveCourse(c) && String(c.id) !== String(course.id))
    .filter(c => courseSuiteCompatible(course, c))
    .sort((a, b) => (
      (SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)) ||
      (SUITE_SUBJECTS.indexOf(courseSubject(a)) - SUITE_SUBJECTS.indexOf(courseSubject(b))) ||
      courseLabel(a).localeCompare(courseLabel(b), 'zh-Hans-CN')
    ));
}
function renderCancelCourseReview(course) {
  const low = lowEnrollmentInfo(course);
  const suite = cancelSuiteContext(course);
  const suiteSubjects = [...new Set([courseSubject(course), ...suite.map(courseSubject)].filter(Boolean))];
  const sameSlotSuite = suite.filter(c => c.slot === course.slot);
  const nearbySuite = suite.filter(c => c.slot !== course.slot);
  const lowClass = !low ? 'warn' : (low.low ? 'good' : 'bad');
  const lowText = !low
    ? '无法识别素养/小组或人数，需主管人工确认。'
    : (low.low
      ? `${low.kind}${low.count}/${low.threshold}人，符合低人数兜底复核条件。`
      : `${low.kind}${low.count}/${low.threshold}人，未低于建议保留线，不建议直接取消。`);
  const suiteClass = suiteSubjects.length >= 3 ? 'good' : (suiteSubjects.length >= 2 ? 'warn' : 'bad');
  const suiteText = suite.length
    ? `同校区同年级可关联 ${suite.length} 门套班课，覆盖 ${suiteSubjects.join('、')}。`
    : '未找到可关联套班课，取消后需确认是否影响招生组合。';
  const sameSlotText = sameSlotSuite.length
    ? `同一时段还有 ${sameSlotSuite.map(c => courseSubject(c) + (courseBand(c) || '')).join('、')}，取消可能改变该时段组合。`
    : '同一时段没有识别到其他套班课。';
  const suiteRows = suite.slice(0, 8).map(c => `
    <div class="cancel-review-suite-row">
      <b>${escapeHtml(courseSubject(c) || '-')} ${escapeHtml(courseBand(c) || '')}</b>
      <span>${escapeHtml(courseLabel(c))}</span>
      <em>${escapeHtml(c.slot || '-')}段</em>
    </div>
  `).join('');
  const extraSuite = suite.length > 8
    ? `<div class="cancel-review-suite-row"><b>更多</b><span>另有 ${escapeHtml(suite.length - 8)} 门相关套班课未展开</span><em>需复核</em></div>`
    : '';
  return `
    <div class="cancel-review-panel">
      <div class="cancel-review-main">
        <b>${escapeHtml(courseRecordTitle(course))}</b>
        <span>${escapeHtml(courseRecordMeta(course))} · ${escapeHtml(countText(course.currentCount))}</span>
      </div>
      <div class="cancel-review-kpis">
        <div class="cancel-review-kpi"><b>${escapeHtml(low?.count ?? '-')}</b><span>当前人数</span></div>
        <div class="cancel-review-kpi"><b>${escapeHtml(low?.threshold ?? '-')}</b><span>保留线</span></div>
        <div class="cancel-review-kpi"><b>${escapeHtml(suiteSubjects.length || '-')}</b><span>关联科目</span></div>
      </div>
      <div class="cancel-review-checks">
        <div class="cancel-review-check ${lowClass}"><b>低人数兜底</b><span>${escapeHtml(lowText)}</span></div>
        <div class="cancel-review-check ${suiteClass}"><b>套班完整度</b><span>${escapeHtml(suiteText)}</span></div>
        <div class="cancel-review-check warn"><b>同段影响</b><span>${escapeHtml(sameSlotText)}</span></div>
        <div class="cancel-review-check warn"><b>排课影响</b><span>取消后该班不再参与产能、教室占用和冲突检测；如还有招生可能，建议优先评估合并班。</span></div>
      </div>
      <div class="cancel-review-suite">
        <div class="cancel-review-suite-title">相关套班课</div>
        <div class="cancel-review-suite-list">${suiteRows || '<div class="cancel-review-suite-row"><b>暂无</b><span>未识别到同校区同年级套班课</span><em>需确认</em></div>'}${extraSuite}</div>
      </div>
      <div class="cancel-review-note">系统只做兜底风险复核，不会自动判断是否应取消。主管需要确认招生集中、家长沟通、结转影响，以及是否存在同年级同班型合并方案。</div>
    </div>
  `;
}
function mergeCountPreview(c) {
  const sourceCount = parseCourseCount(c.currentCount);
  const target = c.merged_into_id !== undefined && c.merged_into_id !== null ? findCourse(c.merged_into_id) : null;
  const targetCount = parseCourseCount(target?.currentCount);
  if (sourceCount === null) return '来源人数未填';
  if (c.merged_count_added && targetCount !== null) {
    return `来源 ${sourceCount} 人已计入目标班，目标现 ${targetCount} 人`;
  }
  if (c.merged_count_added) return `来源 ${sourceCount} 人已计入目标班`;
  return `来源 ${sourceCount} 人，目标班人数未自动累加`;
}
function renderLifecycleRecordCard(c, status) {
  const sourceTitle = courseRecordTitle(c);
  const meta = courseRecordMeta(c);
  const reason = c.lifecycle_reason || '未填写原因';
  const chips = [
    renderRecordChip(countText(c.currentCount)),
    renderRecordChip(c.lifecycle_by ? `操作人 ${c.lifecycle_by}` : ''),
    renderRecordChip(c.lifecycle_reason ? '有原因' : '未填原因', c.lifecycle_reason ? '' : 'warn'),
  ].join('');
  const flow = status === 'merged' ? `
    <div class="lifecycle-record-flow">
      <div class="lifecycle-record-node">
        <b>${escapeHtml(sourceTitle)}</b>
        <span>${escapeHtml([meta, countText(c.currentCount)].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="lifecycle-record-arrow">→</div>
      <div class="lifecycle-record-node">
        <b>${escapeHtml([c.merged_into_code, c.merged_into_name].filter(Boolean).join(' ') || '目标班未记录')}</b>
        <span>${escapeHtml(mergeCountPreview(c))}</span>
      </div>
    </div>
  ` : `
    <div class="lifecycle-record-flow">
      <div class="lifecycle-record-node">
        <b>${escapeHtml(sourceTitle)}</b>
        <span>${escapeHtml([meta, countText(c.currentCount)].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="lifecycle-record-arrow">×</div>
      <div class="lifecycle-record-node">
        <b>不再参与排课</b>
        <span>不计入产能、教室占用和冲突检测</span>
      </div>
    </div>
  `;
  return `<div class="lifecycle-record-card ${escapeAttr(status)}" data-lifecycle-record-card="1" data-search="${escapeAttr(lifecycleRecordSearchText(c))}">
    <div class="lifecycle-record-head">
      <div class="lifecycle-record-title">${escapeHtml(sourceTitle)}</div>
      <div class="lifecycle-record-time">${escapeHtml(c.lifecycle_at || '时间未记录')}</div>
    </div>
    <div class="lifecycle-record-meta">${chips}</div>
    ${flow}
    <div class="lifecycle-record-reason">原因：${escapeHtml(reason)}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:8px;">
      <button type="button" class="btn" style="padding:3px 8px;font-size:11px;background:#f8fafc;color:#334155;" data-app-action="show-lifecycle-detail" data-id="${escapeAttr(c.id)}">查看明细</button>
    </div>
  </div>`;
}
function renderLifecycleRecordsList(status, query = '') {
  const listEl = document.getElementById('lifecycleRecordsList');
  const countEl = document.getElementById('lifecycleRecordsFilteredCount');
  if (!listEl) return;
  const q = String(query || '').trim().toLowerCase();
  const records = courses
    .filter(c => courseLifecycleStatus(c) === status)
    .sort((a, b) => String(b.lifecycle_at || '').localeCompare(String(a.lifecycle_at || '')));
  const filtered = q ? records.filter(c => lifecycleRecordSearchText(c).includes(q)) : records;
  if (countEl) countEl.textContent = `${filtered.length}/${records.length}`;
  listEl.innerHTML = filtered.length
    ? filtered.slice(0, 120).map(c => renderLifecycleRecordCard(c, status)).join('')
    : '<div class="lifecycle-record-empty">当前条件下暂无记录</div>';
}
function showLifecycleRecords(status) {
  const label = status === 'cancelled' ? '取消班记录' : '合并班记录';
  const records = courses
    .filter(c => courseLifecycleStatus(c) === status)
    .sort((a, b) => String(b.lifecycle_at || '').localeCompare(String(a.lifecycle_at || '')))
    .slice(0, 500);
  const modal = document.getElementById('lifecycleRecordsModal');
  const titleEl = document.getElementById('lifecycleRecordsTitle');
  const bodyEl = document.getElementById('lifecycleRecordsBody');
  if (!modal || !titleEl || !bodyEl) return;
  const withReason = records.filter(c => c.lifecycle_reason).length;
  const totalCount = records.reduce((sum, c) => sum + (parseCourseCount(c.currentCount) || 0), 0);
  const mergedTargets = status === 'merged'
    ? new Set(records.map(c => c.merged_into_code).filter(Boolean)).size
    : 0;
  titleEl.textContent = label;
  bodyEl.innerHTML = `
    <div class="lifecycle-record-summary">
      <div class="metric"><b>${escapeHtml(records.length)}</b><span>${escapeHtml(label)}</span></div>
      <div class="metric"><b>${escapeHtml(totalCount || '-')}</b><span>${status === 'merged' ? '涉及来源人数' : '取消班人数'}</span></div>
      <div class="metric"><b>${escapeHtml(status === 'merged' ? mergedTargets : withReason)}</b><span>${status === 'merged' ? '目标班数' : '已填原因'}</span></div>
    </div>
    <div class="lifecycle-record-tools">
      <input id="lifecycleRecordsSearch" type="text" placeholder="搜索班级、校区、科目、原因、操作人...">
      <span style="color:#64748b;font-size:12px;">显示 <b id="lifecycleRecordsFilteredCount">${records.length}/${records.length}</b></span>
    </div>
    <div id="lifecycleRecordsList" class="lifecycle-record-list"></div>
  `;
  showAppModal('lifecycleRecordsModal', '#lifecycleRecordsSearch');
  renderLifecycleRecordsList(status);
  const search = document.getElementById('lifecycleRecordsSearch');
  if (search) {
    search.dataset.lifecycleStatus = status;
    search.addEventListener('input', () => renderLifecycleRecordsList(status, search.value));
  }
}
function openDetailModal(title, rows) {
  const modal = document.getElementById('detailModal');
  const titleEl = document.getElementById('detailModalTitle');
  const bodyEl = document.getElementById('detailModalBody');
  if (!modal || !titleEl || !bodyEl) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = rows.map(([label, value]) => `
    <div class="detail-row">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${escapeHtml(value).replace(/\n/g, '<br>')}</div>
    </div>
  `).join('');
  showAppModal('detailModal', '[data-app-action="close-detail"]');
}
function closeDetailModal() {
  hideAppModal('detailModal');
}
function closeLifecycleRecordsModal() {
  hideAppModal('lifecycleRecordsModal');
}
function fieldChanged(c, field) {
  if (!isOriginalReady()) return false;
  const orig = getOriginal(c);
  if (!orig) return false;
  return (c[field]||'') !== (orig[field]||'');
}

function getClassLetter(name) {
  name = String(name || '');
  const m = name.match(/\d级([A-C])/);
  if (m) return m[1];
  const m2 = name.match(/(?:双语|益智|实践|科学|博文)(?:素养)?([A-C])/);
  if (m2) return m2[1];
  const m3 = name.match(/素养([A-C])/);
  if (m3) return m3[1];
  const m4 = name.match(/([A-C])(?:暑假|秋季|班)/);
  if (m4) return m4[1];
  return '';
}

function detectConflicts() {
  const map = {};
  courses.forEach(c => {
    if (!isActiveCourse(c)) return;
    if (!c.teacher || !c.slot) return;
    const key = `${c.teacher}|${c.season}|${c.period}|${c.slot}|${c.day||''}`;
    if (!map[key]) map[key] = [];
    map[key].push(c);
  });
  courses.forEach(c => { c._conflict = false; c._conflictWith = []; });
  let count = 0;
  Object.values(map).forEach(group => {
    if (group.length > 1) {
      count++;
      group.forEach(c => {
        c._conflict = true;
        c._conflictWith = group.filter(x=>x.id!==c.id).map(x=>x.name+' @ '+x.campus);
      });
    }
  });
  return count;
}
function refreshConflictCache() {
  cachedConflictCount = detectConflicts();
  return cachedConflictCount;
}

function renderAll() {
  updateEditLockUI();
  renderSchedule();
  if (!document.getElementById('tab-overview').classList.contains('hidden')) renderOverview();
  if (!document.getElementById('tab-capacity').classList.contains('hidden')) renderCapacity();
  if (document.getElementById('tab-classrooms') && !document.getElementById('tab-classrooms').classList.contains('hidden')) renderClassroomBoard();
  if (!document.getElementById('tab-conflicts').classList.contains('hidden')) renderConflicts();
  if (document.getElementById('tab-heatmap') && !document.getElementById('tab-heatmap').classList.contains('hidden')) renderHeatmap();
}

function renderSchedule() {
  const seasons = getMultiSelectValues('filterSeason');
  const periods = getMultiSelectValues('filterPeriod');
  const campuses = getMultiSelectValues('filterCampus');
  const subjects = getMultiSelectValues('filterSubject');
  const teachers = getMultiSelectValues('filterTeacher');
  const slots = getMultiSelectValues('filterSlot');
  const search = document.getElementById('filterSearch').value.toLowerCase();
  const descFilters = getMultiSelectValues('filterDesc');
  const lifecycleFilter = document.getElementById('filterLifecycle')?.value || '';
  const conflictOnly = document.getElementById('filterConflictOnly').checked;
  let changedOnly = document.getElementById('filterChangedOnly').checked;
  const editable = canEditNow();
  if (changedOnly && !isOriginalReady()) {
    changedOnly = false;
    loadOriginalDataInBackground({render: true});
  }

  const changedCount = courses.filter(c => isChanged(c)).length;
  document.getElementById('cardConflicts').textContent = cachedConflictCount;
  const activeCourseList = courses.filter(isActiveCourse);
  document.getElementById('cardTotal').textContent = activeCourseList.length;
  document.getElementById('cardAssigned').textContent = activeCourseList.filter(c=>c.teacher).length;
  document.getElementById('cardUnassigned').textContent = activeCourseList.filter(c=>!c.teacher).length;
  document.getElementById('cardChanged').textContent = changedCount;
  document.getElementById('cardCancelled').textContent = courses.filter(c => courseLifecycleStatus(c) === 'cancelled').length;
  document.getElementById('cardMerged').textContent = courses.filter(c => courseLifecycleStatus(c) === 'merged').length;

  let filtered = courses.filter(c => {
    if (seasons.length && !seasons.includes(c.season)) return false;
    if (periods.length && !periods.includes(c.period)) return false;
    if (campuses.length && !campuses.includes(c.campus)) return false;
    if (subjects.length && !subjects.includes(c.subject)) return false;
    if (teachers.length && !teachers.includes(c.teacher)) return false;
    if (slots.length && !slots.includes(c.slot)) return false;
    if (descFilters.length && !descFilters.includes(getDescType(c.desc))) return false;
    if (lifecycleFilter && courseLifecycleStatus(c) !== lifecycleFilter) return false;
    if (search && !(c.name||'').toLowerCase().includes(search) && !(c.code||'').toLowerCase().includes(search)) return false;
    if (conflictOnly && !c._conflict) return false;
    if (changedOnly && !isChanged(c)) return false;
    return true;
  });
  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / SCHEDULE_PAGE_SIZE));
  if (schedulePage > totalPages) schedulePage = totalPages;
  const start = (schedulePage - 1) * SCHEDULE_PAGE_SIZE;
  filtered = filtered.slice(start, start + SCHEDULE_PAGE_SIZE);
  currentSchedulePageIds = filtered.filter(isActiveCourse).map(c => String(c.id));

  const tbody = document.getElementById('scheduleBody');
  tbody.innerHTML = filtered.map(c => {
    const selected = selectedCourseIds.has(String(c.id));
    let conflictMark = '';
    if (c._conflict) {
      const conflictDetail = c._conflictWith.map(w => `<div style="padding:2px 0;">• ${escapeHtml(w)}</div>`).join('');
      conflictMark = `<button type="button" class="conflict-icon" data-schedule-action="toggle-conflict" title="查看冲突明细">⚠</button><div class="conflict-popup hidden"><div style="font-weight:600;margin-bottom:4px;color:#d32f2f;">与以下班级时间冲撞:</div>${conflictDetail}<div style="margin-top:6px;font-size:10px;color:#888;">点击⚠关闭</div></div>`;
    }
    const inactive = !isActiveCourse(c);
    const rowClass = [c._conflict ? 'conflict' : '', inactive ? 'inactive-course' : ''].filter(Boolean).join(' ');
    const slotOpts = ['','A','B','C','D','E'].map(s=>`<option value="${s}" ${c.slot===s?'selected':''}>${s||'—'}</option>`).join('');
    const orig = getOriginal(c) || {};
    const teacherChanged = fieldChanged(c,'teacher');
    const slotChanged = fieldChanged(c,'slot');
    const periodChanged = isOriginalReady() && (c.period||'') !== (orig.period||'');

    // 教师列
    let teacherHtml = editable && !inactive
      ? `<span class="editable" contenteditable="true" data-field="teacher" data-id="${escapeAttr(c.id)}">${escapeHtml(c.teacher || '—')}</span>`
      : `<span class="readonly-text">${escapeHtml(c.teacher || '—')}</span>`;

    // 时段列
    let slotHtml = editable && !inactive
      ? `<select class="editable" data-field="slot" data-id="${escapeAttr(c.id)}">${slotOpts}</select>`
      : `<span class="readonly-text">${escapeHtml(c.slot || '—')}</span>`;

    // 期数列：根据季度动态显示选项
    const periodOptions = c.season === '暑假' ? ['1期','2期','3期'] : ['周五','周六','周日'];
    const periodOpts = periodOptions.map(p=>`<option value="${p}" ${c.period===p?'selected':''}>${p}</option>`).join('');
    let periodHtml = editable && !inactive
      ? `<select class="editable" data-field="period" data-id="${escapeAttr(c.id)}">${periodOpts}</select>`
      : `<span class="readonly-text">${escapeHtml(c.period || '—')}</span>`;

    // 班型列：从班级名称提取原始班型字母
    const origClassType = getClassLetter(orig.name || c.name) || '';
    const curClassType = c.classType || origClassType;
    const classTypeChanged = isOriginalReady() && curClassType !== origClassType;
    const classTypeOpts = ['','A','B','C'].map(t=>`<option value="${t}" ${curClassType===t?'selected':''}>${t||'—'}</option>`).join('');
    let classTypeHtml = editable && !inactive
      ? `<select class="editable" data-field="classType" data-id="${escapeAttr(c.id)}">${classTypeOpts}</select>`
      : `<span class="readonly-text">${escapeHtml(curClassType || '—')}</span>`;
    const lifecycleHtml = renderLifecycleTag(c);
    const absorbedHtml = renderMergeSourcesTag(c);
    const cancelHtml = editable && !inactive ? `<button class="btn" style="background:#f1f5f9;color:#475569;padding:3px 8px;font-size:11px;" data-schedule-action="cancel" data-id="${escapeAttr(c.id)}">取消班</button>` : '';
    const mergeHtml = editable && !inactive ? `<button class="btn merge-drag-handle" draggable="true" title="点击选择目标班，或拖到目标班行合并" data-schedule-action="merge" data-id="${escapeAttr(c.id)}" style="background:#ecfeff;color:#0e7490;padding:3px 8px;font-size:11px;">合并</button>` : '';
    const restoreHtml = editable && inactive ? `<button class="btn btn-refresh" style="padding:3px 8px;font-size:11px;" data-schedule-action="restore" data-id="${escapeAttr(c.id)}">恢复</button>` : '';
    const deleteHtml = editable && !inactive && isInsertedCourse(c) ? `<button class="btn" style="background:#ffebee;color:#c62828;padding:3px 8px;font-size:11px;" data-schedule-action="delete-inserted" data-id="${escapeAttr(c.id)}">删除</button>` : '';
    const actionHtml = [lifecycleHtml, absorbedHtml, cancelHtml, mergeHtml, restoreHtml, deleteHtml].filter(Boolean).join(' ');
    const rowDropAttrs = editable && !inactive ? 'data-schedule-drop="1"' : '';

    return `<tr class="${rowClass}" data-id="${escapeAttr(c.id)}" ${rowDropAttrs}>
      <td><input type="checkbox" class="schedule-select" data-id="${escapeAttr(c.id)}" ${selected ? 'checked' : ''} ${(!editable || inactive) ? 'disabled' : ''} title="选择课程"> ${conflictMark}</td>
      <td>${escapeHtml(c.season)}</td>
      <td style="color:#888;font-size:11px;">${escapeHtml(orig.period || '')}</td>
      <td class="${periodChanged?'changed-cell':''}">${periodHtml}</td>
      <td>${escapeHtml((c.campus || '').replace('教学区',''))}</td>
      <td>${escapeHtml(getActualGrade(c))}</td>
      <td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.subject)}</td>
      <td style="color:#888;font-size:11px;">${escapeHtml(orig.teacher || '')}</td>
      <td class="${teacherChanged?' changed-cell':''}">${teacherHtml}</td>
      <td style="color:#888;font-size:11px;">${escapeHtml(orig.slot || '')}</td>
      <td class="${slotChanged?' changed-cell':''}">${slotHtml}</td>
      <td style="color:#888;font-size:11px;">${escapeHtml(origClassType || '—')}</td>
      <td class="${classTypeChanged?' changed-cell':''}">${classTypeHtml}</td>
      <td style="font-size:11px;white-space:nowrap;">${escapeHtml((c.timeDesc || '').replace(/[（(][^）)]*[）)]/g,''))}</td>
      <td style="font-size:11px;white-space:nowrap;">${escapeHtml((c.room || '').replace(/.*教学区/,''))}</td>
      <td>${renderDescTag(c.desc)}</td>
      <td>${escapeHtml(c.sessions || '')}</td><td>${renderCountCell(c)}</td><td>${actionHtml}</td>
    </tr>`;
  }).join('');
  updateBatchToolbar();
  const pager = document.getElementById('schedulePager');
  if (pager) {
    pager.innerHTML = `
      <span>共 ${totalFiltered} 行，当前 ${schedulePage}/${totalPages} 页</span>
      <button class="btn btn-refresh" style="padding:3px 8px;" ${schedulePage <= 1 ? 'disabled' : ''} data-page-action="prev">上一页</button>
      <button class="btn btn-refresh" style="padding:3px 8px;" ${schedulePage >= totalPages ? 'disabled' : ''} data-page-action="next">下一页</button>
    `;
  }
}

async function saveField(id, field, value) {
  if (!canEditNow()) {
    showToast('当前流程状态下不可编辑');
    renderAll();
    return;
  }
  setSyncStatus('saving');
  try {
    const body = {[field]: value};
    if (field === 'slot') body.timeRange = currentSlotLabels[value] || '';
    const course = findCourse(id);
    if (!(await confirmSundayAfternoonIfNeeded(course, body))) {
      setSyncStatus('');
      renderAll();
      return;
    }
    body.reason = defaultActionReason('表格快速保存');
    const res = await apiFetch(`${API_BASE}/api/courses/${id}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const updated = await res.json();
    if (await handleVersionConflict(res, updated)) return;
    if (!res.ok || updated.error) throw new Error(updated.error || 'save failed');
    applyResponseVersion(res);
    mergeLocalCourses([updated]);
    setSyncStatus('saved');
    showToast('已保存');
    renderAll();
  } catch(e) { setSyncStatus(''); showToast('保存失败'); }
}

function queueSaveField(id, field, value) {
  inlineSaveQueue = inlineSaveQueue
    .catch(() => {})
    .then(() => saveField(id, field, value));
  return inlineSaveQueue;
}

async function deleteInsertedCourse(id) {
  if (!canEditNow()) {
    showToast('当前流程状态下不可删除');
    return;
  }
  const course = findCourse(id);
  if (!course) return;
  const ok = await confirmAction({
    title: '删除插空新增课程',
    message: `确认删除插空新增课程？\n${course.code || ''} ${course.name || ''}`,
    confirmText: '确认删除',
    danger: true,
  });
  if (!ok) return;
  const reason = await askActionReason('删除课程');
  if (reason === null) return;
  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/courses/${id}`, {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reason})});
    const data = await res.json();
    if (await handleVersionConflict(res, data)) return;
    if (!res.ok || data.error) throw new Error(data.error || 'delete failed');
    applyResponseVersion(res);
    removeLocalCourse(id);
    setSyncStatus('saved');
    showToast('已删除新增课程');
    renderAll();
  } catch(e) {
    setSyncStatus('');
    showToast('删除失败');
  }
}

async function cancelCourse(id) {
  if (!canEditNow()) {
    showToast('当前流程状态下不可取消班级');
    return;
  }
  const course = findCourse(id);
  if (!course || !isActiveCourse(course)) return;
  pendingCancelCourseId = id;
  const body = document.getElementById('cancelCourseReviewBody');
  const reasonInput = document.getElementById('cancelCourseReason');
  const hint = document.getElementById('cancelCourseReasonHint');
  if (!body || !reasonInput) {
    const reason = await askActionReason('取消班级', '取消班是最终兜底方案，请记录低人数、招生集中或主管复核原因。');
    if (reason === null) return;
    await submitCancelCourseWithReason(id, reason);
    return;
  }
  body.innerHTML = renderCancelCourseReview(course);
  reasonInput.value = '';
  if (hint) hint.textContent = '';
  showAppModal('cancelCourseModal', '#cancelCourseReason');
}

function closeCancelCourseModal() {
  hideAppModal('cancelCourseModal');
  pendingCancelCourseId = null;
  const input = document.getElementById('cancelCourseReason');
  const hint = document.getElementById('cancelCourseReasonHint');
  if (input) input.value = '';
  if (hint) hint.textContent = '';
}

async function submitCancelCourse() {
  const id = pendingCancelCourseId;
  const course = findCourse(id);
  if (!id || !course || !isActiveCourse(course)) {
    closeCancelCourseModal();
    showToast('班级状态已变化，请刷新后重试');
    return;
  }
  const reasonInput = document.getElementById('cancelCourseReason');
  const hint = document.getElementById('cancelCourseReasonHint');
  const reason = reasonInput?.value.trim() || '';
  if (!reason) {
    if (hint) hint.textContent = '请填写取消原因，便于后续记录和复盘。';
    reasonInput?.focus();
    return;
  }
  await submitCancelCourseWithReason(id, reason);
}

async function submitCancelCourseWithReason(id, reason) {
  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/courses/${id}/cancel`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({reason}),
    });
    const data = await res.json();
    if (await handleVersionConflict(res, data)) return;
    if (!res.ok || data.error) throw new Error(data.error || 'cancel failed');
    applyResponseVersion(res);
    mergeLocalCourses([data.course]);
    setSyncStatus('saved');
    showToast('已取消班级');
    closeCancelCourseModal();
    renderAll();
  } catch(e) {
    setSyncStatus('');
    showToast('取消班级失败');
  }
}

async function mergeCourse(id) {
  if (Date.now() < suppressMergeClickUntil) {
    return;
  }
  if (!canEditNow()) {
    showToast('当前流程状态下不可合并班级');
    return;
  }
  const source = findCourse(id);
  if (!source || !isActiveCourse(source)) return;
  openMergeCourseModal(id);
}

function clearScheduleMergeDropTargets() {
  document.querySelectorAll('.schedule-merge-drop-target').forEach(el => el.classList.remove('schedule-merge-drop-target'));
}

function startScheduleMergeDrag(e, id) {
  if (!canEditNow()) return;
  const source = findCourse(id);
  if (!source || !isActiveCourse(source)) return;
  draggingMergeSourceId = id;
  clearScheduleMergeDropTargets();
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  }
}

function endScheduleMergeDrag() {
  draggingMergeSourceId = null;
  clearScheduleMergeDropTargets();
}

function scheduleMergeDragOver(e, targetId) {
  if (!draggingMergeSourceId || String(draggingMergeSourceId) === String(targetId)) return;
  const target = findCourse(targetId);
  if (!target || !isActiveCourse(target)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  clearScheduleMergeDropTargets();
  e.currentTarget?.classList.add('schedule-merge-drop-target');
}

function scheduleMergeDragLeave(e) {
  const row = e.currentTarget;
  if (!row || row.contains(e.relatedTarget)) return;
  row.classList.remove('schedule-merge-drop-target');
}

function scheduleMergeDrop(e, targetId) {
  if (!draggingMergeSourceId || String(draggingMergeSourceId) === String(targetId)) return;
  e.preventDefault();
  suppressMergeClickUntil = Date.now() + 500;
  const sourceId = draggingMergeSourceId;
  endScheduleMergeDrag();
  const source = findCourse(sourceId);
  const target = findCourse(targetId);
  if (!source || !target || !isActiveCourse(source) || !isActiveCourse(target)) {
    showToast('无法合并该班级，请刷新后重试');
    return;
  }
  openMergeCourseModal(sourceId, targetId);
}

function parseCourseCount(value) {
  const m = String(value || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function renderCountCell(course) {
  return escapeHtml(course?.currentCount || '');
}

function mergeOptionLabel(c) {
  const parts = [
    c.code || `ID:${c.id}`,
    c.name || '',
    shortCampus(c.campus),
    getActualGrade(c),
    c.subject || '',
    c.classType ? `${c.classType}班型` : '',
    c.currentCount ? `${c.currentCount}人` : '',
  ];
  return parts.filter(Boolean).join(' | ');
}

function mergeClassType(c) {
  return c.classType || getClassLetter(c.name || '') || '';
}

function mergeTargetFit(source, target) {
  const sourceGrade = getActualGrade(source);
  const targetGrade = getActualGrade(target);
  const sameCampus = source.campus && target.campus && source.campus === target.campus;
  const sameGrade = sourceGrade && sourceGrade === targetGrade;
  const sameSubject = source.subject && target.subject && source.subject === target.subject;
  const sourceClassType = mergeClassType(source);
  const targetClassType = mergeClassType(target);
  const sameClassType = sourceClassType && sourceClassType === targetClassType;
  const sameSeason = source.season && source.season === target.season;
  const samePeriod = source.period && source.period === target.period;
  const sameSlot = source.slot && source.slot === target.slot;
  const sourceCount = parseCourseCount(source.currentCount);
  const targetCount = parseCourseCount(target.currentCount);
  const combinedCount = sourceCount !== null && targetCount !== null ? sourceCount + targetCount : null;
  const notes = [];
  let score = 0;
  if (sameCampus) score += 30; else notes.push('跨校区');
  if (sameGrade) score += 28; else notes.push('跨年级');
  if (sameSubject) score += 26; else notes.push('跨科目');
  if (sameClassType) score += 8;
  else if (sourceClassType && targetClassType) notes.push('跨班型');
  if (sameSeason) score += 4;
  if (samePeriod) score += 3;
  if (sameSlot) score += 2;
  const reasonParts = [];
  if (sameCampus && sameGrade && sameSubject) reasonParts.push('同校区同年级同科目');
  else reasonParts.push([sameCampus ? '同校区' : '', sameGrade ? '同年级' : '', sameSubject ? '同科目' : ''].filter(Boolean).join('') || '需复核');
  if (sameClassType) reasonParts.push('同班型');
  if (samePeriod && sameSlot) reasonParts.push('同时间');
  else if (samePeriod || sameSlot) reasonParts.push(samePeriod ? '同期数' : '同时段');
  if (combinedCount !== null) reasonParts.push(`预计${combinedCount}人`);
  const uniqueNotes = [...new Set(notes)];
  const requiresReview = uniqueNotes.length > 0;
  return {score, notes: uniqueNotes, combinedCount, requiresReview, reason: reasonParts.join(' · ')};
}

function mergeTargetGroups(source) {
  const groups = [
    {label: '推荐：同校区同年级同科目', items: []},
    {label: '同校区同年级其他班', items: []},
    {label: '其他可选班级', items: []},
  ];
  const sourceGrade = getActualGrade(source);
  courses
    .filter(c => isActiveCourse(c) && String(c.id) !== String(source.id))
    .forEach(c => {
      const sameCampus = c.campus === source.campus;
      const sameGrade = getActualGrade(c) === sourceGrade;
      const sameSubject = c.subject === source.subject;
      if (sameCampus && sameGrade && sameSubject) groups[0].items.push(c);
      else if (sameCampus && sameGrade) groups[1].items.push(c);
      else groups[2].items.push(c);
    });
  groups.forEach(g => g.items.sort((a, b) => {
    const fitDiff = mergeTargetFit(source, b).score - mergeTargetFit(source, a).score;
    return fitDiff || mergeOptionLabel(a).localeCompare(mergeOptionLabel(b), 'zh-Hans-CN');
  }));
  return groups;
}

function renderMergeRecommendations(source, groups) {
  const box = document.getElementById('mergeRecommendations');
  if (!box) return;
  const targets = groups
    .flatMap(g => g.items)
    .map(c => ({course: c, fit: mergeTargetFit(source, c)}))
    .sort((a, b) => b.fit.score - a.fit.score || mergeOptionLabel(a.course).localeCompare(mergeOptionLabel(b.course), 'zh-Hans-CN'))
    .slice(0, 4);
  if (!targets.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = targets.map(({course, fit}) => `
    <button type="button" class="merge-target-card ${fit.requiresReview ? 'review' : ''}" data-target-id="${escapeAttr(course.id)}">
      <b>${escapeHtml(course.code || '')} ${escapeHtml(course.name || '')}</b>
      <span>${escapeHtml(fit.reason)}</span>
      ${fit.notes.length ? `<span style="color:#b45309;">需复核：${escapeHtml(fit.notes.join('、'))}</span>` : ''}
    </button>
  `).join('');
}

document.getElementById('mergeRecommendations')?.addEventListener('click', function(e) {
  const card = e.target.closest('.merge-target-card[data-target-id]');
  if (!card || !this.contains(card)) return;
  selectMergeTarget(card.dataset.targetId);
});

function selectMergeTarget(id) {
  const select = document.getElementById('mergeTargetSelect');
  if (!select) return;
  select.value = String(id);
  renderMergeTargetPreview();
}

function renderMergeTargetPreview() {
  const source = findCourse(pendingMergeSourceId);
  const targetId = document.getElementById('mergeTargetSelect')?.value;
  const target = findCourse(targetId);
  const preview = document.getElementById('mergePreview');
  if (!preview || !source) return;
  if (!target) {
    preview.textContent = '没有可合并的目标班级。';
    preview.classList.remove('merge-preview-warn');
    return;
  }
  const sourceCount = parseCourseCount(source.currentCount);
  const targetCount = parseCourseCount(target.currentCount);
  const fit = mergeTargetFit(source, target);
  const combinedCount = sourceCount !== null && targetCount !== null ? sourceCount + targetCount : null;
  const sourceClassType = mergeClassType(source);
  const targetClassType = mergeClassType(target);
  const sourceGrade = getActualGrade(source);
  const targetGrade = getActualGrade(target);
  const checkItems = [
    ['校区', source.campus && target.campus && source.campus === target.campus, shortCampus(source.campus || ''), shortCampus(target.campus || '')],
    ['年级', sourceGrade && sourceGrade === targetGrade, sourceGrade, targetGrade],
    ['科目', source.subject && target.subject && source.subject === target.subject, source.subject, target.subject],
    ['班型', sourceClassType && sourceClassType === targetClassType, sourceClassType || '未识别', targetClassType || '未识别'],
    ['期数', source.period && source.period === target.period, source.period, target.period],
    ['时段', source.slot && source.slot === target.slot, source.slot || '未排', target.slot || '未排'],
  ];
  const checkHtml = checkItems.map(([label, ok, from, to]) => {
    const cls = ok ? 'good' : (label === '年级' || label === '科目' ? 'bad' : 'warn');
    return `<div class="merge-preview-check ${cls}">
      <b>${escapeHtml(label)}${ok ? '匹配' : '需复核'}</b>
      <span>${escapeHtml(from || '-')} → ${escapeHtml(to || '-')}</span>
    </div>`;
  }).join('');
  const countDelta = combinedCount !== null ? `+${sourceCount}` : '待核';
  const totalText = combinedCount !== null ? `${combinedCount}人` : '无法自动计算';
  const note = fit.notes.length
    ? `请复核：${fit.notes.join('、')}。合并班属于兜底方案，仍需确认招生集中、家长沟通和结转影响。`
    : '来源班合并后不再参与产能、教室占用和冲突检测；系统会在目标班记录合并来源，便于后续追溯。';
  preview.innerHTML = `
    <div class="merge-preview-board">
      <div class="merge-preview-flow">
        <div class="merge-preview-node">
          <b>来源班：${escapeHtml(source.code || '')} ${escapeHtml(source.name || '')}</b>
          <span>${escapeHtml(courseRecordMeta(source))} · ${escapeHtml(countText(source.currentCount))}</span>
        </div>
        <div class="merge-preview-arrow">→</div>
        <div class="merge-preview-node">
          <b>目标班：${escapeHtml(target.code || '')} ${escapeHtml(target.name || '')}</b>
          <span>${escapeHtml(courseRecordMeta(target))} · ${escapeHtml(countText(target.currentCount))}</span>
        </div>
      </div>
      <div class="merge-preview-kpis">
        <div class="merge-preview-kpi"><b>${escapeHtml(sourceCount ?? '-')}</b><span>来源人数</span></div>
        <div class="merge-preview-kpi"><b>${escapeHtml(targetCount ?? '-')}</b><span>目标现有人数</span></div>
        <div class="merge-preview-kpi"><b>${escapeHtml(totalText)}</b><span>合并后预计 ${escapeHtml(countDelta)}</span></div>
      </div>
      <div class="merge-preview-checks">${checkHtml}</div>
      <div class="merge-preview-note">推荐依据：${escapeHtml(fit.reason)}。${escapeHtml(note)}</div>
    </div>
  `;
  preview.classList.toggle('merge-preview-warn', Boolean(fit.requiresReview));
  document.querySelectorAll('.merge-target-card').forEach(card => {
    card.classList.toggle('active', String(card.dataset.targetId) === String(targetId));
  });
}

function openMergeCourseModal(id, preferredTargetId = null) {
  const source = findCourse(id);
  if (!source || !isActiveCourse(source)) return;
  pendingMergeSourceId = id;
  const modal = document.getElementById('mergeCourseModal');
  const sourceInfo = document.getElementById('mergeSourceInfo');
  const targetSelect = document.getElementById('mergeTargetSelect');
  const reasonInput = document.getElementById('mergeReasonInput');
  const reasonHint = document.getElementById('mergeReasonHint');
  if (!modal || !sourceInfo || !targetSelect || !reasonInput) return;
  sourceInfo.innerHTML = `
    <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">来源班：${escapeHtml(source.code || '')} ${escapeHtml(source.name || '')}</div>
    <div>${escapeHtml(shortCampus(source.campus))} · ${escapeHtml(getActualGrade(source))} · ${escapeHtml(source.subject || '')} · ${escapeHtml(source.period || '')}${escapeHtml(source.slot || '')} · 当前人数 ${escapeHtml(source.currentCount || '未填')}</div>
  `;
  const groups = mergeTargetGroups(source).filter(g => g.items.length);
  renderMergeRecommendations(source, groups);
  targetSelect.innerHTML = groups.map(g => `
    <optgroup label="${escapeAttr(g.label)}">
      ${g.items.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(mergeOptionLabel(c))}</option>`).join('')}
    </optgroup>
  `).join('');
  targetSelect.disabled = !groups.length;
  if (preferredTargetId !== null && [...targetSelect.options].some(o => String(o.value) === String(preferredTargetId))) {
    targetSelect.value = String(preferredTargetId);
  }
  reasonInput.value = '';
  if (reasonHint) reasonHint.textContent = '';
  targetSelect.onchange = renderMergeTargetPreview;
  showAppModal('mergeCourseModal', '#mergeTargetSelect');
  renderMergeTargetPreview();
}

function closeMergeCourseModal() {
  hideAppModal('mergeCourseModal');
  pendingMergeSourceId = null;
}

async function submitMergeCourse() {
  const source = findCourse(pendingMergeSourceId);
  const targetRef = document.getElementById('mergeTargetSelect')?.value;
  if (!source || !targetRef) {
    showToast('请选择目标班级');
    return;
  }
  const target = findCourse(targetRef);
  const reason = document.getElementById('mergeReasonInput')?.value.trim() || '合并班级';
  const reasonHint = document.getElementById('mergeReasonHint');
  if (!target) {
    showToast('目标班级不存在');
    return;
  }
  if (!reason || reason === '合并班级') {
    if (reasonHint) reasonHint.textContent = '请填写合并原因，例如低人数合并、招生集中或主管复核确认。';
    document.getElementById('mergeReasonInput')?.focus();
    return;
  }
  const fit = mergeTargetFit(source, target);
  if (fit.requiresReview && reasonHint) {
    reasonHint.textContent = `该合并目标需要复核：${fit.notes.join('、')}。提交后会记录来源班、目标班和原因。`;
  }
  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/courses/merge`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({source_id: source.id, target_id: targetRef, reason}),
    });
    const data = await res.json();
    if (await handleVersionConflict(res, data)) return;
    if (!res.ok || data.error) throw new Error(data.error || 'merge failed');
    applyResponseVersion(res);
    mergeLocalCourses([data.source, data.target]);
    setSyncStatus('saved');
    showToast('已合并班级');
    closeMergeCourseModal();
    renderAll();
  } catch(e) {
    setSyncStatus('');
    showToast('合并班级失败');
  }
}

async function restoreCourse(id) {
  if (!canEditNow()) {
    showToast('当前流程状态下不可恢复班级');
    return;
  }
  const course = findCourse(id);
  if (!course || isActiveCourse(course)) return;
  const lifecycle = courseLifecycleStatus(course);
  const actionText = lifecycle === 'merged'
    ? '恢复后会从目标班移除合并来源，并尝试扣回已合并人数。'
    : '恢复后会重新参与产能、教室占用和冲突检测。';
  const ok = await confirmAction({
    title: '恢复班级状态',
    message: `确认恢复班级？\n${course.code || ''} ${course.name || ''}\n${actionText}`,
    confirmText: '确认恢复',
  });
  if (!ok) return;
  const reason = await askActionReason('恢复班级状态');
  if (reason === null) return;
  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/courses/${id}/restore`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({reason}),
    });
    const data = await res.json();
    if (await handleVersionConflict(res, data)) return;
    if (!res.ok || data.error) throw new Error(data.error || 'restore failed');
    applyResponseVersion(res);
    mergeLocalCourses([data.course, data.target]);
    setSyncStatus('saved');
    showToast('已恢复班级');
    renderAll();
  } catch(e) {
    setSyncStatus('');
    showToast(e.message || '恢复班级失败');
  }
}

document.getElementById('scheduleBody').addEventListener('blur', function(e) {
  if (e.target.dataset.field === 'teacher') {
    const id = parseInt(e.target.dataset.id);
    let val = e.target.textContent.trim();
    if (val === '—') val = '';
    const course = findCourse(id);
    if (course && val !== course.teacher) queueSaveField(id, 'teacher', val);
  }
}, true);
document.getElementById('scheduleBody').addEventListener('focusin', function(e) {
  markUserEditing();
  markPresenceEditingElement(e.target);
});
document.getElementById('scheduleBody').addEventListener('input', function(e) {
  markUserEditing();
  markPresenceEditingElement(e.target);
});
document.getElementById('scheduleBody').addEventListener('click', function(e) {
  const row = e.target.closest('tr[data-id]');
  if (row && this.contains(row)) markPresenceViewingCourse(row.dataset.id, true);
  const actionEl = e.target.closest('[data-schedule-action]');
  if (!actionEl || !this.contains(actionEl)) return;
  const action = actionEl.dataset.scheduleAction;
  const id = actionEl.dataset.id;
  if (action === 'toggle-conflict') {
    actionEl.nextElementSibling?.classList.toggle('hidden');
    return;
  }
  if (action === 'lifecycle-detail') return showLifecycleDetail(id);
  if (action === 'merge-sources') return showMergeSources(id);
  if (action === 'cancel') return cancelCourse(id);
  if (action === 'merge') return mergeCourse(id);
  if (action === 'restore') return restoreCourse(id);
  if (action === 'delete-inserted') return deleteInsertedCourse(id);
});
document.getElementById('scheduleBody').addEventListener('dragstart', function(e) {
  const handle = e.target.closest('.merge-drag-handle[data-id]');
  if (!handle || !this.contains(handle)) return;
  startScheduleMergeDrag(e, handle.dataset.id);
});
document.getElementById('scheduleBody').addEventListener('dragend', function(e) {
  if (e.target.closest('.merge-drag-handle')) endScheduleMergeDrag();
});
document.getElementById('scheduleBody').addEventListener('dragover', function(e) {
  const row = e.target.closest('tr[data-schedule-drop="1"][data-id]');
  if (!row || !this.contains(row)) return;
  scheduleMergeDragOver(e, row.dataset.id);
});
document.getElementById('scheduleBody').addEventListener('dragleave', function(e) {
  const row = e.target.closest('tr[data-schedule-drop="1"][data-id]');
  if (!row || !this.contains(row)) return;
  scheduleMergeDragLeave(e);
});
document.getElementById('scheduleBody').addEventListener('drop', function(e) {
  const row = e.target.closest('tr[data-schedule-drop="1"][data-id]');
  if (!row || !this.contains(row)) return;
  scheduleMergeDrop(e, row.dataset.id);
});
document.getElementById('scheduleBody').addEventListener('change', function(e) {
  markUserEditing();
  if (e.target.classList.contains('schedule-select')) {
    const id = String(e.target.dataset.id);
    if (e.target.checked) selectedCourseIds.add(id);
    else selectedCourseIds.delete(id);
    setPresenceState({activity: 'selecting', courseId: selectedCourseIds.size === 1 ? [...selectedCourseIds][0] : '', field: ''}, true);
    updateBatchToolbar();
    return;
  }
  if (e.target.dataset.field === 'slot') {
    const id = parseInt(e.target.dataset.id);
    markPresenceEditingElement(e.target);
    queueSaveField(id, 'slot', e.target.value);
  }
  if (e.target.dataset.field === 'period') {
    const id = parseInt(e.target.dataset.id);
    markPresenceEditingElement(e.target);
    queueSaveField(id, 'period', e.target.value);
  }
  if (e.target.dataset.field === 'classType') {
    const id = parseInt(e.target.dataset.id);
    markPresenceEditingElement(e.target);
    queueSaveField(id, 'classType', e.target.value);
  }
});

document.getElementById('schedulePager')?.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-page-action]');
  if (!btn || !this.contains(btn) || btn.disabled) return;
  if (btn.dataset.pageAction === 'prev') schedulePage -= 1;
  if (btn.dataset.pageAction === 'next') schedulePage += 1;
  renderSchedule();
});

['filterSearch','filterLifecycle','filterConflictOnly','filterChangedOnly'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  const eventName = el.matches('select') || el.type === 'checkbox' ? 'change' : 'input';
  el.addEventListener(eventName, () => {
    markUserEditing(4000);
    if (id === 'filterLifecycle') initFilters();
    if (eventName === 'change') renderScheduleFromFilter();
    else debouncedRenderScheduleFromFilter();
  });
});

document.addEventListener('click', () => {
  document.querySelectorAll('.multi-select.open').forEach(ms => ms.classList.remove('open'));
  closePresencePopover();
});

function exportExcel(changedOnly) {
  window.location.href = changedOnly ? `${API_BASE}/api/export?changed_only=1` : `${API_BASE}/api/export`;
  showToast('正在导出...');
}

function downloadJsonBackup() {
  window.location.href = `${API_BASE}/api/backup/json`;
  showToast('正在下载当前排课备份...');
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDurationMs(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${Math.round(ms)}ms`;
}

function systemKpiHtml(label, value, detail = '', tone = '') {
  return `<div class="system-kpi ${escapeAttr(tone)}">
    <span>${escapeHtml(label)}</span>
    <b>${escapeHtml(value)}</b>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
  </div>`;
}

function systemDetailRows(rows) {
  return `<dl class="system-detail-list">${rows.map(([label, value]) => `
    <dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '-')}</dd>
  `).join('')}</dl>`;
}

function renderSystemIssues(runtime = {}) {
  const issues = Array.isArray(runtime.issues) ? runtime.issues : [];
  if (!issues.length) return '<div class="system-empty">运行自检正常，未发现关键依赖或数据库路径问题。</div>';
  return `<div class="system-issues">${issues.map(item => `
    <div class="system-issue ${item.severity === 'critical' ? 'bad' : ''}">
      <b>${escapeHtml(item.code || item.severity || 'issue')}</b>
      <div>${escapeHtml(item.message || '')}</div>
      ${item.details ? `<div>${escapeHtml(Array.isArray(item.details) ? item.details.join('、') : item.details)}</div>` : ''}
    </div>
  `).join('')}</div>`;
}

function renderSlowRequests(list = [], thresholdMs = 0) {
  if (!Array.isArray(list) || !list.length) {
    return '<div class="system-empty">最近没有超过慢请求阈值的接口。</div>';
  }
  return `<div class="system-slow-list">${list.slice().reverse().slice(0, 8).map(item => {
    const duration = Number(item.duration_ms || 0);
    const tone = duration >= Number(thresholdMs || 0) * 2 ? 'bad' : 'warn';
    return `<div class="system-slow-item ${escapeAttr(tone)}">
      <div class="system-slow-main">
        <span>${escapeHtml(item.method || 'GET')} ${escapeHtml(item.path || '')}</span>
        <span>${escapeHtml(formatDurationMs(duration))}</span>
      </div>
      <div class="system-slow-meta">${escapeHtml(item.time || '')} · HTTP ${escapeHtml(item.status || '')}</div>
    </div>`;
  }).join('')}</div>`;
}

async function showSystemStatus() {
  activateTab('changelog');
  const panel = document.getElementById('systemStatusPanel');
  if (!panel) return;
  panel.classList.remove('hidden');
  panel.innerHTML = '<div style="background:white;border-radius:8px;padding:14px;color:#999;">正在检查系统状态...</div>';
  try {
    const res = await apiFetch(`${API_BASE}/api/system/status`);
    const data = await res.json();
    if (!res.ok || data.error) {
      panel.innerHTML = '<div style="background:white;border-radius:8px;padding:14px;color:#c62828;">系统状态加载失败</div>';
      return;
    }
    const runtimeOk = data.runtime?.ok !== false;
    const dbOk = data.database?.exists !== false;
    const dbSize = formatBytes(data.database?.size);
    const backup = data.latest_daily_backup || {};
    const metadata = data.metadata || {};
    const workflow = data.workflow || {};
    const slowRequests = data.recent_slow_requests || [];
    const thresholdMs = Number(data.slow_request_threshold_ms || 0);
    const latestSlow = slowRequests.length ? slowRequests[slowRequests.length - 1] : null;
    const runtimeCode = data.runtime?.code || {};
    const sqliteInfo = data.runtime?.sqlite_store || {};
    panel.innerHTML = `
      <div class="system-status-card">
        <div class="system-status-head">
          <div>
            <div class="system-status-title">系统状态</div>
            <div class="system-status-sub">运行自检、备份、数据库和慢接口</div>
          </div>
          <div class="system-status-time">${escapeHtml(data.server_time || '')}</div>
        </div>
        <div class="system-kpis">
          ${systemKpiHtml('运行自检', runtimeOk ? '正常' : '异常', runtimeOk ? 'runtime_ok=true' : '需要查看自检问题', runtimeOk ? 'good' : 'bad')}
          ${systemKpiHtml('数据库', dbOk ? '正常' : '未找到', `${dbSize} · ${data.database?.path || '-'}`, dbOk ? 'good' : 'bad')}
          ${systemKpiHtml('班级 / 教师 / 校区', `${data.courses_count || 0} / ${data.teachers_count || 0} / ${data.campuses_count || 0}`, '当前批次数据规模')}
          ${systemKpiHtml('最近自动备份', backup.saved_at || '暂无', backup.filename ? `${backup.filename} · ${formatBytes(backup.size)}` : '', backup.saved_at ? 'good' : 'warn')}
          ${systemKpiHtml('历史版本', data.history_count || 0, '保留可回滚快照')}
          ${systemKpiHtml('慢请求', slowRequests.length ? slowRequests.length : '0', latestSlow ? `${latestSlow.path || ''} · ${formatDurationMs(latestSlow.duration_ms)}` : `阈值 ${formatDurationMs(thresholdMs)}`, slowRequests.length ? 'warn' : 'good')}
        </div>
        <div class="system-status-grid">
          <div class="system-section">
            <div class="system-section-title">运行与数据版本 <small>${escapeHtml(workflow.status || '')}</small></div>
            ${systemDetailRows([
              ['数据版本', metadata.version || metadata.data_version || ''],
              ['最近更新', [metadata.updated_at, metadata.updated_by].filter(Boolean).join(' · ')],
              ['原始版本', metadata.original_version || ''],
              ['App 指纹', runtimeCode.app ? `${runtimeCode.app.sha1 || ''} · ${runtimeCode.app.mtime || ''}` : ''],
              ['SQLite 指纹', runtimeCode.sqlite_store ? `${runtimeCode.sqlite_store.sha1 || ''} · ${runtimeCode.sqlite_store.mtime || ''}` : ''],
              ['SQLite 文件', sqliteInfo.db_path || data.database?.path || ''],
            ])}
          </div>
          <div class="system-section">
            <div class="system-section-title">运行自检 <small>${runtimeOk ? 'OK' : '需处理'}</small></div>
            ${renderSystemIssues(data.runtime || {})}
          </div>
          <div class="system-section" style="grid-column:1 / -1;">
            <div class="system-section-title">最近慢请求 <small>阈值 ${escapeHtml(formatDurationMs(thresholdMs))}</small></div>
            ${renderSlowRequests(slowRequests, thresholdMs)}
          </div>
        </div>
      </div>`;
  } catch(e) {
    panel.innerHTML = '<div style="background:white;border-radius:8px;padding:14px;color:#c62828;">系统状态加载失败</div>';
  }
}

const GRADE_OPTIONS = DEPT_ID === 'qingshao'
  ? ['幼儿园大班','一年级','二年级','三年级','四年级','五年级','六年级']
  : ['初一','初二','初三','高一','高二'];
const QINGSHAO_GRADE_BY_NUM = {'0':'幼儿园大班','1':'一年级','2':'二年级','3':'三年级','4':'四年级','5':'五年级','6':'六年级'};
const QINGSHAO_GRADE_SHORT = {
  '幼儿园大班': '大班',
  '一年级': '1级',
  '二年级': '2级',
  '三年级': '3级',
  '四年级': '4级',
  '五年级': '5级',
  '六年级': '6级',
};

function normalizeGrade(courseOrName, compact = false) {
  const course = typeof courseOrName === 'object' && courseOrName ? courseOrName : {};
  const name = typeof courseOrName === 'string' ? courseOrName : (course.name || '');
  const rawGrade = String(course.grade || '').trim();
  if (DEPT_ID === 'qingshao') {
    let grade = '';
    if (rawGrade && (rawGrade.includes('大班') || rawGrade in QINGSHAO_GRADE_SHORT)) grade = rawGrade;
    if (!grade) {
      const cn = name.match(/([一二三四五六])年级/);
      if (cn) grade = cn[1] + '年级';
    }
    if (!grade && (rawGrade === 'S3' || name.includes('大班') || name.includes('幼儿园'))) grade = '幼儿园大班';
    if (!grade) {
      const level = name.match(/([0-6])级/);
      if (level) grade = QINGSHAO_GRADE_BY_NUM[level[1]] || '';
    }
    if (!grade && course.code) {
      const code = String(course.code);
      if (code.length >= 4) grade = QINGSHAO_GRADE_BY_NUM[code[3]] || '';
    }
    return compact ? (QINGSHAO_GRADE_SHORT[grade] || grade) : grade;
  }
  if (rawGrade && ['初一','初二','初三','高一','高二'].includes(rawGrade)) return rawGrade;
  if (name.includes('高一准备')) return '初一';
  if (name.includes('高一预备')) return '初二';
  if (name.includes('高一预科')) return '初三';
  if (name.match(/高一(?!准备|预备|预科)/)) return '高一';
  const high = name.match(/(高[二三])/);
  if (high) return high[1];
  const level = name.match(/([789])级/);
  if (level) {
    const map = {'7':'初一','8':'初二','9':'初三'};
    return map[level[1]] || '';
  }
  return '';
}

// === 教师产能表 ===
// 高中班级部：高一准备=初一，高一预备=初二，高一预科=初三；青少：大班到六年级。
function extractGrade(courseOrName) {
  return normalizeGrade(courseOrName, true);
}
function getActualGrade(courseOrName) {
  return normalizeGrade(courseOrName, false);
}
function getClassType(capacity) {
  const n = parseInt(capacity);
  if (n === 6) return '小组';
  if (n === 20) return '素养';
  return '';
}
function shortCampus(campus) {
  const map = {
    'IPARK购物中心教学区': 'IPARK',
    '北滘悦然广场教学区': '北滘',
    '铂顿城教学区': '铂顿',
    '禅西环宇城教学区': '禅西',
    '大良新一城教学区': '大良',
    '富凯广场教学区': '富凯',
    '广佛智城教学区': '大沥',
    '容桂桂洲大道教学区': '容桂',
    '新南万教学区': '南万',
    '新兆阳广场教学区': '兆阳',
    '映月湖环宇城教学区': '映月湖',
    '友邦金融中心教学区': '友邦',
  };
  return map[campus] || (campus||'').replace('教学区','').replace('购物中心','').replace('广场','');
}

function shortClassName(courseOrName) {
  const course = typeof courseOrName === 'object' && courseOrName ? courseOrName : {};
  const name = typeof courseOrName === 'string' ? courseOrName : (course.name || '');
  let subject = '';
  for (const s of ['双语','博文','益智','科学','实践','KET','PET','YLE']) {
    if (name.includes(s)) { subject = s; break; }
  }
  const grade = normalizeGrade(courseOrName, true);
  let classType = '';
  const t = name.match(/[A-C]/);
  if (t) classType = t[0];
  return subject + (grade ? grade : '') + classType;
}

// 班型统计key生成：
// 双语：每个A/B/C + 年级都是独立班型
// 益智：C + 年级是独立班型，A/B + 年级合并为1个班型
// 其他（博文/科学/实践）：只按年级统计
function getClassTypeKey(subject, name, grade) {
  if (!subject || !grade) return '';
  if (subject === '双语') {
    const m = name.match(/[A-C]/);
    return '双语' + grade + (m ? m[0] : '');
  }
  if (subject === '益智') {
    const m = name.match(/[A-C]/);
    if (m && m[0] === 'C') return '益智' + grade + 'C';
    return '益智' + grade + 'AB';
  }
  return subject + grade;
}

const campusColors = {};
const colorPalette = [
  {bg:'#e3f2fd',border:'#90caf9'}, // 蓝
  {bg:'#fce4ec',border:'#f48fb1'}, // 粉
  {bg:'#e8f5e9',border:'#a5d6a7'}, // 绿
  {bg:'#fff3e0',border:'#ffcc80'}, // 橙
  {bg:'#f3e5f5',border:'#ce93d8'}, // 紫
  {bg:'#e0f7fa',border:'#80deea'}, // 青
  {bg:'#fff9c4',border:'#fff176'}, // 黄
  {bg:'#efebe9',border:'#bcaaa4'}, // 棕
  {bg:'#e8eaf6',border:'#9fa8da'}, // 靛
  {bg:'#e0f2f1',border:'#80cbc4'}, // 碧
  {bg:'#fbe9e7',border:'#ffab91'}, // 珊瑚
  {bg:'#f1f8e9',border:'#aed581'}, // 草绿
];
function getCampusColor(campus) {
  if (!campus) return colorPalette[0];
  if (!campusColors[campus]) {
    const idx = Object.keys(campusColors).length % colorPalette.length;
    campusColors[campus] = colorPalette[idx];
  }
  return campusColors[campus];
}

function buildCapacityStats() {
  const summaries = [];
  const subjectSlotDetail = {};
  courses.forEach(c => {
    if (!isActiveCourse(c)) return;
    if (c.season === '秋季' && c.slot && c.subject) {
      if (!subjectSlotDetail[c.subject]) subjectSlotDetail[c.subject] = {};
      const slotKey = `${c.period}${c.slot}`;
      subjectSlotDetail[c.subject][slotKey] = (subjectSlotDetail[c.subject][slotKey] || 0) + 1;
    }
    if (!c.teacher) return;
    const grade = extractGrade(c);
    const classTypeKey = getClassTypeKey(c.subject, c.name, grade);
    const classType = getClassType(c.capacity);
    const descType = getDescType(c.desc);
    summaries.push({
      id: c.id,
      teacher: c.teacher,
      subject: c.subject || '',
      campus: c.campus || '',
      shortCampus: shortCampus(c.campus),
      season: c.season || '',
      period: c.period || '',
      slot: c.slot || '',
      grade,
      classTypeKey,
      classType,
      isPreset: descType === '预设班' || descType === '预设班(未开通)',
      name: shortClassName(c),
      fullName: c.name || '',
      count: c.currentCount || '',
    });
  });

  const subjectHeadcount = {};
  Object.entries(subjectSlotDetail).forEach(([subj, slotMap]) => {
    const max = Math.max(0, ...Object.values(slotMap));
    subjectHeadcount[subj] = max + 2;
  });

  const balanceAdvice = {};
  Object.entries(subjectSlotDetail).forEach(([subj, slotMap]) => {
    const values = Object.values(slotMap);
    if (values.length < 2) return;
    const max = Math.max(...values);
    const avg = values.reduce((a,b)=>a+b,0) / values.length;
    const maxSlot = Object.entries(slotMap).find(([k,v]) => v === max);
    const minEntry = Object.entries(slotMap).reduce((a,b) => a[1]<b[1]?a:b);
    if (max > avg * 1.3 && max - minEntry[1] >= 3) {
      balanceAdvice[subj] = {
        peakSlot: maxSlot[0], peakCount: max,
        lowSlot: minEntry[0], lowCount: minEntry[1],
        diff: max - minEntry[1]
      };
    }
  });

  return {version: loadedVersion || '', courseCount: courses.length, summaries, subjectHeadcount, balanceAdvice};
}

function getCapacityStats() {
  const dataSignature = courseDerivedViewSignature();
  if (
    capacityStatsCache &&
    capacityStatsCache.version === (loadedVersion || '') &&
    capacityStatsCache.dataSignature === dataSignature
  ) {
    return capacityStatsCache;
  }
  capacityStatsCache = {...buildCapacityStats(), dataSignature};
  return capacityStatsCache;
}

function renderCapacity() {
  const subjectFilter = document.getElementById('capSubject').value;
  const campusFilter = document.getElementById('capCampus').value;
  const teacherSearch = document.getElementById('capTeacherSearch').value.toLowerCase();
  const dataSignature = courseDerivedViewSignature();
  const renderSignature = JSON.stringify({
    version: loadedVersion || '',
    dataSignature,
    subjectFilter,
    campusFilter,
    teacherSearch,
    editable: canEditNow(),
  });
  if (capacityRenderSignature === renderSignature) return;

  const summerPeriods = [{label:'1期',period:'1期',color:'#fff3e0'},{label:'2期',period:'2期',color:'#fce4ec'},{label:'3期',period:'3期',color:'#f3e5f5'}];
  const autumnPeriods = [{label:'周五',period:'周五',slots:['E'],color:'#e8f5e9'},{label:'周六',period:'周六',slots:['A','B','C','D','E'],color:'#e3f2fd'},{label:'周日',period:'周日',slots:['A','B'],color:'#e0f7fa'}];
  const slots = ['A','B','C','D','E'];

  const headSignature = JSON.stringify({summerPeriods: summerPeriods.map(p => p.period), autumnPeriods: autumnPeriods.map(p => [p.period, p.slots]), slots});
  if (capacityHeadSignature !== headSignature) {
    let h1 = '<tr><th rowspan="2">科目</th><th rowspan="2">教师</th><th rowspan="2">年级</th>';
    summerPeriods.forEach(p => { h1 += `<th colspan="5" style="border-bottom:3px solid #ff9800;">暑${p.label}</th>`; });
    h1 += '<th rowspan="2" style="background:#e65100;">暑<br>真实</th><th rowspan="2" style="background:#4a148c;">暑<br>预估</th>';
    autumnPeriods.forEach(p => { h1 += `<th colspan="${p.slots.length}" style="border-bottom:3px solid #42a5f5;">秋${p.label}</th>`; });
    h1 += '<th rowspan="2" style="background:#0d47a1;">秋<br>真实</th><th rowspan="2" style="background:#4a148c;">秋<br>预估</th><th rowspan="2">暑<br>小组</th><th rowspan="2">暑<br>素养</th><th rowspan="2">秋<br>小组</th><th rowspan="2">秋<br>素养</th><th rowspan="2">总<br>班型</th></tr><tr>';
    summerPeriods.forEach(p => { slots.forEach(s => { h1 += `<th>${s}</th>`; }); });
    autumnPeriods.forEach(p => { p.slots.forEach(s => { h1 += `<th>${s}</th>`; }); });
    h1 += '</tr>';
    document.getElementById('capacityHead').innerHTML = h1;
    capacityHeadSignature = headSignature;
  }

  const capacityStats = getCapacityStats();
  const {subjectHeadcount, balanceAdvice} = capacityStats;

  const teacherMap = {};
  capacityStats.summaries.forEach(c => {
    if (subjectFilter && c.subject !== subjectFilter) return;
    if (campusFilter && c.campus !== campusFilter) return;
    if (!teacherMap[c.teacher]) {
      teacherMap[c.teacher] = {subject:c.subject, grades:new Set(), classTypes:new Set(), summerSmall:0, summerQuality:0, autumnSmall:0, autumnQuality:0, classes:{}};
    }
    const info = teacherMap[c.teacher];
    if (c.grade) info.grades.add(c.grade);
    if (c.classTypeKey) info.classTypes.add(c.classTypeKey);
    if (c.season === '暑假') {
      if (c.classType === '小组') info.summerSmall++;
      if (c.classType === '素养') info.summerQuality++;
    } else {
      if (c.classType === '小组') info.autumnSmall++;
      if (c.classType === '素养') info.autumnQuality++;
    }
    if (c.slot) {
      const key = `${c.season}|${c.period}|${c.slot}`;
      if (!info.classes[key]) info.classes[key] = [];
      info.classes[key].push({
        id: c.id,
        name: c.name,
        campus: c.shortCampus,
        count: c.count,
        type: c.classType,
        isPreset: c.isPreset,
        fullName: c.fullName
      });
    }
  });

  const sorted = Object.entries(teacherMap)
    .filter(([name]) => !teacherSearch || name.includes(teacherSearch))
    .sort((a,b) => (a[1].subject||'').localeCompare(b[1].subject||'') || a[0].localeCompare(b[0]));
  const teacherCountBySubject = sorted.reduce((acc, [_, item]) => {
    acc[item.subject || ''] = (acc[item.subject || ''] || 0) + 1;
    return acc;
  }, {});

  let bodyHtml = '';
  let lastSubject = '';
  sorted.forEach(([name, info]) => {
    if (info.subject !== lastSubject) {
      lastSubject = info.subject;
      const autumnCols = autumnPeriods.reduce((sum, p) => sum + p.slots.length, 0);
      const colSpan = 3 + summerPeriods.length*5 + 2 + autumnCols + 2 + 5;
      const hc = subjectHeadcount[lastSubject] || '—';
      const currentTeacherCount = teacherCountBySubject[lastSubject || ''] || 0;
      const hcNum = typeof hc === 'number' ? hc : parseInt(hc, 10);
      const diff = Number.isFinite(hcNum) ? currentTeacherCount - hcNum : 0;
      const diffLabel = Number.isFinite(hcNum)
        ? (diff > 0 ? `<span style="color:#2e7d32;">+${diff} 富余</span>` : diff < 0 ? `<span style="color:#c62828;">${diff} 缺口</span>` : '<span style="color:#666;">刚好</span>')
        : '<span style="color:#999;">暂无建议</span>';
      let adviceHtml = '';
      if (balanceAdvice[lastSubject]) {
        const a = balanceAdvice[lastSubject];
        adviceHtml = ` <span style="color:#e65100;font-weight:normal;font-size:11px;margin-left:12px;">⚠ ${escapeHtml(a.peakSlot)}段${a.peakCount}班过多，${escapeHtml(a.lowSlot)}段仅${a.lowCount}班，建议调${a.diff > 4 ? '3-4' : '1-2'}班到低峰时段</span>`;
      }
      bodyHtml += `<tr class="subject-divider"><td colspan="${colSpan}">${escapeHtml(lastSubject || '未分类')} &nbsp;|&nbsp; 当前: <b>${currentTeacherCount}人</b> &nbsp;|&nbsp; 建议编制: <b>${escapeHtml(hc)}人</b> &nbsp;|&nbsp; ${diffLabel}${adviceHtml}</td></tr>`;
    }
    let summerTotal = 0, autumnTotal = 0, summerReal = 0, autumnReal = 0;
    let rowHtml = `<td class="teacher-name capacity-subject-cell">${escapeHtml(info.subject)}</td><td class="teacher-name" style="font-weight:600;">${escapeHtml(name)}</td>`;
    rowHtml += `<td class="teacher-name" style="font-size:10px;color:#888;">${escapeHtml([...info.grades].join('/'))}</td>`;

    // 暑假
    summerPeriods.forEach(p => {
      slots.forEach(s => {
        const key = `暑假|${p.period}|${s}`;
        const cls = info.classes[key] || [];
        summerTotal += cls.length;
        summerReal += cls.filter(c => !c.isPreset).length;
        rowHtml += renderCapCell(cls, name, '暑假', p.period, s);
      });
    });
    rowHtml += `<td style="font-weight:700;color:#e65100;font-size:13px;">${summerReal}</td>`;
    rowHtml += `<td style="font-weight:700;color:#7b1fa2;font-size:13px;">${summerTotal}</td>`;

    // 秋季
    autumnPeriods.forEach(p => {
      p.slots.forEach(s => {
        const key = `秋季|${p.period}|${s}`;
        const cls = info.classes[key] || [];
        autumnTotal += cls.length;
        autumnReal += cls.filter(c => !c.isPreset).length;
        rowHtml += renderCapCell(cls, name, '秋季', p.period, s);
      });
    });
    rowHtml += `<td style="font-weight:700;color:#1565c0;font-size:13px;">${autumnReal}</td>`;
    rowHtml += `<td style="font-weight:700;color:#7b1fa2;font-size:13px;">${autumnTotal}</td>`;
    rowHtml += `<td style="color:#666;">${info.summerSmall}</td>`;
    rowHtml += `<td style="color:#666;">${info.summerQuality}</td>`;
    rowHtml += `<td style="color:#666;">${info.autumnSmall}</td>`;
    rowHtml += `<td style="color:#666;">${info.autumnQuality}</td>`;
    rowHtml += `<td style="font-weight:700;font-size:13px;">${info.classTypes.size}</td>`;
    bodyHtml += `<tr data-cap-teacher="${escapeAttr(name)}">${rowHtml}</tr>`;
  });
  document.getElementById('capacityBody').innerHTML = bodyHtml;

  // 渲染校区颜色图例
  const legendHtml = Object.entries(campusColors).map(([name, color]) =>
    `<span style="display:inline-flex;align-items:center;margin-left:6px;"><span style="display:inline-block;width:3px;height:14px;background:${color.border};border-radius:1px;margin-right:3px;"></span>${escapeHtml(name)}</span>`
  ).join('');
  const legendEl = document.getElementById('campusColorLegend');
  if (legendEl) legendEl.innerHTML = legendHtml;
  capacityRenderSignature = renderSignature;
}

function capCellDataAttrs(teacher, season, period, slot) {
  return `data-cap-cell="1" data-cap-teacher="${escapeAttr(teacher)}" data-cap-season="${escapeAttr(season)}" data-cap-period="${escapeAttr(period)}" data-cap-slot="${escapeAttr(slot)}"`;
}

function renderCapCell(cls, teacher, season, period, slot) {
  const dropData = escapeAttr(JSON.stringify({teacher, season, period, slot}));
  const day = period && period.startsWith('周') ? period : '每天';
  const prefill = escapeAttr(JSON.stringify({teacher, season, period, slot, day}));
  const editable = canEditNow();
  const cellAttrs = capCellDataAttrs(teacher, season, period, slot);
  if (cls.length === 0) {
    return editable
      ? `<td class="empty-slot cap-drop-target" ${cellAttrs} data-drop="${dropData}" data-cap-action="insert" data-prefill="${prefill}" title="点击插空排课">+</td>`
      : `<td class="empty-slot" ${cellAttrs} title="当前流程状态下不可插空排课">·</td>`;
  }
  if (cls.length === 1) {
    const c = cls[0];
    const color = getCampusColor(c.campus);
    const typeTag = c.type ? `<span style="background:#fff;border-radius:2px;padding:0 3px;font-size:9px;color:#666;border:1px solid #e0e0e0;">${escapeHtml(c.type)}</span>` : '';
    const dragData = escapeAttr(JSON.stringify({courseId: c.id, teacher, season, period, slot}));
    const dragAttrs = editable ? `data-drop="${dropData}" draggable="true" data-drag="${dragData}" data-cap-draggable="1"` : '';
    return `<td ${cellAttrs} ${dragAttrs} style="padding:5px 4px;cursor:${editable ? 'grab' : 'default'};min-width:90px;border-left:3px solid ${color.border};background:${color.bg};text-align:center;" title="${escapeAttr(`${c.fullName || c.name}\n校区: ${c.campus}\n人数: ${c.count}\n${c.type||''}${editable ? '\n拖拽可移动' : ''}`)}">
      <div style="font-weight:600;white-space:nowrap;font-size:10px;color:#333;">${escapeHtml(c.name)}</div>
      <div style="font-size:10px;color:${color.border};margin-top:1px;font-weight:500;">${escapeHtml(c.campus)}</div>
      <div style="font-size:10px;color:#888;margin-top:1px;">${escapeHtml(c.count)}人 ${typeTag}</div>
    </td>`;
  }
  const inner = cls.map(c => {
    const color = getCampusColor(c.campus);
    const typeTag = c.type ? ` [${c.type}]` : '';
    const dragData = escapeAttr(JSON.stringify({courseId: c.id, teacher, season, period, slot}));
    const dragAttrs = editable ? `draggable="true" data-drag="${dragData}" data-cap-draggable="1"` : '';
    return `<div style="border-left:3px solid ${color.border};padding:2px 5px;margin:2px 0;font-size:10px;background:${color.bg};text-align:center;cursor:${editable ? 'grab' : 'default'};border-radius:3px;" ${dragAttrs}>
      <div style="font-weight:600;color:#333;">${escapeHtml(c.name)}</div>
      <div style="color:${color.border};font-weight:500;">${escapeHtml(c.campus)} | ${escapeHtml(c.count)}人${escapeHtml(typeTag)}</div>
    </div>`;
  }).join('');
  const dropAttrs = editable ? `data-drop="${dropData}"` : '';
  return `<td ${cellAttrs} style="background:#fff5f5;padding:3px;min-width:90px;border-left:3px solid #f44336;text-align:center;" title="${escapeAttr('冲突! ' + cls.map(c=>c.name+' ['+c.campus+'] '+c.count+'人').join('\n'))}" ${dropAttrs}>
    ${inner}
  </td>`;
}

document.getElementById('capacityBody')?.addEventListener('click', function(e) {
  const cell = e.target.closest('[data-cap-action="insert"][data-prefill]');
  if (!cell || !this.contains(cell)) return;
  openNewCourseModal(parseDatasetJson(cell.dataset.prefill));
});
document.getElementById('capacityBody')?.addEventListener('dragstart', function(e) {
  const el = e.target.closest('[data-cap-draggable="1"][data-drag]');
  if (!el || !this.contains(el)) return;
  capDragStart(e);
});
document.getElementById('capacityBody')?.addEventListener('dragover', function(e) {
  const target = e.target.closest('[data-drop]');
  if (!target || !this.contains(target)) return;
  capDragOver(e);
});
document.getElementById('capacityBody')?.addEventListener('dragleave', function(e) {
  const target = e.target.closest('[data-drop]');
  if (!target || !this.contains(target)) return;
  capDragLeave(e);
});
document.getElementById('capacityBody')?.addEventListener('drop', function(e) {
  const target = e.target.closest('[data-drop]');
  if (!target || !this.contains(target)) return;
  capDrop(e);
});

// === 产能表拖拽功能 ===
function capDragStart(e) {
  if (!canEditNow()) return;
  const el = e.target.closest('[data-drag]');
  if (!el) return;
  const data = JSON.parse(el.dataset.drag);
  e.dataTransfer.setData('text/plain', JSON.stringify(data));
  e.dataTransfer.effectAllowed = 'move';
  el.style.opacity = '0.5';
  setTimeout(() => { el.style.opacity = ''; }, 300);
}

function capDragOver(e) {
  if (!canEditNow()) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const td = e.target.closest('td');
  if (td) td.style.outline = '2px solid #1a237e';
}

function capDragLeave(e) {
  const td = e.target.closest('td');
  if (td) td.style.outline = '';
}

async function capDrop(e) {
  if (!canEditNow()) {
    showToast('当前流程状态下不可拖拽调整');
    return;
  }
  e.preventDefault();
  const td = e.target.closest('td');
  if (td) td.style.outline = '';

  const raw = e.dataTransfer.getData('text/plain');
  if (!raw) return;
  const source = JSON.parse(raw);

  // 获取目标信息
  const targetEl = e.target.closest('[data-drop]');
  if (!targetEl) return;
  const target = JSON.parse(targetEl.dataset.drop);

  // 不能拖到自己原来的位置
  if (source.teacher === target.teacher && source.season === target.season && source.period === target.period && source.slot === target.slot) return;

  const courseId = source.courseId;
  const sourceCourse = findCourse(courseId);
  if (!sourceCourse) return;

  // 检查目标时段是否已有课
  const targetCourse = courses.find(c => c.teacher === target.teacher && c.season === target.season && c.period === target.period && c.slot === target.slot);

  if (targetCourse) {
    // 交换模式
    const updates1 = {}, updates2 = {};
    if (source.teacher !== target.teacher) { updates1.teacher = target.teacher; updates2.teacher = source.teacher; }
    if (source.slot !== target.slot) { updates1.slot = target.slot; updates2.slot = source.slot; }
    if (source.period !== target.period) { updates1.period = target.period; updates2.period = source.period; }
    const batchUpdates = [
      {id: courseId, fields: updates1},
      {id: targetCourse.id, fields: updates2}
    ];
    if (!(await confirmSundayAfternoonBatch(batchUpdates))) return;
    const ok = await confirmAction({
      title: '产能表拖拽交换',
      message: `交换课程？\n「${sourceCourse.name}」→ ${target.teacher} ${target.period} ${target.slot}段\n「${targetCourse.name}」→ ${source.teacher} ${source.period} ${source.slot}段`,
      confirmText: '确认交换',
    });
    if (!ok) return;

    capUndoStack.push([
      {courseId: courseId, teacher: source.teacher, slot: source.slot, period: source.period},
      {courseId: targetCourse.id, teacher: target.teacher, slot: target.slot, period: target.period}
    ]);

    setSyncStatus('saving');
    try {
      const res = await apiFetch(`${API_BASE}/api/courses/batch`, {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({updates: batchUpdates, reason: defaultActionReason('产能表拖拽交换'), source: 'capacity_drag'})
      });
      const data = await res.json();
      if (await handleVersionConflict(res, data)) { capUndoStack.pop(); updateUndoBtn(); return; }
      if (!res.ok || data.error) {
        setSyncStatus('');
        capUndoStack.pop();
        showMutationIssue('交换失败', data, [
          ['原课程', conflictCourseText(sourceCourse)],
          ['目标课程', conflictCourseText(targetCourse)],
          ['交换目标', `${target.teacher} ${target.period} ${target.slot}段`],
        ]);
        return;
      }
    applyResponseVersion(res);
    mergeLocalCourses(data.courses || []);
      setSyncStatus('saved');
      showToast('已交换');
      updateUndoBtn();
      renderAll();
    } catch(err) { setSyncStatus(''); showToast('交换失败: 网络错误'); capUndoStack.pop(); }
    return;
  }

  // 普通移动（目标为空）
  const updates = {};
  if (source.teacher !== target.teacher) updates.teacher = target.teacher;
  if (source.slot !== target.slot) updates.slot = target.slot;
  if (source.period !== target.period) updates.period = target.period;
  if (Object.keys(updates).length === 0) return;
  if (!(await confirmSundayAfternoonIfNeeded(sourceCourse, updates))) return;

  capUndoStack.push([
    {courseId: courseId, teacher: source.teacher, slot: source.slot, period: source.period}
  ]);

  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/courses/${courseId}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...updates, reason: defaultActionReason('产能表拖拽移动'), source: 'capacity_drag'})
    });
    const updated = await res.json();
    if (await handleVersionConflict(res, updated)) { capUndoStack.pop(); updateUndoBtn(); return; }
    if (updated.error) {
      setSyncStatus('');
      capUndoStack.pop();
      showMutationIssue('移动失败', updated, [
        ['移动课程', conflictCourseText(sourceCourse)],
        ['目标位置', `${target.teacher} ${target.period} ${target.slot}段`],
      ]);
      return;
    }
    applyResponseVersion(res);
    mergeLocalCourses([updated]);
    setSyncStatus('saved');
    const desc = [];
    if (source.teacher !== target.teacher) desc.push(`教师: ${source.teacher} → ${target.teacher}`);
    if (source.slot !== target.slot) desc.push(`时段: ${source.slot} → ${target.slot}`);
    if (source.period !== target.period) desc.push(`期数: ${source.period} → ${target.period}`);
    showToast('已移动: ' + desc.join(', '));
    updateUndoBtn();
    renderAll();
  } catch(err) {
    setSyncStatus('');
    showToast('移动失败: 网络错误');
    capUndoStack.pop();
  }
}

function updateUndoBtn() {
  const btn = document.getElementById('capUndoBtn');
  if (btn) {
    btn.disabled = capUndoStack.length === 0 || !canEditNow();
    btn.textContent = capUndoStack.length > 0 ? `↩ 撤销 (${capUndoStack.length})` : '↩ 撤销拖拽';
    btn.title = canEditNow() ? '' : '当前流程状态下不可撤销拖拽';
  }
}

async function capUndo() {
  if (!canEditNow()) {
    showToast('当前流程状态下不可撤销');
    return;
  }
  if (capUndoStack.length === 0) return;
  const entry = capUndoStack.pop();
  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/courses/batch`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({updates: entry.map(item => ({
        id: item.courseId,
        fields: {teacher: item.teacher, slot: item.slot, period: item.period}
      })), reason: defaultActionReason('撤销拖拽'), source: 'capacity_drag_undo'})
    });
    const data = await res.json();
    if (await handleVersionConflict(res, data)) { capUndoStack.push(entry); updateUndoBtn(); return; }
    if (!res.ok || data.error) throw new Error(data.error || 'undo failed');
      applyResponseVersion(res);
      mergeLocalCourses(data.courses || []);
    setSyncStatus('saved');
    showToast('已撤销');
    updateUndoBtn();
    renderAll();
  } catch(err) {
    setSyncStatus('');
    capUndoStack.push(entry);
    updateUndoBtn();
    showToast('撤销失败');
  }
}

function normalizeConflictGroup(raw, type) {
  if (!Array.isArray(raw)) return raw;
  const first = raw[0] || {};
  return {
    type,
    label: type === 'teacher' ? (first.teacher || '') : `${roomShortName(first.room || '', first.campus || '')} · ${shortCampus(first.campus || '')}`,
    teacher: first.teacher || '',
    room: first.room || '',
    campus: first.campus || '',
    season: first.season || '',
    period: first.period || '',
    slot: first.slot || '',
    day: first.day || '',
    audience: type === 'teacher' ? '主管' : '店长',
    cross: raw.some(c => c.related || c.dept_label),
    classes: raw,
    suggestions: [],
  };
}

function courseSubject(c) {
  return String((c && c.subject) || '').trim();
}

function courseBand(c) {
  const raw = String((c && (c.classType || c.level)) || '').trim();
  if (['A','B','C'].includes(raw)) return raw;
  return getClassLetter(String((c && c.name) || ''));
}

function courseLabel(c) {
  return [c?.code, c?.name].filter(Boolean).join(' ') || String(c?.id ?? '');
}

function groupCourseValues(groups, getter) {
  return [...new Set(groups.flatMap(g => (g.classes || []).map(getter)).filter(Boolean))].sort();
}

function setSelectOptionsPreserve(id, values, labeler = v => v) {
  const el = document.getElementById(id);
  if (!el) return '';
  const current = el.value;
  el.innerHTML = '<option value="">全部</option>' + values.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(labeler(v))}</option>`).join('');
  el.value = values.includes(current) ? current : '';
  return el.value;
}

function suggestionMoves(s) {
  const moves = [];
  const plan = Array.isArray(s.plan) ? s.plan : [];
  plan.forEach(step => {
    if (step.course_id !== undefined && step.course_id !== null && step.to_slot) {
      moves.push({id: String(step.course_id), toSlot: step.to_slot, fromSlot: step.from_slot || ''});
    }
  });
  if (!moves.length && s.category === 'teacher_time' && s.course_id !== undefined && s.target_slot) {
    moves.push({id: String(s.course_id), toSlot: s.target_slot});
  }
  if (s.category === 'coordinated_swap') {
    if (s.course_id !== undefined && s.target_slot) moves.push({id: String(s.course_id), toSlot: s.target_slot});
    if (s.swap_with_id !== undefined && s.swap_target_slot) moves.push({id: String(s.swap_with_id), toSlot: s.swap_target_slot});
  }
  const seen = new Set();
  return moves.filter(move => {
    if (!move.id || !move.toSlot || seen.has(move.id)) return false;
    seen.add(move.id);
    return true;
  });
}

function courseSuiteCompatible(target, candidate) {
  if (!target || !candidate) return false;
  if (target.campus !== candidate.campus || target.season !== candidate.season || target.period !== candidate.period) return false;
  if (String(target.day || '') !== String(candidate.day || '')) return false;
  if (getActualGrade(target) !== getActualGrade(candidate)) return false;
  const aSub = courseSubject(target);
  const bSub = courseSubject(candidate);
  if (!SUITE_SUBJECTS.includes(aSub) || !SUITE_SUBJECTS.includes(bSub)) return false;
  if (['双语','益智'].includes(aSub) && ['双语','益智'].includes(bSub)) {
    const aBand = courseBand(target);
    const bBand = courseBand(candidate);
    return !aBand || !bBand || aBand === bBand;
  }
  return true;
}

function virtualCoursesForSuggestion(s) {
  const moveMap = new Map(suggestionMoves(s).map(move => [move.id, move]));
  return courses.filter(isActiveCourse).map(c => {
    const move = moveMap.get(String(c.id));
    return move ? {...c, slot: move.toSlot, timeRange: currentSlotLabels[move.toSlot] || c.timeRange || ''} : c;
  });
}

function renderSuiteImpactFlow(moves, virtualCourses) {
  if (!moves.length) {
    return `<div class="suite-impact-flow">
      <div class="suite-impact-title">影响班级流向</div>
      <div class="suite-preview-note" style="border-top:0;padding:0;background:transparent;">该建议不改变课程时间，主要复核换老师/换教室后套班是否仍完整。</div>
    </div>`;
  }
  const rows = moves.slice(0, 5).map(move => {
    const before = findCourse(move.id) || {};
    const after = virtualCourses.find(c => String(c.id) === String(move.id)) || before;
    const fromSlot = move.fromSlot || before.slot || '';
    const toSlot = move.toSlot || after.slot || '';
    const title = [courseSubject(before), courseBand(before), before.teacher].filter(Boolean).join(' · ');
    return `<div class="suite-impact-step">
      <div class="suite-impact-node">
        <b>${escapeHtml(courseLabel(before))}</b>
        <span>${escapeHtml(title || '原课程')} · ${escapeHtml(fromSlot || '-')}段</span>
      </div>
      <div class="suite-impact-arrow">→</div>
      <div class="suite-impact-node after">
        <b>${escapeHtml(toSlot || '-')}段 ${escapeHtml(currentSlotLabels[toSlot] || '')}</b>
        <span>${escapeHtml(shortCampus(after.campus || before.campus || ''))} · ${escapeHtml(after.room || before.room || '')}</span>
      </div>
    </div>`;
  }).join('');
  const extra = moves.length > 5 ? `<div class="suite-preview-note" style="border-top:0;padding:0;background:transparent;">另有 ${escapeHtml(moves.length - 5)} 门联动课程未展开，按左侧步骤复核。</div>` : '';
  return `<div class="suite-impact-flow">
    <div class="suite-impact-title">影响班级流向</div>
    ${rows}${extra}
  </div>`;
}

function renderSuitePreview(group, s) {
  if (group.type !== 'teacher') return '';
  const moves = suggestionMoves(s);
  const targetId = s.course_id !== undefined && s.course_id !== null
    ? String(s.course_id)
    : (moves[0]?.id || String(group.classes?.[0]?.id ?? ''));
  const target = findCourse(targetId) || (group.classes || []).find(c => String(c.id) === targetId) || group.classes?.[0];
  if (!target || !SUITE_SUBJECTS.includes(courseSubject(target))) return '';
  if (s.category === 'low_enrollment_release') {
    return `<div class="suite-preview">
      <div class="suite-preview-head">
        <span class="suite-preview-title">套班影响预览</span>
        <span class="suite-preview-meta">需复核</span>
      </div>
      <div class="suite-preview-note">该方案涉及取消/合并低人数班释放教师，需要主管确认最终保留班级后再生成完整套班时间表。</div>
    </div>`;
  }
  const virtualCourses = virtualCoursesForSuggestion(s);
  const moveIds = new Set(moves.map(move => move.id));
  const targetAfter = virtualCourses.find(c => String(c.id) === targetId) || target;
  const context = virtualCourses
    .filter(c => courseSuiteCompatible(targetAfter, c))
    .filter(c => SUITE_SUBJECTS.includes(courseSubject(c)))
    .sort((a, b) => (
      (SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)) ||
      (SUITE_SUBJECTS.indexOf(courseSubject(a)) - SUITE_SUBJECTS.indexOf(courseSubject(b))) ||
      courseLabel(a).localeCompare(courseLabel(b))
    ));
  if (!context.length) return '';
  const grade = getActualGrade(targetAfter) || '年级';
  const band = courseBand(targetAfter);
  const coveredSubjects = [...new Set(context.map(courseSubject).filter(Boolean))];
  const occupiedSlots = [...new Set(context.map(c => c.slot).filter(Boolean))].length;
  const subjectStrip = SUITE_SUBJECTS.map(subject => {
    const on = coveredSubjects.includes(subject);
    return `<span class="suite-subject-pill ${on ? 'on' : ''}">${escapeHtml(subject)}</span>`;
  }).join('');
  const slotsHtml = SLOT_ORDER.map(slot => {
    const slotCourses = context.filter(c => c.slot === slot);
    const subjectCounts = {};
    slotCourses.forEach(c => { subjectCounts[courseSubject(c)] = (subjectCounts[courseSubject(c)] || 0) + 1; });
    const chips = slotCourses.map(c => {
      const moved = moveIds.has(String(c.id));
      const sameSubjectConflict = subjectCounts[courseSubject(c)] > 1;
      const cls = ['suite-chip', moved ? 'moved' : '', sameSubjectConflict ? 'conflict' : ''].filter(Boolean).join(' ');
      return `<span class="${cls}" title="${escapeAttr(courseLabel(c))}">
        <span class="suite-chip-subject">${escapeHtml(courseSubject(c))}</span>${escapeHtml(courseBand(c) || '')}
        <br><span>${escapeHtml(c.teacher || '')}</span>
      </span>`;
    }).join('');
    return `<div class="suite-slot ${slotCourses.some(c => moveIds.has(String(c.id))) ? 'changed' : ''}">
      <div class="suite-slot-head"><span>${escapeHtml(slot)}段</span><span>${escapeHtml(currentSlotLabels[slot] || '')}</span></div>
      ${chips || '<div class="suite-empty">空</div>'}
    </div>`;
  }).join('');
  const movedNote = moves.length ? `高亮为本建议移动课程，共 ${moves.length} 门` : '该建议不改变课程时间，用于复核当前套班是否保持完整';
  return `<div class="suite-preview">
    <div class="suite-preview-head">
      <span class="suite-preview-title">调整后套班时间表</span>
      <span class="suite-preview-meta">${escapeHtml(shortCampus(targetAfter.campus || ''))} · ${escapeHtml(grade)}${band ? ` · ${escapeHtml(band)}班型` : ''}</span>
    </div>
    <div class="suite-preview-overview">
      <div class="suite-kpi"><b>${escapeHtml(coveredSubjects.length)}</b><span>覆盖科目</span></div>
      <div class="suite-kpi"><b>${escapeHtml(context.length)}</b><span>套班班级</span></div>
      <div class="suite-kpi"><b>${escapeHtml(moves.length || occupiedSlots)}</b><span>${moves.length ? '联动调整' : '占用时段'}</span></div>
    </div>
    <div class="suite-subject-strip">${subjectStrip}</div>
    <div class="suite-preview-grid">${slotsHtml}</div>
    ${renderSuiteImpactFlow(moves, virtualCourses)}
    <div class="suite-preview-note">${escapeHtml(movedNote)}；若同一时段出现红色，表示仍需主管协调避免家长二选一。</div>
  </div>`;
}

function renderSuggestionBody(group, s) {
  const preview = renderSuitePreview(group, s);
  const validation = renderSuggestionValidation(s);
  const roomPlan = renderRoomPlan(s);
  const releaseEvaluation = renderReleaseEvaluation(s);
  const details = [
    renderSuggestionReasons(s.detail || ''),
    renderSuggestionPlan(s),
    renderSuggestionRoute(s),
  ].filter(Boolean).join('');
  const content = `<div>
    <b>${escapeHtml(s.title || '')}</b>
    ${renderSuggestionMobileSummary(s)}
    ${renderSuggestionMetrics(s)}
    ${renderSuggestionScore(s)}
    ${details ? `<details class="suggestion-detail-toggle"><summary>建议理由与联动步骤</summary><div class="suggestion-detail-body">${details}</div></details>` : ''}
    ${renderSuggestionAction(s)}
  </div>`;
  const visual = [validation, preview, roomPlan, releaseEvaluation].filter(Boolean).join('');
  return visual ? `<div class="suggestion-body">${content}<div>${visual}</div></div>` : content;
}

function defaultVisibleSuggestions(suggestions) {
  return suggestions.slice(0, 3);
}

function conflictGroupPriority(group) {
  const suggestions = group.suggestions || [];
  if (suggestions.length) {
    return Math.min(...suggestions.map(s => suggestionCategoryRank(s.category)));
  }
  if (group.type === 'teacher') return 2;
  if (group.cross) return 3;
  return 4;
}

function renderConflictFilterSummary(stats) {
  const el = document.getElementById('conflictFilterSummary');
  if (!el) return;
  const chips = [
    `<span class="active">显示 ${escapeHtml(stats.visible)} / ${escapeHtml(stats.total)}</span>`,
    `<span>教师 ${escapeHtml(stats.teacher)}</span>`,
    `<span>教室 ${escapeHtml(stats.room)}</span>`,
  ];
  if (stats.cross) chips.push(`<span>跨部门 ${escapeHtml(stats.cross)}</span>`);
  (stats.filters || []).forEach(item => chips.push(`<span class="active">${escapeHtml(item)}</span>`));
  if (stats.loading) chips.push('<span>建议生成中</span>');
  el.innerHTML = chips.join('');
}

function conflictStatusKeyForGroup(g) {
  return `${g.type}|${g.label}|${g.season}|${g.period}|${g.day || ''}|${g.slot}`;
}

function renderConflictSuggestions(group, statusKey) {
  const suggestions = group.suggestions || [];
  if (!suggestions.length) {
    if (group._suggestionsLoading) {
      return '<div class="conflict-suggestions"><div class="suggestion-empty">正在生成主管/店长处理建议，冲突列表可先查看和筛选...</div></div>';
    }
    const label = group.type === 'teacher' ? '暂无低风险自动建议，建议主管人工复核套班和教师产能。' : '暂无可用空教室建议，请店长线下核实临时教室。';
    return `<div class="conflict-suggestions"><div class="suggestion-empty">${escapeHtml(label)}</div></div>`;
  }
  const key = statusKey || `${group.type}|${group.label}|${group.season}|${group.period}|${group.day || ''}|${group.slot}`;
  const expanded = expandedSuggestionGroups.has(key);
  const visibleSuggestions = expanded ? suggestions : defaultVisibleSuggestions(suggestions);
  const hiddenCount = Math.max(0, suggestions.length - visibleSuggestions.length);
  return `<div class="conflict-suggestions">
    <div class="suggestion-head">
      <span>${group.type === 'teacher' ? '主管处理建议' : '店长处理建议'}</span>
      <span class="suggestion-head-count">${escapeHtml(visibleSuggestions.length)}/${escapeHtml(suggestions.length)} 条</span>
    </div>
    ${visibleSuggestions.map(s => `
      <div class="suggestion-row ${['需复核','需协调'].includes(s.risk) ? 'review' : ''}">
        <div class="suggestion-meta">
          <span class="suggestion-risk ${escapeAttr(String(s.risk || '').replace(/[^\w\u4e00-\u9fa5]/g, ''))}">${escapeHtml(s.risk || '')}</span>
          <span class="suggestion-kind">${escapeHtml(suggestionCategoryLabel(s.category))}</span>
        </div>
        ${renderSuggestionBody(group, s)}
      </div>
    `).join('')}
    ${hiddenCount > 0 || expanded ? `<button type="button" class="suggestion-more" data-conflict-action="toggle-suggestions" data-status-key="${escapeAttr(key)}">${expanded ? '收起建议' : `展开其余 ${hiddenCount} 条建议`}</button>` : ''}
	  </div>`;
}

function metricClass(level) {
  if (level === 'good' || level === '低') return 'good';
  if (level === 'warn' || level === '中') return 'warn';
  if (level === 'bad' || ['需复核','需协调'].includes(level)) return 'bad';
  return '';
}

function renderSuggestionMobileSummary(s) {
  const items = [];
  const fatigueLevel = s.travel_level || '';
  if (fatigueLevel) {
    const label = fatigueLevel === 'good' ? '低' : fatigueLevel === 'warn' ? '中' : '高';
    items.push(['疲劳', label]);
  }
  const minutes = Number(s.travel_minutes ?? s.route_travel_minutes ?? 0);
  if (minutes > 0) items.push(['车程', `约${minutes}分钟`]);
  if (s.suite_score !== undefined || s.suite_delta !== undefined) {
    const score = Number(s.suite_score || 0);
    const delta = Number(s.suite_delta || 0);
    items.push(['套班', `${score || '-'}科${delta ? ` ${delta > 0 ? '+' : ''}${delta}` : ''}`]);
  }
  if (Array.isArray(s.plan) && s.plan.length) items.push(['联动', `${s.plan.length}步`]);
  if (['需复核','需协调'].includes(s.risk)) items.push(['处理', '人工确认']);
  if (!items.length) return '';
  return `<div class="suggestion-mobile-summary">${items.slice(0, 4).map(([k, v]) => `
    <div class="suggestion-mobile-pill"><b>${escapeHtml(k)}</b>${escapeHtml(v)}</div>
  `).join('')}</div>`;
}

function renderSuggestionMetrics(s) {
  const chips = [];
  const validation = s.suite_validation || {};
  if (validation.science_score !== undefined) {
    const score = Number(validation.science_score || 0);
    chips.push(`<span class="suggestion-metric ${score >= 85 ? 'good' : score >= 65 ? 'warn' : 'bad'}">方案科学性 ${escapeHtml(score)}/100</span>`);
  }
  if (validation.confidence) {
    chips.push(`<span class="suggestion-metric ${validation.confidence === '高' ? 'good' : validation.confidence === '中' ? 'warn' : 'bad'}">可信度 ${escapeHtml(validation.confidence)}</span>`);
  }
  const fatigueLevel = s.travel_level || '';
  if (fatigueLevel) {
    const label = fatigueLevel === 'good' ? '低' : fatigueLevel === 'warn' ? '中' : '高';
    chips.push(`<span class="suggestion-metric ${metricClass(fatigueLevel)}">教师疲劳 ${label}</span>`);
  }
  const minutes = Number(s.travel_minutes ?? s.route_travel_minutes ?? 0);
  if (minutes > 0) {
    chips.push(`<span class="suggestion-metric ${minutes > 30 ? 'bad' : minutes > 20 ? 'warn' : 'good'}">跨校区约 ${minutes} 分钟</span>`);
  }
  if (s.suite_score !== undefined || s.suite_delta !== undefined) {
    const score = Number(s.suite_score || 0);
    const delta = Number(s.suite_delta || 0);
    const deltaText = delta > 0 ? `+${delta}` : String(delta);
    chips.push(`<span class="suggestion-metric ${delta < 0 ? 'warn' : 'good'}">套班完整度 ${score || '-'}科${delta ? ` (${deltaText})` : ''}</span>`);
  }
  if (s.release_count !== undefined && s.release_threshold !== undefined) {
    chips.push(`<span class="suggestion-metric bad">${escapeHtml(s.release_kind || '低人数')} ${escapeHtml(s.release_count)}/${escapeHtml(s.release_threshold)}</span>`);
  }
  if (['需复核','需协调'].includes(s.risk)) {
    chips.push(`<span class="suggestion-metric bad">需人工协调确认</span>`);
  }
  return chips.length ? `<div class="suggestion-metrics">${chips.join('')}</div>` : '';
}

function validationScoreClass(score) {
  const n = Number(score || 0);
  if (n >= 85) return 'good';
  if (n >= 65) return 'warn';
  return 'bad';
}

function renderRoomPlan(s) {
  if (s.category !== 'room_swap' && !s.room_plan) return '';
  const plan = s.room_plan || {};
  const checks = Array.isArray(s.room_checks) ? s.room_checks : [];
  const steps = Array.isArray(s.room_steps) ? s.room_steps : [];
  const room = plan.room_short || roomShortName(plan.room || s.room || '', plan.campus || s.campus || '') || s.room || '待确认';
  const campus = plan.campus_label || shortCampus(plan.campus || s.campus || '');
  const time = [plan.season, plan.period, plan.day, plan.slot ? `${plan.slot}段` : '', plan.time_label].filter(Boolean).join(' ');
  const course = s.recommended_course || {};
  const courseName = s.course_label || courseLabel(course) || '待选择';
  const shared = plan.shared ? `<span class="room-plan-shared">跨部门共用</span>` : '';
  const targetHtml = `<div class="room-plan-target">
    <div class="room-plan-kpi"><b>${escapeHtml(room)}</b><span>建议教室</span></div>
    <div class="room-plan-kpi"><b>${escapeHtml(courseName)}</b><span>优先移动班级</span></div>
    <div class="room-plan-kpi"><b>${escapeHtml(s.best_count ?? '-')}</b><span>移动班人数</span></div>
  </div>`;
  const checksHtml = checks.length ? `<div class="room-checks">${checks.slice(0, 4).map(check => `
    <div class="room-check ${check.passed ? '' : 'fail'}">
      <b>${escapeHtml(check.item || '')}</b>
      <span>${escapeHtml(check.detail || (check.passed ? '通过' : '需确认'))}</span>
    </div>
  `).join('')}</div>` : '';
  const stepsHtml = steps.length ? `<div class="room-steps">${steps.slice(0, 4).map((step, idx) => `
    <div class="room-step"><i>${idx + 1}</i><span>${escapeHtml(step)}</span></div>
  `).join('')}</div>` : '';
  return `<div class="room-plan">
    <div class="room-plan-head">
      <div>
        <div class="room-plan-title">店长处理路径${shared}</div>
        <div class="suggestion-validation-summary">${escapeHtml(campus)} · ${escapeHtml(time || '当前时段')}</div>
      </div>
      <div class="room-plan-meta">${escapeHtml(s.risk || '需复核')}</div>
    </div>
    ${targetHtml}
    ${checksHtml}
    ${stepsHtml}
  </div>`;
}

function renderReleaseEvaluation(s) {
  const ev = s.release_evaluation;
  if (s.category !== 'low_enrollment_release' || !ev) return '';
  const score = Number(ev.science_score || 0);
  const checks = Array.isArray(ev.checks) ? ev.checks.slice(0, 4) : [];
  const reviewItems = Array.isArray(ev.review_items) ? ev.review_items.slice(0, 5) : [];
  const checksHtml = checks.length ? `<div class="release-checks">${checks.map(check => `
    <div class="release-check ${metricClass(check.level)}">
      <b>${escapeHtml(check.item || '')}</b>
      <span>${escapeHtml(check.detail || '')}</span>
    </div>
  `).join('')}</div>` : '';
  const reviewHtml = reviewItems.length ? `<div class="release-review">${reviewItems.map(item => `
    <div class="release-review-item">${escapeHtml(item)}</div>
  `).join('')}</div>` : '';
  return `<div class="release-eval">
    <div class="release-eval-head">
      <div class="release-score">
        <b>${escapeHtml(score || '-')}</b>
        <span>兜底科学性</span>
      </div>
      <div>
        <div class="release-eval-title">低人数取消/合并评估 · ${escapeHtml(ev.execution_level || '需主管复核')}</div>
        <div class="release-eval-summary">${escapeHtml(ev.summary || '')}</div>
      </div>
    </div>
    <div class="release-kpis">
      <div class="release-kpi"><b>${escapeHtml(ev.release_score ?? '-')}</b><span>释放价值</span></div>
      <div class="release-kpi"><b>${escapeHtml(ev.merge_score ?? '-')}</b><span>合并去向</span></div>
      <div class="release-kpi"><b>${escapeHtml(ev.withdrawal_risk || '高')}</b><span>退班/结转风险</span></div>
    </div>
    ${checksHtml}
    ${reviewHtml}
  </div>`;
}

function renderSuggestionValidation(s) {
  const v = s.suite_validation;
  if (!v || typeof v !== 'object') return '';
  const score = Number(v.science_score ?? 0);
  const checks = Array.isArray(v.system_checks) ? v.system_checks.slice(0, 4) : [];
  const reviewItems = Array.isArray(v.review_items) ? v.review_items.slice(0, 4) : [];
  const teacherImpacts = Array.isArray(v.teacher_impacts) ? v.teacher_impacts.slice(0, 3) : [];
  const kpis = v.coordination_kpis || {};
  const coordinationHtml = v.coordination_summary ? `<div class="suggestion-coordination">
    <div class="suggestion-coordination-title">多科目协调评估</div>
    <div class="suggestion-coordination-summary">${escapeHtml(v.coordination_summary)}</div>
    <div class="suggestion-coordination-kpis">
      <div><b>${escapeHtml(kpis.covered_subject_count ?? v.covered_subjects?.length ?? '-')}</b><span>覆盖科目</span></div>
      <div><b>${escapeHtml(kpis.move_count ?? '-')}</b><span>联动课程</span></div>
      <div><b>${escapeHtml(kpis.teacher_count ?? '-')}</b><span>影响教师</span></div>
      <div><b>${escapeHtml(v.communication_cost || '-')}</b><span>沟通成本</span></div>
    </div>
  </div>` : '';
  const checksHtml = checks.length ? `<div class="suggestion-check-grid">${checks.map(check => `
    <div class="suggestion-check ${check.passed ? '' : 'fail'}">
      <span>${escapeHtml(check.item || '')}</span>
      <b>${check.passed ? '通过' : '需处理'}</b>
    </div>
  `).join('')}</div>` : '';
  const reviewHtml = reviewItems.length ? `<div class="suggestion-review-list">${reviewItems.map(item => `
    <div class="suggestion-review-item">${escapeHtml(item)}</div>
  `).join('')}</div>` : '';
  const teacherHtml = teacherImpacts.length ? `<div class="suggestion-teacher-impact">${teacherImpacts.map(t => {
    const segments = Array.isArray(t.travel_segments) ? t.travel_segments : [];
    const route = segments.length
      ? segments.map(seg => `<span title="${escapeAttr(seg.course || '')}">${escapeHtml([seg.slot ? `${seg.slot}段` : '', seg.campus ? `@${seg.campus}` : ''].filter(Boolean).join(''))}</span>`).join('')
      : `<span>${escapeHtml(t.travel_route || '未识别动线')}</span>`;
    return `<div class="suggestion-teacher-line">
      <b title="${escapeAttr(t.teacher || '')}">${escapeHtml(t.teacher || '老师')}</b>
      <div class="suggestion-teacher-route">${route}</div>
    </div>`;
  }).join('')}</div>` : '';
  return `<div class="suggestion-validation">
    <div class="suggestion-validation-head">
      <div class="suggestion-validation-score ${validationScoreClass(score)}">
        <b>${escapeHtml(score || '-')}</b>
        <span>科学性评分</span>
      </div>
      <div>
        <div class="suggestion-validation-title">系统推演验证 · ${escapeHtml(v.confidence || '需复核')}</div>
        <div class="suggestion-validation-summary">${escapeHtml(v.summary || '')}</div>
      </div>
    </div>
    ${checksHtml}
    ${coordinationHtml}
    ${reviewHtml}
    ${teacherHtml}
  </div>`;
}

function renderSuggestionScore(s) {
  const score = s.priority_score;
  const reasons = Array.isArray(s.score_reasons) ? s.score_reasons : [];
  const tradeoffs = Array.isArray(s.tradeoffs) ? s.tradeoffs : [];
  if (score === undefined && !reasons.length && !tradeoffs.length) return '';
  const lines = [
    ...reasons.slice(0, 3).map(text => `<div class="suggestion-score-line good">推荐：${escapeHtml(text)}</div>`),
    ...tradeoffs.slice(0, 3).map(text => `<div class="suggestion-score-line warn">取舍：${escapeHtml(text)}</div>`),
  ].join('');
  return `<div class="suggestion-score">
    ${score !== undefined ? `<span class="suggestion-score-badge">优先级 ${escapeHtml(score)}/100</span>` : ''}
    ${lines ? `<div class="suggestion-score-list">${lines}</div>` : ''}
  </div>`;
}

function splitSuggestionReasons(detail) {
  return String(detail || '')
    .split(/[。；;]\s*/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function renderSuggestionReasons(detail) {
  const reasons = splitSuggestionReasons(detail);
  if (!reasons.length) return '';
  return `<ul class="suggestion-reasons">${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;
}

function renderSuggestionPlan(s) {
  const plan = Array.isArray(s.plan) ? s.plan : [];
  if (!plan.length) return '';
  return `<div class="suggestion-plan">${plan.map((step, idx) => `
    <div class="suggestion-plan-step">${idx + 1}. ${escapeHtml(step.course_label || `课程${step.course_id || ''}`)}：${escapeHtml(step.from_slot || '原时段')}段 → ${escapeHtml(step.to_slot || '目标时段')}段${step.teacher ? ` · ${escapeHtml(step.teacher)}` : ''}${step.subject ? ` · ${escapeHtml(step.subject)}` : ''}</div>
  `).join('')}</div>`;
}

function routeLevelLabel(level) {
  if (level === 'good') return '动线可接受';
  if (level === 'warn') return '需复核衔接';
  if (level === 'bad') return '不建议常规执行';
  return '动线待复核';
}

function renderRouteSegmentChips(segments, fallback) {
  const validSegments = Array.isArray(segments) ? segments.filter(seg => seg && (seg.slot || seg.campus)) : [];
  if (!validSegments.length && !fallback) return '';
  return validSegments.length
    ? validSegments.map((seg, idx) => {
        const label = `${seg.slot ? `${seg.slot}段` : ''}${seg.campus ? `@${seg.campus}` : ''}`;
        return `${idx ? '<span class="suggestion-route-arrow">→</span>' : ''}<span class="suggestion-route-chip" title="${escapeAttr(seg.course || '')}">${escapeHtml(label)}</span>`;
      }).join('')
    : `<span class="suggestion-route-chip">${escapeHtml(fallback)}</span>`;
}

function renderSuggestionRouteLine(title, routeData) {
  const segments = Array.isArray(routeData.segments) ? routeData.segments : [];
  const fallback = routeData.route || '';
  const segmentHtml = renderRouteSegmentChips(segments, fallback);
  if (!segmentHtml) return '';
  const level = routeData.travel_level || routeData.level || '';
  const halves = Array.isArray(routeData.travel_halves) ? routeData.travel_halves : [];
  const flags = Array.isArray(routeData.travel_flags) ? routeData.travel_flags : [];
  const transitions = Array.isArray(routeData.travel_transitions) ? routeData.travel_transitions : [];
  const halvesHtml = halves.length ? `<div class="suggestion-route-halves">${halves.map(half => `
    <div class="suggestion-route-half">
      <b>${escapeHtml(half.half || '半天')}</b>
      <span>${renderRouteSegmentChips(half.segments, half.route) || escapeHtml(half.route || '未识别')}</span>
    </div>
  `).join('')}</div>` : '';
  const flagHtml = flags.length ? `<div class="suggestion-route-flags">${flags.slice(0, 4).map(flag => `
    <span class="suggestion-route-flag ${metricClass(flag.level)}" title="${escapeAttr(flag.detail || '')}">${escapeHtml(flag.label || '')}</span>
  `).join('')}</div>` : '';
  const transitionHtml = transitions.length ? `<div class="suggestion-route-transitions">${transitions.slice(0, 4).map(t => {
    const label = `${t.from_slot || ''}${t.from_label ? `@${t.from_label}` : ''} → ${t.to_slot || ''}${t.to_label ? `@${t.to_label}` : ''}`;
    const minutes = t.minutes !== undefined && t.minutes !== null ? ` · ${t.minutes}分钟` : '';
    return `<span class="suggestion-route-transition ${metricClass(t.level)}">${escapeHtml(label + minutes)}</span>`;
  }).join('')}</div>` : '';
  return `<div class="suggestion-route-card">
    <div class="suggestion-route-head">
      <span class="suggestion-route-title">${escapeHtml(title)}</span>
      <span class="suggestion-route-status ${metricClass(level)}">${escapeHtml(routeLevelLabel(level))}</span>
    </div>
    <div class="suggestion-route-line">${segmentHtml}</div>
    ${halvesHtml}
    ${transitionHtml}
    ${flagHtml}
  </div>`;
}

function renderSuggestionRoute(s) {
  const routes = Array.isArray(s.travel_routes) ? s.travel_routes : [];
  if (routes.length) {
    const lines = routes.map(r => renderSuggestionRouteLine(r.teacher || '教师动线', {
      ...r,
      segments: r.segments || r.travel_segments,
    })).filter(Boolean).join('');
    return lines ? `<div class="suggestion-route">${lines}</div>` : '';
  }
  if (s.travel_segments || s.travel_route) {
    return `<div class="suggestion-route">${renderSuggestionRouteLine('教师动线', {
      travel_level: s.travel_level,
      route: s.travel_route,
      segments: s.travel_segments,
      travel_halves: s.travel_halves,
      travel_transitions: s.travel_transitions,
      travel_flags: s.travel_flags,
    })}</div>`;
  }
  return '';
}

function renderSuggestionAction(s) {
  const blockedLabel = suggestionActionBlockedLabel(s);
  if (!canApplySuggestion(s)) return blockedLabel ? `<span class="suggestion-action-note">${escapeHtml(blockedLabel)}</span>` : '';
  if (s.category === 'low_enrollment_release' && s.release_course && s.release_course.id !== undefined && s.release_course.id !== null) {
    const releaseId = s.release_course.id;
    return `<div class="suggestion-actions">
      <button class="btn btn-refresh" style="margin-top:6px;padding:3px 8px;font-size:11px;" data-suggestion-action="low-release-merge" data-release-id="${escapeAttr(releaseId)}">评估合并</button>
      <button class="btn" style="margin-top:6px;padding:3px 8px;font-size:11px;background:#fff7ed;color:#92400e;" data-suggestion-action="low-release-cancel" data-release-id="${escapeAttr(releaseId)}">评估取消</button>
    </div>`;
  }
  if (s.category === 'room_swap' && s.course_id !== undefined && s.course_id !== null && s.room) {
    return `<button class="btn btn-refresh" style="margin-top:6px;padding:3px 8px;font-size:11px;" data-suggestion-action="room-swap" data-course-id="${escapeAttr(s.course_id)}" data-room="${escapeAttr(s.room)}">应用换教室</button>`;
  }
  if (s.category === 'teacher_time' && s.course_id !== undefined && s.course_id !== null && s.target_slot) {
    return `<button class="btn btn-refresh" style="margin-top:6px;padding:3px 8px;font-size:11px;" data-suggestion-action="teacher-time" data-course-id="${escapeAttr(s.course_id)}" data-target-slot="${escapeAttr(s.target_slot)}">应用调时段</button>`;
  }
  if (s.category === 'teacher_substitute' && s.course_id !== undefined && s.course_id !== null && s.teacher) {
    return `<button class="btn btn-refresh" style="margin-top:6px;padding:3px 8px;font-size:11px;" data-suggestion-action="teacher-substitute" data-course-id="${escapeAttr(s.course_id)}" data-teacher="${escapeAttr(s.teacher)}">应用换老师</button>`;
  }
  if (s.category === 'coordinated_swap' && s.course_id !== undefined && s.swap_with_id !== undefined && s.target_slot && s.swap_target_slot) {
    return `<button class="btn btn-refresh" style="margin-top:6px;padding:3px 8px;font-size:11px;" data-suggestion-action="coordinated-swap" data-course-id="${escapeAttr(s.course_id)}" data-swap-with-id="${escapeAttr(s.swap_with_id)}" data-target-slot="${escapeAttr(s.target_slot)}" data-swap-target-slot="${escapeAttr(s.swap_target_slot)}">应用联动换课</button>`;
  }
  return '';
}

async function patchSuggestedCourse(courseId, fields, actionName, confirmText) {
  if (!canEditNow()) {
    showToast('当前流程状态下不可调整课程');
    return;
  }
  const course = findCourse(courseId);
  if (!course) {
    showToast('课程不存在，请刷新后重试');
    return;
  }
  const hasChange = Object.entries(fields).some(([key, value]) => String(course[key] ?? '') !== String(value ?? ''));
  if (!hasChange) {
    showToast('课程已是建议状态');
    return;
  }
  if (!(await confirmSundayAfternoonIfNeeded(course, fields))) return;
  const ok = await confirmAction({
    title: actionName,
    message: confirmText,
    confirmText: '确认应用',
  });
  if (!ok) return;
  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/courses/${courseId}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...fields, reason: defaultActionReason(actionName)}),
    });
    const data = await res.json();
    if (await handleVersionConflict(res, data)) return;
    if (!res.ok || data.error) throw new Error(data.error || 'suggestion failed');
    applyResponseVersion(res);
    mergeLocalCourses([data]);
    setSyncStatus('saved');
    showToast(`已${actionName}`);
    renderAll();
  } catch(e) {
    setSyncStatus('');
    showToast(`${actionName}失败`);
  }
}

async function applyRoomSwapSuggestion(courseId, room) {
  const course = findCourse(courseId);
  const label = course ? `${course.code || ''} ${course.name || ''}`.trim() : '该课程';
  await patchSuggestedCourse(courseId, {room}, '应用换教室建议', `确认将「${label}」调整到「${room}」？`);
}

async function applyTeacherTimeSuggestion(courseId, slot) {
  const course = findCourse(courseId);
  const label = course ? `${course.code || ''} ${course.name || ''}`.trim() : '该课程';
  await patchSuggestedCourse(courseId, {slot, timeRange: currentSlotLabels[slot] || ''}, '应用调时段建议', `确认将「${label}」调整到 ${slot}段？`);
}

async function applyTeacherSubstituteSuggestion(courseId, teacher) {
  const course = findCourse(courseId);
  const label = course ? `${course.code || ''} ${course.name || ''}`.trim() : '该课程';
  await patchSuggestedCourse(courseId, {teacher}, '应用换老师建议', `确认将「${label}」授课教师调整为「${teacher}」？`);
}

async function applyCoordinatedSwapSuggestion(courseId, swapWithId, targetSlot, swapTargetSlot) {
  if (!canEditNow()) {
    showToast('当前流程状态下不可联动换课');
    return;
  }
  const source = findCourse(courseId);
  const target = findCourse(swapWithId);
  if (!source || !target) {
    showToast('课程不存在，请刷新后重试');
    return;
  }
  const updates = [
    {id: courseId, fields: {slot: targetSlot, timeRange: currentSlotLabels[targetSlot] || ''}},
    {id: swapWithId, fields: {slot: swapTargetSlot, timeRange: currentSlotLabels[swapTargetSlot] || ''}},
  ];
  if (!(await confirmSundayAfternoonBatch(updates))) return;
  const ok = await confirmAction({
    title: '联动换课复核',
    message: `确认联动换课？\n「${source.code || ''} ${source.name || ''}」→ ${targetSlot}段\n「${target.code || ''} ${target.name || ''}」→ ${swapTargetSlot}段`,
    confirmText: '确认换课',
  });
  if (!ok) return;
  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/courses/batch`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        updates,
        reason: defaultActionReason('应用联动换课建议'),
      }),
    });
    const data = await res.json();
    if (await handleVersionConflict(res, data)) return;
    if (!res.ok || data.error) throw new Error(data.error || 'swap failed');
    applyResponseVersion(res);
    mergeLocalCourses(data.courses || []);
    setSyncStatus('saved');
    showToast('已应用联动换课建议');
    renderAll();
  } catch(e) {
    setSyncStatus('');
    showToast('应用联动换课建议失败');
  }
}

function suggestionCategoryLabel(category) {
  return {
	    teacher_time: '调时段',
	    teacher_substitute: '换老师',
	    coordinated_swap: '联动换课',
	    suite_reflow: '套班重排',
	    low_enrollment_release: '低人数兜底',
	    suite_coordination: '套班复核',
    room_swap: '换教室',
  }[category] || '建议';
}

function normalizeConflictPayload(data) {
  const payload = data || {};
  return {
    teacher: (payload.teacher || []).map(g => normalizeConflictGroup(g, 'teacher')),
    room: (payload.room || []).map(g => normalizeConflictGroup(g, 'room')),
    status: payload.status || {},
    suggestionsReady: payload.suggestions_ready !== false,
  };
}

function getCachedConflictData() {
  if (!conflictDataCache || conflictDataCache.version !== loadedVersion) return null;
  return conflictDataCache.data;
}

async function fetchConflictDataSummary() {
  const requestVersion = loadedVersion;
  const result = await fetchCachedText(`${API_BASE}/api/conflicts?suggestions=0`, 'conflicts-summary');
  const data = normalizeConflictPayload(JSON.parse(result.text));
  if (requestVersion === loadedVersion) {
    conflictDataCache = {version: loadedVersion, data};
    conflictStatusMap = data.status || {};
  }
  return data;
}

function isConflictTabVisible() {
  const tab = document.getElementById('tab-conflicts');
  return !!tab && !tab.classList.contains('hidden');
}

function loadFullConflictDataInBackground() {
  if (conflictFullFetchPromise) return conflictFullFetchPromise;
  const requestVersion = loadedVersion;
  conflictFullFetchPromise = (async () => {
    try {
      const result = await fetchCachedText(`${API_BASE}/api/conflicts`, 'conflicts-full');
      const data = normalizeConflictPayload(JSON.parse(result.text));
      if (requestVersion === loadedVersion) {
        conflictDataCache = {version: loadedVersion, data};
        conflictStatusMap = data.status || {};
        if (isConflictTabVisible()) renderConflicts();
      }
      return data;
    } catch(e) {
      if (isConflictTabVisible()) showToast('冲突建议生成失败，请稍后重试');
      return null;
    } finally {
      conflictFullFetchPromise = null;
    }
  })();
  return conflictFullFetchPromise;
}

async function renderConflicts() {
  const renderSeq = ++conflictRenderSeq;
  const listEl = document.getElementById('conflictList');
  let payload = getCachedConflictData();
  if (!payload && listEl) {
    listEl.innerHTML = '<div style="color:#64748b;background:white;border-radius:8px;padding:16px;">正在加载冲突列表...</div>';
  }
  try {
    if (!payload) payload = await fetchConflictDataSummary();
  } catch(e) {}
  if (renderSeq !== conflictRenderSeq) return;
  let teacherList = payload ? payload.teacher : [];
  let roomList = payload ? payload.room : [];
  const suggestionsLoading = !!(payload && !payload.suggestionsReady);
  if (payload) conflictStatusMap = payload.status || {};
  if (!teacherList.length && !roomList.length) {
    const teacherMap = {};
    const roomMap = {};
    courses.forEach(c => {
      if (!isActiveCourse(c)) return;
      if (c.teacher && c.slot) {
        const key = `${c.teacher}|${c.season}|${c.period}|${c.slot}|${c.day||''}`;
        if (!teacherMap[key]) teacherMap[key] = {type:'teacher', label:c.teacher, teacher:c.teacher, campus:c.campus, season:c.season, period:c.period, slot:c.slot, day:c.day, audience:'主管', classes:[], suggestions:[]};
        teacherMap[key].classes.push(c);
      }
      if (c.room && c.campus && c.slot) {
        const key = `${roomKey(c.campus, c.room) || c.room + '|' + c.campus}|${c.season}|${c.period}|${c.slot}|${c.day||''}`;
        if (!roomMap[key]) roomMap[key] = {type:'room', label:`${roomShortName(c.room, c.campus)} · ${shortCampus(c.campus)}`, room:c.room, campus:c.campus, season:c.season, period:c.period, slot:c.slot, day:c.day, audience:'店长', classes:[], suggestions:[]};
        roomMap[key].classes.push(c);
      }
    });
    relatedRoomCourses.forEach(c => {
      if (!isActiveCourse(c)) return;
      if (c.room && c.campus && c.slot) {
        const key = `${c.room_key || roomKey(c.campus, c.room)}|${c.season}|${c.period}|${c.slot}|${c.day||''}`;
        if (!roomMap[key]) roomMap[key] = {type:'room', label:`${roomShortName(c.room, c.campus)} · ${shortCampus(c.campus)}`, room:c.room, campus:c.campus, season:c.season, period:c.period, slot:c.slot, day:c.day, audience:'店长', classes:[], suggestions:[]};
        roomMap[key].classes.push(c);
      }
    });
    teacherList = Object.values(teacherMap).filter(g => g.classes.length > 1);
    roomList = Object.values(roomMap).filter(g => g.classes.length > 1).map(g => ({...g, cross: g.classes.some(c => c.related || c.dept_label)}));
  }
  if (suggestionsLoading) {
    teacherList = teacherList.map(g => ({...g, _suggestionsLoading: true}));
    roomList = roomList.map(g => ({...g, _suggestionsLoading: true}));
  }
  const campusSelect = document.getElementById('conflictCampus');
  if (campusSelect) {
    const campuses = groupCourseValues([...teacherList, ...roomList], c => c.campus);
    setSelectOptionsPreserve('conflictCampus', campuses, shortCampus);
  }
  setSelectOptionsPreserve('conflictSubject', groupCourseValues([...teacherList, ...roomList], courseSubject));
  setSelectOptionsPreserve('conflictGrade', groupCourseValues([...teacherList, ...roomList], getActualGrade));
  const typeFilter = document.getElementById('conflictType')?.value || '';
  document.querySelectorAll('[data-conflict-quick-type]').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.conflictQuickType || '') === typeFilter);
  });
  const campusFilter = document.getElementById('conflictCampus')?.value || '';
  const subjectFilter = document.getElementById('conflictSubject')?.value || '';
  const gradeFilter = document.getElementById('conflictGrade')?.value || '';
  const search = (document.getElementById('conflictSearch')?.value || '').trim().toLowerCase();
  const nextFilterSignature = [loadedVersion || '', typeFilter, campusFilter, subjectFilter, gradeFilter, search, suggestionsLoading ? 'loading' : 'ready'].join('|');
  if (nextFilterSignature !== conflictFilterSignature) {
    conflictFilterSignature = nextFilterSignature;
    conflictVisibleLimit = 20;
  }
  const all = [...teacherList, ...roomList].filter(g => {
    if (typeFilter === 'teacher' && g.type !== 'teacher') return false;
    if (typeFilter === 'room' && g.type !== 'room') return false;
    if (typeFilter === 'cross' && !g.cross) return false;
    if (campusFilter && !(g.classes || []).some(c => c.campus === campusFilter)) return false;
    if (subjectFilter && !(g.classes || []).some(c => courseSubject(c) === subjectFilter)) return false;
    if (gradeFilter && !(g.classes || []).some(c => getActualGrade(c) === gradeFilter)) return false;
    if (search) {
      const text = [
        g.label, g.teacher, g.room, g.campus,
        ...g.classes.flatMap(c => [c.name, c.teacher, c.room, c.code, c.dept_label, c.subject, getActualGrade(c)]),
        ...(g.suggestions || []).flatMap(s => [s.title, s.detail, s.teacher, s.room])
      ].join(' ').toLowerCase();
      if (!text.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => {
    const typeRank = g => g.type === 'teacher' ? 0 : (g.cross ? 1 : 2);
    return (typeRank(a) - typeRank(b))
      || (conflictGroupPriority(a) - conflictGroupPriority(b))
      || a.label.localeCompare(b.label);
  });
  const visibleAll = all.slice(0, conflictVisibleLimit);
  const hiddenConflictCount = Math.max(0, all.length - visibleAll.length);
  const activeFilters = [];
  if (typeFilter) {
    activeFilters.push({teacher: '教师冲突', room: '教室冲突', cross: '跨部门'}[typeFilter] || typeFilter);
  }
  if (campusFilter) activeFilters.push(`校区：${shortCampus(campusFilter)}`);
  if (subjectFilter) activeFilters.push(`科目：${subjectFilter}`);
  if (gradeFilter) activeFilters.push(`年级：${gradeFilter}`);
  if (search) activeFilters.push(`搜索：${search}`);
  renderConflictFilterSummary({
    visible: all.length,
    total: teacherList.length + roomList.length,
    teacher: teacherList.length,
    room: roomList.length,
    cross: roomList.filter(g => g.cross).length,
    filters: activeFilters,
    loading: suggestionsLoading,
  });

  const summaryEl = document.getElementById('conflictSummary');
  if (summaryEl) {
    summaryEl.innerHTML = [
      `<div class="metric"><b>${teacherList.length}</b><span>教师时间冲突</span></div>`,
      `<div class="metric"><b>${roomList.length}</b><span>教室时间冲突</span></div>`,
      `<div class="metric"><b>${roomList.filter(g => g.cross).length}</b><span>跨部门教室冲突</span></div>`,
    ].join('');
  }

  const visibleKeys = visibleAll.map(conflictStatusKeyForGroup);
  const statusSignature = visibleKeys.map(key => `${key}:${conflictStatusMap[key]?.status || '未处理'}`).join('||');
  const suggestionsSignature = visibleAll.map(g => `${conflictStatusKeyForGroup(g)}:${(g.suggestions || []).length}:${g._suggestionsLoading ? 'loading' : 'ready'}`).join('||');
  const nextListRenderSignature = JSON.stringify({
    version: loadedVersion || '',
    filter: conflictFilterSignature,
    visibleLimit: conflictVisibleLimit,
    visibleKeys,
    statusSignature,
    suggestionsSignature,
    expanded: [...expandedSuggestionGroups].sort(),
  });
  if (conflictListRenderSignature === nextListRenderSignature) {
    if (suggestionsLoading) loadFullConflictDataInBackground();
    return;
  }

  const listHtml = visibleAll.map(g => {
    const items = g.classes.map(c => `
      <div class="conflict-class-item">
        <b>${escapeHtml(c.dept_label || '本部门')}</b> · ${escapeHtml(c.code || '')} ${escapeHtml(c.name || '')}
        <span style="color:#64748b;"> · ${escapeHtml(shortCampus(c.campus))} · ${escapeHtml(roomShortName(c.room || '', c.campus || ''))} · ${escapeHtml(c.currentCount || '')}人</span>
      </div>
    `).join('');
      const first = g.classes[0] || {};
    const groupCampuses = [...new Set(g.classes.map(c => c.campus).filter(Boolean))];
    const groupSubjects = [...new Set(g.classes.map(c => c.subject).filter(Boolean))];
    const capacityJump = {
      teacher: g.teacher || g.label,
      campus: groupCampuses.length === 1 ? groupCampuses[0] : '',
      subject: groupSubjects.length === 1 ? groupSubjects[0] : '',
      season: g.season,
      period: g.period,
      slot: g.slot,
    };
    const roomJump = {
      campus: g.campus || first.campus || '',
      room: g.room || first.room || '',
      season: g.season,
      period: g.period,
      slot: g.slot,
    };
    const action = g.type === 'teacher'
        ? `<button class="btn btn-refresh" style="padding:3px 8px;" data-conflict-action="jump-capacity" data-jump="${escapeAttr(JSON.stringify(capacityJump))}">去教师产能表</button>`
        : `<button class="btn btn-refresh" style="padding:3px 8px;" data-conflict-action="jump-classrooms" data-jump="${escapeAttr(JSON.stringify(roomJump))}">去教室空挡表</button>`;
    const badge = g.type === 'teacher'
      ? '<span class="conflict-badge">教师</span><span class="conflict-badge role">主管</span>'
      : `<span class="conflict-badge">教室</span><span class="conflict-badge role">店长</span>${g.cross ? '<span class="conflict-badge cross">跨部门</span>' : ''}`;
    const statusKey = conflictStatusKeyForGroup(g);
    const status = conflictStatusMap[statusKey]?.status || '未处理';
    const statusBtns = ['未处理','处理中','已确认'].map(s =>
      `<button class="btn" style="padding:2px 7px;font-size:11px;background:${s === status ? '#1a237e' : '#f5f5f5'};color:${s === status ? 'white' : '#555'};" data-conflict-action="status" data-status-key="${escapeAttr(statusKey)}" data-status="${escapeAttr(s)}">${s}</button>`
    ).join('');
    return `<div class="conflict-card">
      <div class="conflict-card-head">
        <div class="conflict-card-main">
          <div class="conflict-title-line">${badge}<span>${escapeHtml(g.label)}</span></div>
          <div class="conflict-meta-line">${escapeHtml(g.season)} ${escapeHtml(g.period)} ${escapeHtml(g.day||'')} · ${escapeHtml(g.slot)}段 ${escapeHtml(currentSlotLabels[g.slot] || '')} · ${escapeHtml(g.campus ? shortCampus(g.campus) : '多校区')}</div>
        </div>
        <div class="conflict-actions">${action}</div>
      </div>
      <div class="conflict-status-row"><span style="color:#777;font-size:11px;">处理状态</span>${statusBtns}</div>
      <div class="conflict-class-list">${items}</div>
      ${renderConflictSuggestions(g, statusKey)}
    </div>`;
  }).join('');

  if (listEl) {
    const footHtml = hiddenConflictCount
      ? `<button type="button" class="conflict-load-more" data-conflict-action="load-more-conflicts">加载更多冲突（已显示 ${escapeHtml(visibleAll.length)}/${escapeHtml(all.length)}）</button>`
      : (all.length ? `<div class="conflict-list-foot">已显示全部 ${escapeHtml(all.length)} 个冲突</div>` : '');
    listEl.innerHTML = listHtml
      ? listHtml + footHtml
      : '<div style="color:#4caf50;background:white;border-radius:8px;padding:16px;">当前筛选条件下没有冲突。</div>';
    conflictListRenderSignature = nextListRenderSignature;
  }
  if (suggestionsLoading) loadFullConflictDataInBackground();
}

function parseDatasetJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch(e) {
    return {};
  }
}

document.getElementById('conflictList')?.addEventListener('click', function(e) {
  const suggestionBtn = e.target.closest('[data-suggestion-action]');
  if (suggestionBtn && this.contains(suggestionBtn)) {
    const action = suggestionBtn.dataset.suggestionAction;
    const courseId = suggestionBtn.dataset.courseId;
    if (action === 'room-swap') return applyRoomSwapSuggestion(courseId, suggestionBtn.dataset.room || '');
    if (action === 'teacher-time') return applyTeacherTimeSuggestion(courseId, suggestionBtn.dataset.targetSlot || '');
    if (action === 'teacher-substitute') return applyTeacherSubstituteSuggestion(courseId, suggestionBtn.dataset.teacher || '');
    if (action === 'low-release-merge') return mergeCourse(suggestionBtn.dataset.releaseId);
    if (action === 'low-release-cancel') return cancelCourse(suggestionBtn.dataset.releaseId);
    if (action === 'coordinated-swap') {
      return applyCoordinatedSwapSuggestion(
        courseId,
        suggestionBtn.dataset.swapWithId,
        suggestionBtn.dataset.targetSlot,
        suggestionBtn.dataset.swapTargetSlot,
      );
    }
  }
  const conflictBtn = e.target.closest('[data-conflict-action]');
  if (!conflictBtn || !this.contains(conflictBtn)) return;
  const action = conflictBtn.dataset.conflictAction;
  if (action === 'jump-capacity') return jumpToCapacity(parseDatasetJson(conflictBtn.dataset.jump));
  if (action === 'jump-classrooms') return jumpToClassrooms(parseDatasetJson(conflictBtn.dataset.jump));
  if (action === 'load-more-conflicts') {
    conflictVisibleLimit += 20;
    return renderConflicts();
  }
  if (action === 'toggle-suggestions') {
    const key = conflictBtn.dataset.statusKey || '';
    if (expandedSuggestionGroups.has(key)) expandedSuggestionGroups.delete(key);
    else expandedSuggestionGroups.add(key);
    return renderConflicts();
  }
  if (action === 'status') return updateConflictStatus(conflictBtn.dataset.statusKey, conflictBtn.dataset.status);
});

async function updateConflictStatus(key, status) {
  try {
    const res = await apiFetch(`${API_BASE}/api/conflicts/status`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({key, status})
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'status failed');
    conflictStatusMap[key] = data.item;
    clearDataCache('conflicts-summary');
    clearDataCache('conflicts-full');
    const cached = getCachedConflictData();
    if (cached) cached.status = {...(cached.status || {}), [key]: data.item};
    showToast('冲突状态已更新');
    renderConflicts();
  } catch(e) {
    showToast('状态更新失败');
  }
}

function activateTab(tabName) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const panel = document.getElementById('tab-' + tabName);
  if (!tab || !panel) return;
  document.querySelectorAll('.tab').forEach(t => {
    const active = t === tab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
    t.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
  panel.classList.remove('hidden');
  setPresenceState({activity: 'viewing', tab: tabName, courseId: '', field: ''}, true);
  if (tabName === 'overview') renderOverview();
  if (tabName === 'capacity') renderCapacity();
  if (tabName === 'classrooms') renderClassroomBoard();
  if (tabName === 'conflicts') renderConflicts();
  if (tabName === 'changelog') renderChangelog();
  if (tabName === 'heatmap') renderHeatmap();
}

function setSelectValueIfPresent(id, value) {
  const el = document.getElementById(id);
  if (!el) return false;
  const normalized = value || '';
  if (!normalized) {
    el.value = '';
    return true;
  }
  const exists = [...el.options].some(o => o.value === normalized);
  if (exists) el.value = normalized;
  else el.value = '';
  return exists;
}

function clearJumpHighlights() {
  document.querySelectorAll('.jump-highlight').forEach(el => el.classList.remove('jump-highlight'));
}

function highlightAndScroll(el) {
  if (!el) return false;
  clearJumpHighlights();
  el.classList.add('jump-highlight');
  el.scrollIntoView({block: 'center', inline: 'center', behavior: 'smooth'});
  window.setTimeout(() => el.classList.remove('jump-highlight'), 4500);
  return true;
}

function highlightCapacityTarget(target) {
  window.setTimeout(() => {
    const cells = [...document.querySelectorAll('[data-cap-cell="1"]')];
    const targetCell = cells.find(el =>
      (!target.teacher || el.dataset.capTeacher === target.teacher) &&
      (!target.season || el.dataset.capSeason === target.season) &&
      (!target.period || el.dataset.capPeriod === target.period) &&
      (!target.slot || el.dataset.capSlot === target.slot)
    );
    if (highlightAndScroll(targetCell)) return;
    const row = [...document.querySelectorAll('[data-cap-teacher]')].find(el => !target.teacher || el.dataset.capTeacher === target.teacher);
    highlightAndScroll(row);
  }, 0);
}

function highlightRoomTarget(target) {
  window.setTimeout(() => {
    const targetKey = roomKey(target.campus || '', target.room || '');
    const cells = [...document.querySelectorAll('[data-room-cell="1"]')];
    const targetCell = cells.find(el => {
      const cellKey = roomKey(el.dataset.roomCampus || '', el.dataset.roomName || '');
      const sameRoom = !target.room ||
        el.dataset.roomName === target.room ||
        (targetKey && cellKey && targetKey === cellKey) ||
        roomShortName(el.dataset.roomName || '', el.dataset.roomCampus || '') === roomShortName(target.room || '', target.campus || '');
      return sameRoom &&
        (!target.campus || el.dataset.roomCampus === target.campus) &&
        (!target.season || el.dataset.roomSeason === target.season) &&
        (!target.period || el.dataset.roomPeriod === target.period) &&
        (!target.slot || el.dataset.roomSlot === target.slot);
    });
    highlightAndScroll(targetCell);
  }, 0);
}

function jumpToCapacity(target) {
  const params = typeof target === 'object' && target !== null ? target : {teacher: target};
  activateTab('capacity');
  setSelectValueIfPresent('capSubject', params.subject || '');
  setSelectValueIfPresent('capCampus', params.campus || '');
  const teacherEl = document.getElementById('capTeacherSearch');
  if (teacherEl) teacherEl.value = params.teacher || '';
  renderCapacity();
  highlightCapacityTarget(params);
  showToast('已定位到教师产能表');
}

function jumpToClassrooms(target, room) {
  const params = typeof target === 'object' && target !== null
    ? target
    : {campus: target || '', room: room || ''};
  activateTab('classrooms');
  setSelectValueIfPresent('roomCampus', params.campus || '');
  if (params.season !== undefined) {
    setSelectValueIfPresent('roomSeason', params.season || '');
    refreshRoomPeriodOptions();
  }
  if (params.period !== undefined) setSelectValueIfPresent('roomPeriod', params.period || '');
  const searchEl = document.getElementById('roomSearch');
  if (searchEl) searchEl.value = roomShortName(params.room || '', params.campus || '');
  renderClassroomBoard();
  highlightRoomTarget(params);
  showToast('已定位到教室空挡表');
}

function getRoomBoardCampuses() {
  const selected = document.getElementById('roomCampus').value;
  if (currentUser && currentUser.role === 'store_manager' && currentUser.campus) return [currentUser.campus];
  return selected ? [selected] : allCampuses;
}

function roomShortName(room, campus) {
  return (room || '').replace(campus || '', '').replace('教学区', '').replace('素养', '').replace('素质', '').replace('教室', '').trim() || room;
}
function roomKey(campus, room) {
  const c = String(campus || '').replace(/\s+/g, '');
  const r = String(room || '').replace(/\s+/g, '');
  const owner = roomOwnerDept(r);
  const m = r.match(/(\d{2,4})(?!.*\d)/);
  let no = m ? m[1] : r.replace(c, '').replace(/教学区|素养|素质|学习机|教室|临时|共用|借用青少|借用中学|借青少|借中学/g, '');
  return c && owner && no ? `${c}|${owner}|${no}` : '';
}
function roomOwnerDept(room) {
  const text = room || '';
  if (/素质教室|青少/.test(text)) return 'qingshao';
  if (/素养教室|学习机教室|中学|高中|中学部|小组|ZV/.test(text)) return 'gaozhi';
  return '';
}
function isSharedRoom(room) {
  return /共用/.test(room || '');
}
function roomLabelInfo(room, campus = '') {
  const text = room || '';
  const key = roomKey(campus, text);
  if (key && relatedRooms[key]) return {text:relatedRooms[key].label || '共用', type:relatedRooms[key].type || 'shared'};
  if (isSharedRoom(text)) return {text:'共用', type:'shared'};
  if (DEPT_ID === 'qingshao') {
    if (roomOwnerDept(text) === 'gaozhi') return {text:'借中学', type:'borrowed'};
    return null;
  }
  if (roomOwnerDept(text) === 'qingshao') {
    return {text:'借青少', type:'borrowed'};
  }
  return null;
}
function borrowedRoomLabel(room) {
  const info = roomLabelInfo(room);
  return info ? info.text : '';
}
function roomOccupancyMapKey(roomId, season, period, slot) {
  return `${roomId || ''}|${season || ''}|${period || ''}|${slot || ''}`;
}

function addRoomOccupancy(map, key, course) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(course);
}

function buildRoomOccupancyMap(activeCourseList, activeRelatedRooms) {
  const map = new Map();
  activeCourseList.forEach(c => {
    if (!c.campus || !c.room || !c.slot) return;
    addRoomOccupancy(map, roomOccupancyMapKey(`${c.campus}|${c.room}`, c.season, c.period, c.slot), c);
  });
  activeRelatedRooms.forEach(c => {
    if (!c.slot) return;
    if (c.campus && c.room) {
      addRoomOccupancy(map, roomOccupancyMapKey(`${c.campus}|${c.room}`, c.season, c.period, c.slot), c);
    }
    if (c.related && c.room_key) {
      addRoomOccupancy(map, roomOccupancyMapKey(c.room_key, c.season, c.period, c.slot), c);
    }
  });
  return map;
}

function getRoomOccupancyCourses(campus, room, season, period, slot, occupancyMap = null) {
  const key = roomKey(campus, room);
  if (occupancyMap) {
    const exact = occupancyMap.get(roomOccupancyMapKey(`${campus}|${room}`, season, period, slot)) || [];
    const related = key ? (occupancyMap.get(roomOccupancyMapKey(key, season, period, slot)) || []) : [];
    const seen = new Set();
    return exact.concat(related).filter(c => {
      const id = `${c.related ? 'related' : 'own'}|${c.dept_id || c.dept_label || ''}|${c.id}|${c.code || ''}|${c.name || ''}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  return courses.concat(relatedRoomCourses).filter(c => {
    const sameExactRoom = c.campus === campus && c.room === room;
    const sameRelatedRoom = c.related && c.room_key && key && c.room_key === key;
    return (sameExactRoom || sameRelatedRoom) && c.season === season && c.period === period && c.slot === slot;
  });
}
function roomCellClass(cs) {
  const hasOwn = cs.some(c => !c.related);
  const hasRelated = cs.some(c => c.related);
  if (hasOwn && hasRelated) return 'room-cell-mixed';
  if (hasRelated) return 'room-cell-related';
  return 'room-cell-own';
}
function renderRoomCourseItem(c) {
  const source = c.dept_label || '本部门';
  const name = shortClassName(c) || c.name || '';
  return `<div class="room-class"><span class="room-source">${escapeHtml(source)}</span>${escapeHtml(name)}</div><div class="room-teacher">${escapeHtml(c.teacher || '')}</div>`;
}
function roomBoardSizeClass(roomCount) {
  if (roomCount <= 4) return 'compact';
  if (roomCount <= 8) return 'medium';
  return 'wide';
}
function roomCellDataAttrs(campus, room, season, period, slot) {
  return `data-room-cell="1" data-room-campus="${escapeAttr(campus)}" data-room-name="${escapeAttr(room)}" data-room-season="${escapeAttr(season)}" data-room-period="${escapeAttr(period)}" data-room-slot="${escapeAttr(slot)}"`;
}

function renderClassroomBoard() {
  const container = document.getElementById('classroomBoardContent');
  if (!container) return;
  const campuses = getRoomBoardCampuses();
  const seasonFilter = document.getElementById('roomSeason').value;
  const periodFilter = document.getElementById('roomPeriod').value;
  const search = document.getElementById('roomSearch').value.trim().toLowerCase();
  const slotOrder = ['A','B','C','D','E'];
  const activeCourseList = courses.filter(isActiveCourse);
  const activeRelatedRooms = relatedRoomCourses.filter(isActiveCourse);
  const occupancyMap = buildRoomOccupancyMap(activeCourseList, activeRelatedRooms);
  const seasons = seasonFilter ? [seasonFilter] : [...new Set(activeCourseList.map(c => c.season).filter(Boolean))].sort();

  let html = '<div class="room-board-grid">';
  let renderedBoards = 0;
  campuses.forEach(campus => {
    let rooms = [...new Set(activeCourseList.filter(c => c.campus === campus && c.room).map(c => c.room))].sort();
    activeRelatedRooms
      .filter(c => c.campus === campus && c.room)
      .forEach(c => {
        const key = c.room_key || roomKey(c.campus, c.room);
        const existing = rooms.find(r => roomKey(campus, r) === key);
        if (!existing) rooms.push(c.room);
      });
    rooms.sort();
    if (search) rooms = rooms.filter(r => r.toLowerCase().includes(search));
    if (!rooms.length) return;
    renderedBoards += 1;
    const roomLabelCounts = rooms.reduce((acc, r) => {
      const info = roomLabelInfo(r, campus);
      if (info) acc[info.type] = (acc[info.type] || 0) + 1;
      return acc;
    }, {});
    const roomMeta = [
      `<span>${rooms.length} 间教室</span>`,
      roomLabelCounts.borrowed ? `<span>${roomLabelCounts.borrowed} 间借用教室</span>` : '',
      roomLabelCounts.shared ? `<span>${roomLabelCounts.shared} 间共用教室</span>` : '',
    ].filter(Boolean).join('');
    html += `<section class="room-board-section ${roomBoardSizeClass(rooms.length)}">
      <div class="room-board-head">
        <div class="room-board-title">${escapeHtml(shortCampus(campus))} 教室空挡表</div>
        <div class="room-board-meta">${roomMeta}</div>
      </div>
      <div class="room-board-scroll">
      <table class="room-board-table">
        <thead><tr>
          <th class="axis">季度/期数</th>
          <th class="slot-axis">时段</th>
          ${rooms.map(r => {
            const label = roomLabelInfo(r, campus);
            return `<th class="room-head"><div class="room-name">${escapeHtml(roomShortName(r, campus))}</div>${label ? `<span class="room-badge ${escapeAttr(label.type)}">${escapeHtml(label.text)}</span>` : ''}</th>`;
          }).join('')}
        </tr></thead><tbody>`;
    seasons.forEach(season => {
      const allowedPeriods = getPeriodsForSeason(season);
      const seasonPeriods = periodFilter ? (allowedPeriods.includes(periodFilter) ? [periodFilter] : []) : allowedPeriods;
      seasonPeriods.forEach(period => {
        slotOrder.forEach((slot, idx) => {
          html += '<tr>';
          if (idx === 0) html += `<td rowspan="5" class="axis">${escapeHtml(season)} ${escapeHtml(period)}</td>`;
          html += `<td class="slot-axis">${escapeHtml(slot)}</td>`;
          rooms.forEach(room => {
            const cs = getRoomOccupancyCourses(campus, room, season, period, slot, occupancyMap);
            const cellAttrs = roomCellDataAttrs(campus, room, season, period, slot);
            if (cs.length) {
              const title = cs.map(c => `${c.dept_label ? c.dept_label + '：' : ''}${c.name || ''} ${c.teacher || ''}`).join('\n');
              html += `<td class="room-cell-busy ${roomCellClass(cs)}" ${cellAttrs} title="${escapeAttr(title)}">${cs.map(renderRoomCourseItem).join('')}</td>`;
            } else {
              const prefill = escapeAttr(JSON.stringify({campus, room, season, period, slot, day: period && period.startsWith('周') ? period : '每天'}));
              html += canEditNow()
                ? `<td class="room-cell-free" ${cellAttrs} data-room-action="insert" data-prefill="${prefill}" title="空闲，点击插空排课"><div class="room-free-main">可排</div><div class="room-free-sub">点击</div></td>`
                : `<td class="room-cell-free" ${cellAttrs} title="空闲，当前流程状态下不可插空排课"><div class="room-free-main">空闲</div><div class="room-free-sub">不可编辑</div></td>`;
            }
          });
          html += '</tr>';
        });
      });
    });
    html += '</tbody></table></div></section>';
  });
  html += '</div>';
  container.innerHTML = renderedBoards ? html : '<div style="color:#999;background:white;border-radius:8px;padding:18px;">暂无教室数据。可以先导入教室资源，或确认课程数据中已有教室字段。</div>';
}

document.getElementById('classroomBoardContent')?.addEventListener('click', function(e) {
  const cell = e.target.closest('[data-room-action="insert"][data-prefill]');
  if (!cell || !this.contains(cell)) return;
  openNewCourseModal(parseDatasetJson(cell.dataset.prefill));
});

// === 校区课表总览 ===
function renderOverview() {
  const campusFilters = getMultiSelectValues('ovCampus');
  const gradeFilters = getMultiSelectValues('ovGrade');
  const slotOrder = ['A','B','C','D','E'];
  const gradeOrder = GRADE_OPTIONS;
  const periodNameMap = {'1期':'一期','2期':'二期','3期':'三期'};

  populateMultiSelect('ovCampus', allCampuses, renderOverview);
  populateMultiSelect('ovGrade', gradeOrder, renderOverview);

  // 按 校区+年级+季度+期数 分组
  const grouped = {};
  courses.forEach(c => {
    if (!isActiveCourse(c)) return;
    if (!c.campus || !c.slot) return;
    if (campusFilters.length && !campusFilters.includes(c.campus)) return;
    const grade = getActualGrade(c);
    if (!grade) return;
    if (gradeFilters.length && !gradeFilters.includes(grade)) return;

    const campusShort = shortCampus(c.campus);
    const key = `${campusShort}|${grade}|${c.season}|${c.period}`;
    if (!grouped[key]) grouped[key] = {campus: campusShort, grade, season: c.season, period: c.period, courses: []};
    grouped[key].courses.push(c);
  });

  // 生成卡片标题
  function getCardTitle(info) {
    const campusLabel = `【${info.campus}】`;
    if (info.season === '秋季') {
      return `${info.grade} ${info.period}课表 ${campusLabel}`;
    }
    const pName = periodNameMap[info.period] || info.period;
    let dateRange = '';
    let restDays = '';
    if (info.courses.length > 0) {
      const sd = info.courses[0].startDate;
      const ed = info.courses[0].endDate;
      if (sd && ed) {
        const sm = sd.match(/\d+-(\d+)-(\d+)/);
        const em = ed.match(/\d+-(\d+)-(\d+)/);
        if (sm && em) dateRange = `${parseInt(sm[1])}.${parseInt(sm[2])}-${parseInt(em[1])}.${parseInt(em[2])}`;
      }
      const td = info.courses[0].timeDesc || '';
      const rm = td.match(/[（(](.+?日休)[）)]/);
      if (rm) restDays = rm[1];
    }
    let title = `${info.grade} ${pName}`;
    if (dateRange || restDays) {
      title += '（' + [dateRange, restDays].filter(Boolean).join('，') + '）';
    }
    return title + ' ' + campusLabel;
  }

  // 构建单个卡片表格
  function buildCard(info, color) {
    const cs = info.courses;
    const activeSlots = slotOrder.filter(s => cs.some(c => c.slot === s));
    if (activeSlots.length === 0) return '';

    // 第一步：按字母分组，确定有字母的列
    const knownLetters = ['A','B','C','D','E'].filter(l => cs.some(c => getClassLetter(c.name) === l));

    // 第二步：构建列网格 grid[colIndex][slot] = course
    // 先为有字母的课分配列
    const grid = [];
    knownLetters.forEach(() => grid.push({}));

    cs.forEach(c => {
      const letter = getClassLetter(c.name);
      if (letter) {
        const colIdx = knownLetters.indexOf(letter);
        if (colIdx >= 0 && !grid[colIdx][c.slot]) {
          grid[colIdx][c.slot] = c;
        } else if (colIdx >= 0) {
          // 同字母同时段有多个课，放到新列
          let placed = false;
          for (let i = 0; i < grid.length; i++) {
            if (!grid[i][c.slot]) { grid[i][c.slot] = c; placed = true; break; }
          }
          if (!placed) { const col = {}; col[c.slot] = c; grid.push(col); }
        }
      }
    });

    // 第三步：无字母的课填入已有列的空位，填不下再新增列
    const noLetterCourses = cs.filter(c => !getClassLetter(c.name));
    noLetterCourses.forEach(c => {
      let placed = false;
      for (let i = 0; i < grid.length; i++) {
        if (!grid[i][c.slot]) { grid[i][c.slot] = c; placed = true; break; }
      }
      if (!placed) { const col = {}; col[c.slot] = c; grid.push(col); }
    });

    if (grid.length === 0) return '';

    const totalCols = grid.length;
    let html = `<div class="overview-card" style="border-top-color:${color.border}">`;
    html += `<div class="ov-title" style="border-left:3px solid ${color.border}">${escapeHtml(getCardTitle(info))}</div>`;
    html += `<table class="overview-table"><thead><tr>`;
    html += `<th style="background:${color.thBg}">时间段</th>`;
    for (let i = 0; i < totalCols; i++) html += `<th style="background:${color.thBg}"></th>`;
    html += `</tr></thead><tbody>`;

    activeSlots.forEach(s => {
      html += `<tr><td class="ov-slot-label">${escapeHtml(currentSlotLabels[s])}</td>`;
      for (let i = 0; i < totalCols; i++) {
        const c = grid[i][s];
        html += c ? renderCell(c) : `<td class="ov-class-cell ov-empty"></td>`;
      }
      html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    return html;
  }

  function renderCell(c) {
    const orig = getOriginal(c) || {};
    const changed = isOriginalReady() && ((c.teacher !== orig.teacher) || (c.slot !== orig.slot) || (c.room !== orig.room));
    const subject = c.subject || '';
    const teacher = c.teacher || '';
    const code = c.code || '';
    const letter = getClassLetter(c.name);
    let cell = subject;
    if (letter) cell += letter;
    if (teacher) cell += ` ${teacher}`;
    if (code) cell += ` ${code}`;
    return `<td class="ov-class-cell${changed ? ' ov-changed' : ''}" title="${escapeAttr(c.name)}">${escapeHtml(cell)}</td>`;
  }

  // 校区配色
  const campusColorPalette = [
    {border:'#1565c0', thBg:'#e3f2fd'},
    {border:'#2e7d32', thBg:'#e8f5e9'},
    {border:'#e65100', thBg:'#fff3e0'},
    {border:'#6a1b9a', thBg:'#f3e5f5'},
    {border:'#c62828', thBg:'#ffebee'},
    {border:'#00695c', thBg:'#e0f2f1'},
    {border:'#4e342e', thBg:'#efebe9'},
    {border:'#283593', thBg:'#e8eaf6'},
    {border:'#ef6c00', thBg:'#fff8e1'},
    {border:'#00838f', thBg:'#e0f7fa'},
    {border:'#ad1457', thBg:'#fce4ec'},
    {border:'#558b2f', thBg:'#f1f8e9'},
  ];

  const allCampusShorts = [...new Set(Object.values(grouped).map(g => g.campus))].sort();
  const campusColorMap = {};
  allCampusShorts.forEach((c, i) => { campusColorMap[c] = campusColorPalette[i % campusColorPalette.length]; });

  const summerPeriods = ['1期','2期','3期'];
  const autumnPeriods = ['周五','周六','周日'];

  let html = '';
  allCampusShorts.forEach(campus => {
    gradeOrder.forEach(grade => {
      let leftHtml = '';
      let rightHtml = '';
      summerPeriods.forEach(p => {
        const key = `${campus}|${grade}|暑假|${p}`;
        if (grouped[key]) leftHtml += buildCard(grouped[key], campusColorMap[campus]);
      });
      autumnPeriods.forEach(p => {
        const key = `${campus}|${grade}|秋季|${p}`;
        if (grouped[key]) rightHtml += buildCard(grouped[key], campusColorMap[campus]);
      });
      if (leftHtml || rightHtml) {
        const color = campusColorMap[campus];
        html += `<div class="overview-section" style="border-left:4px solid ${color.border};margin-bottom:24px;padding-left:12px;">`;
        html += `<div style="font-size:13px;font-weight:700;margin-bottom:10px;color:${color.border}">${escapeHtml(campus)} · ${escapeHtml(grade)}</div>`;
        html += `<div class="overview-wrap">`;
        html += `<div class="overview-col"><div class="overview-col-title summer">暑假</div>${leftHtml}</div>`;
        html += `<div class="overview-col"><div class="overview-col-title autumn">秋季</div>${rightHtml}</div>`;
        html += `</div></div>`;
      }
    });
  });

  if (!html) html = '<div style="padding:20px;color:#888;">暂无数据</div>';
  document.getElementById('overviewContent').innerHTML = html;
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('.tab:not(.hidden)')];
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    tabs[nextIndex]?.focus();
    activateTab(tabs[nextIndex]?.dataset.tab);
  });
});
['capSubject','capCampus','capTeacherSearch'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    markUserEditing(4000);
    if (id === 'capTeacherSearch') debouncedRenderCapacity();
    else renderCapacity();
  });
});
['roomCampus','roomPeriod','roomSearch'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => {
    markUserEditing(4000);
    if (id === 'roomSearch') debouncedRenderClassroomBoard();
    else renderClassroomBoard();
  });
});
['conflictType','conflictCampus','conflictSubject','conflictGrade','conflictSearch'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => {
    markUserEditing(4000);
    if (id === 'conflictSearch') debouncedRenderConflicts();
    else renderConflicts();
  });
});
document.getElementById('conflictQuickbar')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-conflict-quick-type]');
  if (!btn) return;
  const type = btn.dataset.conflictQuickType || '';
  const select = document.getElementById('conflictType');
  if (select) select.value = type;
  renderConflicts();
});
document.getElementById('roomSeason')?.addEventListener('change', () => {
  markUserEditing(4000);
  refreshRoomPeriodOptions();
  renderClassroomBoard();
});

// === 缩放功能 ===
let currentZoom = 100;
function zoomCapacity(delta) {
  if (delta === 0) { currentZoom = 100; }
  else { currentZoom = Math.max(50, Math.min(200, currentZoom + delta)); }
  document.getElementById('zoomLevel').textContent = currentZoom + '%';
  document.getElementById('capacityWrap').style.transform = `scale(${currentZoom/100})`;
  document.getElementById('capacityWrap').style.transformOrigin = 'top left';
  document.getElementById('capacityWrap').style.width = (10000/currentZoom) + '%';
}

async function initializeApp() {
  setupFeatureVisibility();
  renderBatchValueControl();
  await initHeader();
  window.AppUtils?.initMoodBoard({root: 'scheduleMoodBoard', apiFetch, toast: showToast});
  await Promise.all([
    initWorkflow({render: false}),
    loadData(false, {render: false}),
  ]);
  setupFeatureVisibility();
  renderAll();
}

dataRefreshTimer = setInterval(() => loadData(true), 30000);
initializeApp();

// === Header：用户信息、批次切换、新建批次 ===
let departmentTerms = [];
let currentTermInfo = null;
async function initHeader() {
  try {
    const meRes = await apiFetch('/api/auth/me');
    if (meRes.ok) {
      const me = await meRes.json();
      currentUser = me;
      const roleLabel = ROLE_LABELS[me.role] || me.role;
      document.getElementById('userInfo').textContent = [me.name || me.email, roleLabel, me.campus || me.district || ''].filter(Boolean).join(' · ');
      renderWorkflow();
      setupFeatureVisibility();
      startPresence();
    } else {
      window.location.href = '/auth';
      return;
    }
    if (!DEPT_ID) return;
    const [termsRes, deptsRes] = await Promise.all([
      apiFetch(`/dept/${DEPT_ID}/api/terms?include_archived=1`),
      apiFetch('/api/departments'),
    ]);
    if (termsRes.ok) {
      const terms = await termsRes.json();
      departmentTerms = terms;
      const sel = document.getElementById('termSelect');
      sel.innerHTML = terms.map(t =>
        `<option value="${escapeAttr(t.id)}" ${t.id === TERM_ID ? 'selected' : ''}>${escapeHtml((t.is_default ? '★ ' : '') + t.name + (t.archived ? '（已归档）' : ''))}</option>`
      ).join('');
      sel.addEventListener('change', e => {
        window.location.href = `/dept/${DEPT_ID}/${e.target.value}/`;
      });
      const currentTerm = terms.find(t => t.id === TERM_ID);
      currentTermInfo = currentTerm || null;
      if (deptsRes.ok) {
        const depts = await deptsRes.json();
        const d = depts.find(x => x.id === DEPT_ID);
        const title = `${d ? d.name : DEPT_ID}${currentTerm ? ' · ' + currentTerm.name : ''} 排课协作看版`;
        document.getElementById('pageTitle').textContent = title;
        document.title = title;
      }
    }
  } catch (e) { console.error(e); }
}

function suggestedYiduiyiTermName(date = new Date()) {
  const month = date.getMonth() + 1;
  const fy = date.getFullYear() - 2000 + (month >= 6 ? 1 : 0);
  const quarter = Math.floor(((month - 6 + 12) % 12) / 3) + 1;
  return `FY${String(fy).padStart(2, '0')}Q${quarter}·${month}月`;
}

const WF_LABELS = {draft:'草稿', scheduling:'排课中', reviewing:'审核中', confirmed:'已确认'};
const WF_STATUSES = ['draft', 'scheduling', 'reviewing', 'confirmed'];
function isStaffRole(role = currentUser && currentUser.role) {
  return ['admin', 'jiaowu'].includes(role);
}
function nextWorkflowStatus() {
  if (!currentWorkflow) return null;
  const role = currentUser && currentUser.role;
  const status = currentWorkflow.status || 'draft';
  if (status === 'draft' && ['admin','jiaowu'].includes(role)) return 'scheduling';
  if (status === 'scheduling' && ['store_manager','supervisor','regional_manager'].includes(role)) return 'reviewing';
  if (status === 'reviewing' && ['supervisor','regional_manager','admin','director'].includes(role)) return 'confirmed';
  if (status === 'confirmed' && ['admin','jiaowu'].includes(role)) return 'scheduling';
  return null;
}

function syncWorkflowStaffAction() {
  const staffTarget = document.getElementById('wfStaffTarget');
  const staffAction = document.getElementById('wfStaffAction');
  if (!staffTarget || !staffAction || !currentWorkflow) return;
  const status = currentWorkflow.status || 'draft';
  const unchanged = staffTarget.value === status;
  staffAction.disabled = unchanged;
  staffAction.textContent = unchanged ? '已是当前状态' : '设置流程';
}

function renderWorkflow() {
  const bar = document.getElementById('workflowBar');
  if (!bar || !currentWorkflow) return;
  const status = currentWorkflow.status || 'draft';
  document.getElementById('wfStatus').textContent = WF_LABELS[status] || status;
  document.getElementById('wfInfo').textContent = currentWorkflow.updated_at ? `最后更新：${currentWorkflow.updated_by || ''} ${currentWorkflow.updated_at}` : '尚未流转';
  const next = nextWorkflowStatus();
  const btn = document.getElementById('wfAction');
  btn.style.display = next ? '' : 'none';
  btn.textContent = next ? `流转到${WF_LABELS[next]}` : '';
  const staffControls = document.getElementById('wfStaffControls');
  const staffTarget = document.getElementById('wfStaffTarget');
  const staffAction = document.getElementById('wfStaffAction');
  if (staffControls && staffTarget && staffAction) {
    const canSetAny = isStaffRole();
    staffControls.style.display = canSetAny ? 'inline-flex' : 'none';
    if (canSetAny) {
      staffTarget.innerHTML = WF_STATUSES
        .map(s => `<option value="${s}" ${s === status ? 'selected' : ''}>${WF_LABELS[s] || s}</option>`)
        .join('');
      staffTarget.onchange = syncWorkflowStaffAction;
      syncWorkflowStaffAction();
    }
  }
  updateEditLockUI();
}

async function initWorkflow(options = {}) {
  try {
    const res = await apiFetch(`${API_BASE}/api/workflow`);
    if (!res.ok) return;
    currentWorkflow = await res.json();
    renderWorkflow();
    if (options.render !== false) renderAll();
  } catch(e) {}
}

async function advanceWorkflow() {
  const next = nextWorkflowStatus();
  if (!next) return;
  await setWorkflowStatus(next);
}

async function setWorkflowStatusFromSelect() {
  const target = document.getElementById('wfStaffTarget')?.value;
  if (!target) return;
  if (target === (currentWorkflow?.status || 'draft')) return;
  await setWorkflowStatus(target);
}

async function setWorkflowStatus(status) {
  try {
    const res = await apiFetch(`${API_BASE}/api/workflow`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({status})
    });
    const data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || '状态流转失败'); return; }
    currentWorkflow = data.workflow;
    renderWorkflow();
    renderAll();
    showToast('流程状态已更新');
  } catch(e) { showToast('状态流转失败'); }
}

function setupFeatureVisibility() {
  if (DEPT_ID === 'yiduiyi') {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('hidden', tab.dataset.tab !== 'heatmap');
    });
    document.querySelectorAll('.tab-content').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== 'tab-heatmap');
    });
    activateTab('heatmap');
  } else {
    document.querySelectorAll('.tab[data-tab="heatmap"]').forEach(el => el.remove());
    const panel = document.getElementById('tab-heatmap');
    if (panel) panel.remove();
  }
  if (currentUser && currentUser.role === 'user') {
    document.getElementById('newCourseBtn')?.remove();
  }
  const staffVisible = currentUser && ['admin','jiaowu'].includes(currentUser.role);
  document.querySelectorAll('.staff-only').forEach(el => {
    el.style.display = staffVisible ? '' : 'none';
  });
}

function openNewTermModal() {
  const modal = document.getElementById('newTermModal');
  const name = document.getElementById('newTermName');
  const desc = document.getElementById('newTermDesc');
  const hint = document.getElementById('newTermHint');
  if (name && DEPT_ID === 'yiduiyi') {
    const suggested = suggestedYiduiyiTermName();
    name.value = suggested;
    name.placeholder = suggested;
    if (hint) hint.textContent = '一对一默认按月份命名，例如 FY26Q4·4月；名称后续可以修改。';
  } else if (name) {
    name.value = '';
    name.placeholder = '如 FY27寒春';
    if (hint) hint.textContent = '提示：系统会自动生成内部编号。批次创建后为空白，需进入新批次后导入 Excel 数据。';
  }
  if (desc) desc.value = '';
  showAppModal('newTermModal', '#newTermName');
}

async function createTerm() {
  const name = document.getElementById('newTermName').value.trim();
  const description = document.getElementById('newTermDesc').value.trim();
  if (!name && DEPT_ID !== 'yiduiyi') { showToast('请填写批次名称'); return; }
  const res = await apiFetch(`/dept/${DEPT_ID}/api/terms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  });
  const data = await res.json();
  if (data.ok) {
    window.location.href = `/dept/${DEPT_ID}/${data.id}/`;
  } else {
    showToast(data.error || '创建失败');
  }
}

async function updateCurrentTerm(fields) {
  const res = await apiFetch(`/dept/${DEPT_ID}/api/terms/${TERM_ID}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(fields)
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    showToast(data.error || '操作失败');
    return false;
  }
  showToast('批次设置已更新');
  await initHeader();
  return true;
}

async function setCurrentTermDefault() {
  const ok = await confirmAction({
    title: '设为主批次',
    message: '确认将当前批次设为主批次？',
    confirmText: '确认设置',
  });
  if (!ok) return;
  updateCurrentTerm({is_default: true});
}

async function archiveCurrentTerm() {
  const ok = await confirmAction({
    title: '归档批次',
    message: '确认归档当前批次？归档后默认列表会隐藏，但仍可从批次下拉中进入。',
    confirmText: '确认归档',
  });
  if (!ok) return;
  updateCurrentTerm({archived: true});
}

function openEditTermModal() {
  const modal = document.getElementById('editTermModal');
  const name = document.getElementById('editTermName');
  const desc = document.getElementById('editTermDesc');
  if (name) name.value = currentTermInfo?.name || '';
  if (desc) desc.value = currentTermInfo?.description || '';
  showAppModal('editTermModal', '#editTermName');
}

async function saveTermInfo() {
  const name = document.getElementById('editTermName').value.trim();
  const description = document.getElementById('editTermDesc').value.trim();
  if (!name) { showToast('请填写批次名称'); return; }
  const ok = await updateCurrentTerm({name, description});
  if (ok) {
    hideAppModal('editTermModal');
    const title = document.getElementById('pageTitle');
    if (title) title.textContent = title.textContent.replace(currentTermInfo?.name || '', name);
    currentTermInfo = {...(currentTermInfo || {}), name, description};
  }
}

function openDeleteTermModal() {
  if (!currentTermInfo) return;
  if (departmentTerms.length <= 1) {
    showToast('至少需要保留一个批次，不能删除最后一个批次。');
    return;
  }
  const name = currentTermInfo.name || TERM_ID;
  const hint = document.getElementById('deleteTermNameHint');
  const input = document.getElementById('deleteTermNameInput');
  const submit = document.getElementById('deleteTermSubmit');
  if (hint) hint.textContent = `如确认删除，请输入：${name}`;
  if (input) input.value = '';
  if (submit) submit.disabled = true;
  if (input && submit) {
    input.oninput = () => {
      submit.disabled = input.value.trim() !== name;
    };
  }
  showAppModal('deleteTermModal', '#deleteTermNameInput');
}

async function deleteCurrentTerm() {
  if (!currentTermInfo) return;
  const name = currentTermInfo.name || TERM_ID;
  const typed = document.getElementById('deleteTermNameInput')?.value.trim() || '';
  if (typed !== name) {
    showToast('批次名称不匹配');
    return;
  }
  const submit = document.getElementById('deleteTermSubmit');
  if (submit) submit.disabled = true;
  const res = await apiFetch(`/dept/${DEPT_ID}/api/terms/${TERM_ID}`, {method: 'DELETE'});
  const data = await res.json();
  if (!res.ok || data.error) {
    if (submit) submit.disabled = false;
    showToast(data.error || '删除失败');
    return;
  }
  const next = departmentTerms.find(t => t.id !== TERM_ID && !t.archived) || departmentTerms.find(t => t.id !== TERM_ID);
  showToast('批次已删除并归档');
  window.location.href = next ? `/dept/${DEPT_ID}/${next.id}/` : `/dept/${DEPT_ID}/`;
}

function setSelectOptions(id, values, selected) {
  const el = document.getElementById(id);
  if (!el) return;
  const unique = [...new Set(values.filter(Boolean))];
  el.innerHTML = unique.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
  if (selected && unique.includes(selected)) el.value = selected;
}

function getNewCourseSubjects() {
  if (DEPT_ID === 'yiduiyi') return ['数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '语文'];
  return ['博文', '双语', '益智', '科学', '实践'];
}

function getNewCourseGrades() {
  return GRADE_OPTIONS;
}

function newCoursePayload() {
  const classKind = document.getElementById('nc_class_kind').value;
  return {
    season: document.getElementById('nc_season').value,
    campus: document.getElementById('nc_campus').value,
    subject: document.getElementById('nc_subject').value,
    grade: document.getElementById('nc_grade').value,
    level: document.getElementById('nc_level').value,
    teacher: document.getElementById('nc_teacher').value,
    room: document.getElementById('nc_room').value,
    period: document.getElementById('nc_period').value,
    slot: document.getElementById('nc_slot').value,
    day: document.getElementById('nc_day').value,
    capacity: classKind === '小组' ? 6 : 20,
    sessions: 7,
    reason: document.getElementById('nc_reason')?.value || '',
  };
}

async function refreshNewCourseResources() {
  const campus = document.getElementById('nc_campus').value;
  const subject = document.getElementById('nc_subject').value;
  try {
    const [tr, rr] = await Promise.all([
      apiFetch(`/dept/${DEPT_ID}/api/resources/teachers?campus=${encodeURIComponent(campus)}&subject=${encodeURIComponent(subject)}`),
      apiFetch(`/dept/${DEPT_ID}/api/resources/classrooms?campus=${encodeURIComponent(campus)}`)
    ]);
    const teachers = tr.ok ? await tr.json() : [];
    const rooms = rr.ok ? await rr.json() : [];
    const teacherNames = teachers.length ? teachers.map(t => t.name) : allTeachers;
    const roomNames = rooms.length ? rooms.map(r => r.name) : [...new Set(courses.filter(c => isActiveCourse(c) && c.campus === campus && c.room).map(c => c.room))];
    const curTeacher = document.getElementById('nc_teacher').value;
    const curRoom = document.getElementById('nc_room').value;
    setSelectOptions('nc_teacher', teacherNames, curTeacher);
    setSelectOptions('nc_room', roomNames, curRoom);
  } catch(e) {}
}

async function openNewCourseModal(prefill = {}) {
  if (!canEditNow()) {
    showToast('当前流程状态下不可新增排课');
    return;
  }
  const modal = document.getElementById('newCourseModal');
  setSelectOptions('nc_campus', allCampuses, prefill.campus);
  setSelectOptions('nc_period', [...new Set(courses.map(c => c.period))].sort(), prefill.period);
  setSelectOptions('nc_subject', getNewCourseSubjects(), prefill.subject);
  setSelectOptions('nc_grade', getNewCourseGrades(), prefill.grade);
  ['season','subject','grade','level','slot','day'].forEach(k => {
    const el = document.getElementById('nc_' + k);
    if (el && prefill[k]) el.value = prefill[k];
  });
  await refreshNewCourseResources();
  if (prefill.teacher) {
    const t = document.getElementById('nc_teacher');
    if ([...t.options].some(o => o.value === prefill.teacher)) t.value = prefill.teacher;
  }
  showAppModal('newCourseModal', '#nc_season');
  if (prefill.room) {
    const r = document.getElementById('nc_room');
    if (![...r.options].some(o => o.value === prefill.room)) {
      const opt = document.createElement('option');
      opt.value = prefill.room;
      opt.textContent = prefill.room;
      r.appendChild(opt);
    }
    r.value = prefill.room;
  }
  await previewNewCourseCode();
  await checkNewCourseConflict();
  scheduleAvailabilitySuggestions();
}

function closeNewCourseModal() {
  hideAppModal('newCourseModal');
}

async function previewNewCourseCode() {
  const p = newCoursePayload();
  const el = document.getElementById('nc_code_preview');
  try {
    const qs = new URLSearchParams({season:p.season, subject:p.subject, grade:p.grade, level:p.level, campus:p.campus});
    const res = await apiFetch(`${API_BASE}/api/preview-code?${qs.toString()}`);
    const data = await res.json();
    el.textContent = data.code ? `将生成编码：${data.code}` : '暂无法生成编码';
  } catch(e) { el.textContent = '编码预览失败'; }
}

async function checkNewCourseConflict() {
  const p = newCoursePayload();
  const el = document.getElementById('nc_conflict_info');
  try {
    const qs = new URLSearchParams({teacher:p.teacher, room:p.room, campus:p.campus, season:p.season, period:p.period, slot:p.slot, day:p.day});
    const res = await apiFetch(`${API_BASE}/api/check-conflict?${qs.toString()}`);
    const data = await res.json();
    const parts = [];
    if (data.teacher_conflict) parts.push(`教师冲突：${data.teacher_conflict.name || data.teacher_conflict.code}`);
    if (data.room_conflict) parts.push(`教室冲突：${data.room_conflict.name || data.room_conflict.code}`);
    if (data.shared_room_conflict) {
      const c = data.shared_room_conflict;
      parts.push(`跨部门教室冲突：${c.dept_label || c.dept_id || '其他部门'} ${c.name || c.code || ''}`);
    }
    el.style.background = parts.length ? '#ffebee' : '#e8f5e9';
    el.style.color = parts.length ? '#c62828' : '#2e7d32';
    el.textContent = parts.length ? parts.join('；') : '当前教师和教室无冲突';
  } catch(e) { el.textContent = '冲突检测失败'; }
}

let suggestTimer = null;
function scheduleAvailabilitySuggestions() {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(loadAvailabilitySuggestions, 250);
}

function fillSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (![...el.options].some(o => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    el.appendChild(opt);
  }
  el.value = value;
  checkNewCourseConflict();
}
function fillSelectValueFromEl(el) {
  fillSelectValue(el.dataset.targetId || '', el.dataset.value || '');
}

document.getElementById('newCourseModal')?.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-fill-select="1"]');
  if (!btn || !this.contains(btn)) return;
  fillSelectValueFromEl(btn);
});

async function loadAvailabilitySuggestions() {
  const p = newCoursePayload();
  const teacherBox = document.getElementById('nc_teacher_suggest');
  const roomBox = document.getElementById('nc_room_suggest');
  if (!teacherBox || !roomBox || !p.campus || !p.season || !p.period || !p.slot) return;
  teacherBox.textContent = '正在查找空闲教师...';
  roomBox.textContent = '正在查找空闲教室...';
  try {
    const qs = new URLSearchParams({campus:p.campus, season:p.season, period:p.period, subject:p.subject});
    const res = await apiFetch(`${API_BASE}/api/available-slots?${qs.toString()}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'available failed');
    const isAvailable = item => (item.available || []).some(a => a.period === p.period && a.slot === p.slot && (!a.day || !p.day || a.day === p.day));
    const teachers = (data.teachers || []).filter(isAvailable).slice(0, 8);
    const rooms = (data.classrooms || []).filter(isAvailable).slice(0, 8);
    const btnStyle = 'display:inline-block;margin:3px 4px 0 0;padding:2px 6px;border-radius:4px;background:#e3f2fd;color:#1565c0;cursor:pointer;';
    teacherBox.innerHTML = teachers.length
      ? '推荐教师：' + teachers.map(t => `<button type="button" style="${btnStyle};border:0;" data-fill-select="1" data-target-id="nc_teacher" data-value="${escapeAttr(t.name)}">${escapeHtml(t.name)}</button>`).join('')
      : '<span style="color:#999;">该时段暂无推荐教师</span>';
    roomBox.innerHTML = rooms.length
      ? '推荐教室：' + rooms.map(r => `<button type="button" style="${btnStyle};border:0;" data-fill-select="1" data-target-id="nc_room" data-value="${escapeAttr(r.name)}">${escapeHtml(roomShortName(r.name, p.campus))}</button>`).join('')
      : '<span style="color:#999;">该时段暂无推荐教室</span>';
  } catch(e) {
    teacherBox.innerHTML = '<span style="color:#999;">推荐教师加载失败</span>';
    roomBox.innerHTML = '<span style="color:#999;">推荐教室加载失败</span>';
  }
}

async function submitNewCourse() {
  const btn = document.getElementById('nc_submit');
  btn.disabled = true;
  btn.textContent = '提交中...';
  try {
    const payload = newCoursePayload();
    if (!(await confirmSundayAfternoonIfNeeded(null, payload))) return;
    const res = await apiFetch(`${API_BASE}/api/courses`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (await handleVersionConflict(res, data)) return;
    if (!res.ok || data.error) {
      document.getElementById('nc_conflict_info').textContent = data.error || '新增失败';
      document.getElementById('nc_conflict_info').style.background = '#ffebee';
      document.getElementById('nc_conflict_info').style.color = '#c62828';
      return;
    }
    applyResponseVersion(res);
    showToast('插空排课成功：' + data.code);
    closeNewCourseModal();
    await loadData();
  } catch(e) {
    showToast('新增失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '确认排课';
  }
}

['nc_season','nc_campus','nc_subject','nc_grade','nc_level','nc_teacher','nc_room','nc_period','nc_slot','nc_day','nc_class_kind'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', async () => {
    if (['nc_campus','nc_subject'].includes(id)) await refreshNewCourseResources();
    await previewNewCourseCode();
    await checkNewCourseConflict();
    scheduleAvailabilitySuggestions();
  });
});

async function logoutUser() {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/auth';
}

// === Excel 导入功能 ===
let importPreviewReady = false;
let importPreviewFingerprint = null;

function currentImportMode() {
  return document.getElementById('importMode')?.value || 'replace';
}

function importFingerprint(file, mode = currentImportMode()) {
  if (!file) return null;
  return {
    name: file.name || '',
    size: file.size || 0,
    lastModified: file.lastModified || 0,
    mode,
  };
}

function sameImportFingerprint(a, b) {
  return !!a && !!b
    && a.name === b.name
    && a.size === b.size
    && a.lastModified === b.lastModified
    && a.mode === b.mode;
}

function resetImportPreview() {
  importPreviewReady = false;
  importPreviewFingerprint = null;
  const preview = document.getElementById('importPreview');
  if (preview) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }
  const btn = document.getElementById('importBtn');
  if (btn) btn.textContent = '预检文件';
}

document.getElementById('importFile').addEventListener('change', function(e) {
  const file = e.target.files[0];
  resetImportPreview();
  if (file) {
    document.getElementById('fileName').textContent = file.name + ' (' + (file.size/1024).toFixed(0) + 'KB)';
  }
});

document.getElementById('importMode')?.addEventListener('change', resetImportPreview);

const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#1a237e'; dropZone.style.background = '#e8eaf6'; });
dropZone.addEventListener('dragleave', e => { e.preventDefault(); dropZone.style.borderColor = '#ccc'; dropZone.style.background = ''; });
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.style.borderColor = '#ccc'; dropZone.style.background = '';
  const file = e.dataTransfer.files[0];
  if (file && file.name.toLowerCase().endsWith('.xlsx')) {
    document.getElementById('importFile').files = e.dataTransfer.files;
    document.getElementById('fileName').textContent = file.name + ' (' + (file.size/1024).toFixed(0) + 'KB)';
    resetImportPreview();
  } else {
    showToast('请上传 xlsx 文件');
  }
});

async function previewImport(file) {
  const btn = document.getElementById('importBtn');
  const preview = document.getElementById('importPreview');
  const mode = currentImportMode();
  const fingerprint = importFingerprint(file, mode);
  btn.textContent = '预检中...';
  btn.disabled = true;
  const formData = new FormData();
  formData.append('file', file);
  if (mode !== 'replace') formData.append('mode', mode);
  try {
    const endpoint = mode === 'replace' ? `${API_BASE}/api/import/preview` : `${API_BASE}/api/import/generate/preview`;
    const res = await apiFetch(endpoint, { method: 'POST', body: formData });
    const data = await readJsonResponse(res, '导入预检');
    if (!res.ok || !data.ok) {
      showToast('预检失败: ' + (data.error || '未知错误'));
      return;
    }
    const p = data.preview;
    if (mode !== 'replace') {
      const transforms = (p.sample_code_transform || []).map(item => {
        const to = Object.entries(item.to || {}).map(([season, code]) => `${escapeHtml(season)}：${escapeHtml(code)}`).join('，');
        return `<div style="margin-top:3px;color:#555;">${escapeHtml(item.from)} → ${to}</div>`;
      }).join('');
      const seasonCounts = Object.entries(p.season_counts || {}).map(([season, count]) => `<div>${escapeHtml(season)}：<b>${escapeHtml(count)}</b></div>`).join('');
      const campusRows = Object.entries(p.campus_counts || {}).sort((a,b) => b[1] - a[1]).slice(0, 12)
        .map(([campus, count]) => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:3px 0;"><span>${escapeHtml(shortCampus(campus))}</span><b>${escapeHtml(count)}</b></div>`).join('');
      const warnings = (p.warnings || []).map(w => `<div style="color:#e65100;margin-top:4px;">${escapeHtml(w)}</div>`).join('');
      preview.innerHTML = `
        <div style="font-weight:600;color:#1a237e;margin-bottom:8px;">转换预检通过</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;">
          <div>源文件班级：<b>${escapeHtml(p.source_count || 0)}</b></div>
          <div>过滤后班级：<b>${escapeHtml(p.remaining_after_filter || 0)}</b></div>
          ${mode === 'spring_to_summer_autumn' ? `<div>去除毕业年级：<b>${escapeHtml(p.removed_graduating || 0)}</b></div>` : ''}
          <div>生成总量：<b>${escapeHtml(p.total_output || 0)}</b></div>
          ${seasonCounts}
        </div>
        ${campusRows ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #e0e0e0;"><b>各校区生成数量</b><div style="margin-top:5px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0 14px;">${campusRows}</div></div>` : ''}
        ${transforms ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #e0e0e0;"><b>编码转换示例</b>${transforms}</div>` : ''}
        ${warnings || '<div style="color:#2e7d32;margin-top:8px;">未发现明显异常</div>'}
      `;
      preview.classList.remove('hidden');
      importPreviewReady = true;
      importPreviewFingerprint = fingerprint;
      btn.textContent = '确认生成并覆盖';
      return;
    }
    const warnings = (p.warnings || []).map(w => `<div style="color:#e65100;margin-top:4px;">${escapeHtml(w)}</div>`).join('');
    const skippedDetails = (p.skipped_details || []).map(item => `<div style="color:#795548;margin-top:3px;">第 ${escapeHtml(item.row)} 行：${escapeHtml(item.reason)}</div>`).join('');
    if (p.import_type === 'yiduiyi_heatmap') {
      preview.innerHTML = `
        <div style="font-weight:600;color:#1a237e;margin-bottom:8px;">一对一课次预检通过</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;">
          <div>当前课次：<b>${escapeHtml(p.current_count)}</b></div>
          <div>导入后课次：<b>${escapeHtml(p.replace_count)}</b></div>
          <div>教师数：<b>${escapeHtml(p.teacher_count)}</b></div>
          <div>校区数：<b>${escapeHtml(p.campus_count)}</b></div>
          <div>科目数：<b>${escapeHtml(p.subject_count || 0)}</b></div>
          <div>总课时：<b>${escapeHtml(p.total_hours || 0)}h</b></div>
          <div style="grid-column:1 / -1;">日期范围：<b>${escapeHtml(p.date_range || '未识别')}</b></div>
        </div>
        ${warnings || '<div style="color:#2e7d32;margin-top:8px;">未发现明显异常</div>'}
        ${skippedDetails ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid #eee;"><b>未解析行提示</b>${skippedDetails}</div>` : ''}
      `;
      preview.classList.remove('hidden');
      importPreviewReady = true;
      importPreviewFingerprint = fingerprint;
      btn.textContent = '确认覆盖并生成热力图';
      return;
    }
    const diff = p.diff || {};
    const changedSample = (diff.changed || []).slice(0, 5).map(item =>
      `<div style="margin-top:3px;color:#555;">${escapeHtml(item.code || '')} ${escapeHtml(item.name || '')}：${escapeHtml(item.diffs.map(d => FIELD_LABELS[d.field] || d.field).join('、'))}</div>`
    ).join('');
    preview.innerHTML = `
      <div style="font-weight:600;color:#1a237e;margin-bottom:8px;">预检通过</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;">
        <div>当前班级：<b>${escapeHtml(p.current_count)}</b></div>
        <div>导入后：<b>${escapeHtml(p.replace_count)}</b></div>
        <div>按编码覆盖：<b>${escapeHtml(p.overwritten_by_code)}</b></div>
        <div>按编码新增：<b>${escapeHtml(p.added_by_code)}</b></div>
        <div>校区数：<b>${escapeHtml(p.campus_count)}</b></div>
        <div>教师数：<b>${escapeHtml(p.teacher_count)}</b></div>
      </div>
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #e0e0e0;">
        差异：新增 <b>${escapeHtml(diff.added_count || 0)}</b>，删除 <b>${escapeHtml(diff.removed_count || 0)}</b>，字段变化 <b>${escapeHtml(diff.changed_count || 0)}</b>
        ${changedSample ? `<div style="margin-top:6px;">${changedSample}</div>` : ''}
      </div>
      ${warnings || '<div style="color:#2e7d32;margin-top:8px;">未发现明显异常</div>'}
      ${skippedDetails ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid #eee;"><b>未解析行提示</b>${skippedDetails}</div>` : ''}
    `;
    preview.classList.remove('hidden');
    importPreviewReady = true;
    importPreviewFingerprint = fingerprint;
    btn.textContent = '确认覆盖导入';
  } catch(e) {
    showToast('预检失败: 网络连接异常');
  } finally {
    btn.disabled = false;
    if (!importPreviewReady) btn.textContent = '预检文件';
  }
}

async function doImport() {
  const fileInput = document.getElementById('importFile');
  if (!fileInput.files[0]) { showToast('请先选择文件'); return; }
  const mode = currentImportMode();
  const fingerprint = importFingerprint(fileInput.files[0], mode);
  if (!importPreviewReady || !sameImportFingerprint(importPreviewFingerprint, fingerprint)) {
    if (importPreviewReady) showToast('文件或导入模式已变化，请重新预检');
    resetImportPreview();
    await previewImport(fileInput.files[0]);
    return;
  }
  const ok = await confirmAction({
    title: '覆盖导入复核',
    message: '确认用该 Excel 覆盖当前批次数据？当前数据会进入历史版本。',
    confirmText: '确认导入',
    danger: true,
  });
  if (!ok) return;
  const reason = await askActionReason('导入数据', '覆盖导入会替换当前批次数据，建议记录导入文件来源或调整背景。');
  if (reason === null) return;
  const btn = document.getElementById('importBtn');
  btn.textContent = '导入中...';
  btn.disabled = true;

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  if (mode !== 'replace') formData.append('mode', mode);
  formData.append('reason', reason);

  try {
    const endpoint = mode === 'replace' ? `${API_BASE}/api/import` : `${API_BASE}/api/import/generate`;
    const res = await apiFetch(endpoint, { method: 'POST', body: formData });
    const data = await readJsonResponse(res, '导入');
    if (await handleVersionConflict(res, data)) {
      btn.textContent = '预检文件';
      btn.disabled = false;
      resetImportPreview();
      return;
    }
    if (data.ok) {
      applyResponseVersion(res);
      heatmapData = null;
      const successText = data.import_type === 'yiduiyi_heatmap'
        ? `导入成功! ${data.count} 条课次，${data.teacher_count || 0} 位教师，${data.total_hours || 0}h`
        : (mode === 'replace' ? ('导入成功! ' + data.count + ' 个班级') : ('生成成功! ' + (data.total || data.total_output || 0) + ' 个班级'));
      showToast(successText);
      hideAppModal('importModal');
      fileInput.value = '';
      document.getElementById('fileName').textContent = '';
      resetImportPreview();
      await loadData();
    } else {
      showToast('导入失败: ' + (data.error || '未知错误'));
    }
  } catch(e) {
    showToast('导入失败: 网络连接异常');
  }
  btn.textContent = importPreviewReady ? '确认覆盖导入' : '预检文件';
  btn.disabled = false;
}

function renderDiffSummary(diff) {
  if (!diff) return '<span style="color:#999;">这个备份和当前排课基本一致。</span>';
  const changed = (diff.changed || []).slice(0, 8).map(item => {
    const rows = item.diffs.map(d => `
      <div style="padding:2px 0;">
        <span style="background:#fff3e0;padding:1px 6px;border-radius:3px;">${escapeHtml(FIELD_LABELS[d.field] || d.field)}</span>
        <span style="color:#c62828;text-decoration:line-through;margin:0 4px;">${escapeHtml(d.from || '(空)')}</span>→
        <span style="color:#2e7d32;font-weight:600;margin-left:4px;">${escapeHtml(d.to || '(空)')}</span>
      </div>
    `).join('');
    return `<div style="padding:6px 0;border-top:1px solid #eee;">
      <div style="font-weight:600;color:#1565c0;margin-bottom:3px;">${escapeHtml(item.code || '')} ${escapeHtml(item.name || '')}</div>
      ${rows}
    </div>`;
  }).join('');
  const added = (diff.added || []).slice(0, 5).map(item =>
    `<div style="padding:2px 0;color:#2e7d32;">+ ${escapeHtml(item.code || '')} ${escapeHtml(item.name || '')} ${escapeHtml(item.campus || '')}</div>`
  ).join('');
  const removed = (diff.removed || []).slice(0, 5).map(item =>
    `<div style="padding:2px 0;color:#c62828;">- ${escapeHtml(item.code || '')} ${escapeHtml(item.name || '')} ${escapeHtml(item.campus || '')}</div>`
  ).join('');
  return `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:6px;">
      <span>新增 <b style="color:#2e7d32;">${escapeHtml(diff.added_count || 0)}</b></span>
      <span>删除 <b style="color:#c62828;">${escapeHtml(diff.removed_count || 0)}</b></span>
      <span>变化 <b style="color:#e65100;">${escapeHtml(diff.changed_count || 0)}</b></span>
    </div>
    ${added ? `<div style="margin-top:6px;">${added}</div>` : ''}
    ${removed ? `<div style="margin-top:6px;">${removed}</div>` : ''}
    ${changed || '<div style="color:#999;">没有具体排课项变化，可能只是保存了一次备份。</div>'}
  `;
}

async function previewHistoryDiff(filename) {
  const box = document.getElementById('historyDiff-' + filename.replace(/[^\w-]/g, '_'));
  if (!box) return;
  if (!box.classList.contains('hidden')) {
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = '<span style="color:#999;">加载差异...</span>';
  box.classList.remove('hidden');
  try {
    const res = await apiFetch(`${API_BASE}/api/history/${encodeURIComponent(filename)}/diff`);
    const data = await res.json();
    if (!res.ok || data.error) {
      box.innerHTML = '<span style="color:#c62828;">差异加载失败</span>';
      return;
    }
    box.innerHTML = renderDiffSummary(data.diff);
  } catch(e) {
    box.innerHTML = '<span style="color:#c62828;">差异加载失败</span>';
  }
}

async function rollbackHistory(filename) {
  let detail = '';
  try {
    const previewRes = await apiFetch(`${API_BASE}/api/rollback/${encodeURIComponent(filename)}/preview`);
    const preview = await previewRes.json();
    if (previewRes.ok && preview.diff) {
      detail = `\n恢复后：新增 ${preview.diff.added_count || 0}，删除 ${preview.diff.removed_count || 0}，修改 ${preview.diff.changed_count || 0}`;
    }
  } catch(e) {}
  const ok = await confirmAction({
    title: '恢复历史备份',
    message: `确认恢复到这个时间点的排课？当前排课会先自动保存一份备份。${detail}`,
    confirmText: '确认恢复',
    danger: true,
  });
  if (!ok) return;
  const reason = await askActionReason('恢复历史备份', '历史恢复会影响整个批次，建议记录恢复原因和确认人。');
  if (reason === null) return;
  setSyncStatus('saving');
  try {
    const res = await apiFetch(`${API_BASE}/api/rollback/${encodeURIComponent(filename)}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reason})});
    const data = await res.json();
    if (await handleVersionConflict(res, data)) return;
    if (!res.ok || data.error) throw new Error(data.error || 'rollback failed');
    applyResponseVersion(res);
    showToast('已恢复到选中的备份');
    await loadData();
    await renderChangelog();
    setSyncStatus('saved');
  } catch(e) {
    setSyncStatus('');
    showToast('回滚失败');
  }
}

async function renderHistory() {
  const panel = document.getElementById('historyPanel');
  if (!panel) return;
  panel.innerHTML = '<div style="color:#999;">加载历史版本...</div>';
  try {
    const res = await apiFetch(API_BASE + '/api/history');
    if (!res.ok) { panel.innerHTML = ''; return; }
    const list = await res.json();
    if (!list.length) {
      panel.innerHTML = '<div style="background:white;border-radius:8px;padding:14px;color:#999;">暂无历史版本</div>';
      return;
    }
    panel.innerHTML = `
      <div style="background:white;border-radius:8px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div>
            <b style="color:#1a237e;">可恢复的备份</b>
            <div style="font-size:11px;color:#777;margin-top:3px;">每次导入、恢复或重要修改前，系统会自动留一份备份。</div>
          </div>
          <button class="btn" style="background:#e8f5e9;color:#2e7d32;padding:4px 10px;" data-history-action="download-current" title="下载一份当前排课数据，误操作时可交给管理员恢复">下载当前排课备份</button>
        </div>
        ${list.map(item => {
          const id = 'historyDiff-' + item.filename.replace(/[^\w-]/g, '_');
          const summary = item.summary_pending
            ? '旧备份摘要未预先计算，点击“查看修改内容”后加载完整差异。'
            : `${item.class_count || 0} 个班级 · 与当前相比：新增 ${item.added_count || 0}，删除 ${item.removed_count || 0}，修改 ${item.changed_count || 0}`;
          const kindText = item.backup_kind === 'before_change' ? '操作前备份' : '历史快照';
          const versionText = item.before_version && item.after_version ? `版本 ${item.before_version} → ${item.after_version}` : '';
          const fieldSummary = ((item.diff_summary && item.diff_summary.fields) || []).map(f => `${f.field} ${f.count}`).join('，');
          return `<div style="border-top:1px solid #f0f0f0;padding:12px 0;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div style="min-width:260px;">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <div style="font-weight:700;color:#1a237e;">${escapeHtml(item.title || '自动备份')}</div>
                  <span style="font-size:11px;background:#eef2ff;color:#3730a3;border-radius:10px;padding:2px 7px;">${escapeHtml(kindText)}</span>
                  ${versionText ? `<span style="font-size:11px;color:#777;">${escapeHtml(versionText)}</span>` : ''}
                </div>
                <div style="color:#555;margin-top:4px;">保存时间：${escapeHtml(item.saved_at || item.mtime || '')}</div>
                <div style="color:#555;margin-top:3px;">操作人：${escapeHtml(item.actor || '系统自动保存')}</div>
                ${item.reason ? `<div style="color:#795548;background:#fff8e1;border-radius:4px;padding:4px 7px;margin-top:5px;display:inline-block;">原因：${escapeHtml(item.reason)}</div>` : ''}
                ${fieldSummary ? `<div style="color:#555;font-size:11px;margin-top:4px;">本次操作主要改动：${escapeHtml(fieldSummary)}</div>` : ''}
                <div style="color:#888;font-size:11px;margin-top:3px;">${escapeHtml(summary)}</div>
                ${item.backup_kind === 'before_change' ? '<div style="color:#999;font-size:11px;margin-top:3px;">恢复会回到这次操作发生之前的排课状态。</div>' : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-refresh" style="padding:4px 10px;" data-history-action="preview" data-filename="${escapeAttr(item.filename)}">查看修改内容</button>
                <button class="btn" style="background:#fff3e0;color:#e65100;padding:4px 10px;" data-history-action="rollback" data-filename="${escapeAttr(item.filename)}">预览并恢复</button>
                <button class="btn" style="background:#f5f5f5;color:#555;padding:4px 10px;" data-history-action="download" data-url="${escapeAttr(`${API_BASE}/api/history/${encodeURIComponent(item.filename)}/download`)}">下载备份</button>
              </div>
            </div>
            <div id="${id}" class="hidden" style="margin-top:8px;background:#fafafa;border:1px solid #eee;border-radius:6px;padding:8px;"></div>
          </div>`;
        }).join('')}
      </div>`;
  } catch(e) {
    panel.innerHTML = '<div style="color:#c62828;">历史版本加载失败</div>';
  }
}

document.getElementById('historyPanel')?.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-history-action]');
  if (!btn || !this.contains(btn)) return;
  const action = btn.dataset.historyAction;
  if (action === 'download-current') return downloadJsonBackup();
  if (action === 'preview') return previewHistoryDiff(btn.dataset.filename);
  if (action === 'rollback') return rollbackHistory(btn.dataset.filename);
  if (action === 'download' && btn.dataset.url) {
    window.location.href = btn.dataset.url;
  }
});

async function renderChangelog() {
  await renderHistory();
  const container = document.getElementById('changelogList');
  container.innerHTML = '<p style="color:#999;">加载中...</p>';
  try {
    const res = await apiFetch(API_BASE + '/api/changelog');
    if (!res.ok) { container.innerHTML = '<p style="color:#999;">暂无记录</p>'; return; }
    const log = await res.json();
    if (!log.length) { container.innerHTML = '<p style="color:#999;">暂无修改记录</p>'; return; }
    container.innerHTML = log.map(entry => {
      const changes = entry.changes.map(c =>
        `<div style="padding:4px 0;border-bottom:1px solid #f5f5f5;">
          <span style="color:#1565c0;font-weight:500;">${escapeHtml(c.code)}</span>
          <span style="color:#666;margin:0 4px;">${escapeHtml(c.name)}</span>
          <span style="background:#fff3e0;padding:1px 6px;border-radius:3px;">${escapeHtml(FIELD_LABELS[c.field] || c.field)}</span>
          <span style="color:#c62828;text-decoration:line-through;margin:0 4px;">${escapeHtml(c.from || '(空)')}</span>→
          <span style="color:#2e7d32;font-weight:500;margin-left:4px;">${escapeHtml(c.to || '(空)')}</span>
        </div>`
      ).join('');
      return `<div style="background:white;border-radius:8px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:600;color:#1a237e;">${escapeHtml(entry.user)}</span>
          <span style="color:#999;font-size:11px;">${escapeHtml(entry.time)}</span>
        </div>
        <div style="font-size:11px;color:#666;margin-bottom:6px;">${escapeHtml(entry.action || '排课调整')} · ${entry.changes.length} 项修改</div>
        ${entry.reason ? `<div style="font-size:11px;color:#795548;background:#fff8e1;padding:5px 8px;border-radius:4px;margin-bottom:6px;">原因：${escapeHtml(entry.reason)}</div>` : ''}
        ${changes}
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = '<p style="color:#c62828;">加载失败</p>';
  }
}

function getHeatmapCampusColor(campus) {
  if (!CAMPUS_COLORS[campus]) {
    const idx = Object.keys(CAMPUS_COLORS).length % COLOR_PALETTE.length;
    CAMPUS_COLORS[campus] = COLOR_PALETTE[idx];
  }
  return CAMPUS_COLORS[campus];
}
function shortCampusName(name) {
  return name.replace(/教学区$/, '').replace(/购物中心/, '').replace(/广场/, '');
}

function resetHeatmapVisibleLimit() {
  heatmapVisibleLimit = HEATMAP_PAGE_SIZE;
}

async function renderHeatmap() {
  const container = document.getElementById('heatmapContent');
  if (!heatmapData) {
    container.innerHTML = '<p style="color:#999;">加载中...</p>';
    try {
      const res = await apiFetch(API_BASE + '/api/capacity');
      if (!res.ok) { container.innerHTML = '<p style="color:#999;">该批次无产能数据</p>'; return; }
      heatmapData = await res.json();
      const cSel = document.getElementById('hmCampus');
      const sSel = document.getElementById('hmSubject');
      const selectedCampus = cSel?.value || '';
      const selectedSubject = sSel?.value || '';
      if (cSel) cSel.innerHTML = '<option value="">全部</option>';
      if (sSel) sSel.innerHTML = '<option value="">全部</option>';
      (heatmapData.all_campuses || []).forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = shortCampusName(c); cSel?.appendChild(o); });
      const subjects = new Set();
      heatmapData.teachers.forEach(t => t.subjects.forEach(s => subjects.add(s)));
      [...subjects].sort().forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sSel?.appendChild(o); });
      if (selectedCampus && Array.from(cSel?.options || []).some(o => o.value === selectedCampus)) cSel.value = selectedCampus;
      if (selectedSubject && Array.from(sSel?.options || []).some(o => o.value === selectedSubject)) sSel.value = selectedSubject;
    } catch(e) { container.innerHTML = '<p style="color:#c62828;">加载失败</p>'; return; }
  }
  const campusF = document.getElementById('hmCampus').value;
  const subjectF = document.getElementById('hmSubject').value;
  const searchF = document.getElementById('hmSearch').value.trim().toLowerCase();
  const halfRunOnly = document.getElementById('hmHalfRun').checked;
  const signature = [campusF, subjectF, searchF, halfRunOnly ? '1' : '0'].join('|');
  if (signature !== heatmapFilterSignature) {
    heatmapFilterSignature = signature;
    resetHeatmapVisibleLimit();
  }
  const renderSignature = JSON.stringify({
    version: loadedVersion || '',
    campusF,
    subjectF,
    searchF,
    halfRunOnly,
    visibleLimit: heatmapVisibleLimit,
    teacherCount: heatmapData.teachers?.length || 0,
    dateCount: heatmapData.dates?.length || 0,
    slotCount: heatmapData.slots?.length || 0,
  });
  if (heatmapRenderSignature === renderSignature) return;

  let teachers = heatmapData.teachers;
  if (campusF) teachers = teachers.filter(t => t.campuses.includes(campusF));
  if (subjectF) teachers = teachers.filter(t => t.subjects.includes(subjectF));
  if (searchF) teachers = teachers.filter(t => t.name.toLowerCase().includes(searchF));
  if (halfRunOnly) {
    teachers = teachers.filter(t => {
      const dates = heatmapData.dates;
      const amSlots = ['早一','早二'], pmSlots = ['下一','下二'];
      for (const d of dates) {
        const dayData = t.schedule[d] || {};
        for (const group of [amSlots, pmSlots]) {
          const cs = new Set();
          group.forEach(s => { const cell = dayData[s]; if (cell) (cell.campuses || []).forEach(c => cs.add(c)); });
          if (cs.size > 1) return true;
        }
      }
      return false;
    });
  }

  const dates = heatmapData.dates;
  const slots = heatmapData.slots;
  const weekdays = ['日','一','二','三','四','五','六'];
  const totalTeachers = teachers.length;
  const visibleTeachers = teachers.slice(0, Math.min(heatmapVisibleLimit, totalTeachers));

  // 图例
  let legend = '<div style="margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:11px;">';
  legend += '<span style="color:#666;">校区图例：</span>';
  (heatmapData.all_campuses || []).forEach(c => {
    const color = getHeatmapCampusColor(c);
    legend += `<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:10px;height:10px;border-radius:2px;background:${color};display:inline-block;"></span>${escapeHtml(shortCampusName(c))}</span>`;
  });
  legend += '<span style="margin-left:12px;color:#c62828;">● 跑多校区</span>';
  legend += '<span style="margin-left:8px;"><span style="display:inline-block;width:10px;height:10px;border:2px solid #ff6f00;border-radius:2px;"></span> 半段跑（上午/下午内跨校区）</span>';
  legend += '</div>';

  let html = legend;
  html += '<table style="border-collapse:collapse;width:100%;background:white;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';
  html += '<thead><tr><th style="padding:6px 8px;border:1px solid #e0e0e0;background:#f5f7ff;position:sticky;left:0;z-index:2;min-width:70px;">教师</th>';
  html += '<th style="padding:6px 4px;border:1px solid #e0e0e0;background:#f5f7ff;font-size:10px;min-width:36px;">周课时</th>';
  html += '<th style="padding:6px 4px;border:1px solid #e0e0e0;background:#f5f7ff;font-size:10px;min-width:36px;">校区数</th>';
  dates.forEach(d => {
    const day = new Date(d);
    const wd = weekdays[day.getDay()];
    const short = d.slice(5);
    html += `<th colspan="${slots.length}" style="padding:6px;border:1px solid #e0e0e0;background:#f5f7ff;text-align:center;font-size:11px;">${escapeHtml(short)} 周${escapeHtml(wd)}</th>`;
  });
  html += '</tr><tr><th style="border:1px solid #e0e0e0;background:#f5f7ff;position:sticky;left:0;z-index:2;"></th>';
  html += '<th style="border:1px solid #e0e0e0;background:#f5f7ff;"></th>';
  html += '<th style="border:1px solid #e0e0e0;background:#f5f7ff;"></th>';
  dates.forEach(() => {
    slots.forEach(s => {
      html += `<th style="padding:2px 3px;border:1px solid #e0e0e0;background:#fafafa;font-size:9px;white-space:nowrap;">${escapeHtml(s)}</th>`;
    });
  });
  html += '</tr></thead><tbody>';

  visibleTeachers.forEach(t => {
    const multiCampus = t.campus_count > 1;
    html += `<tr><td style="padding:4px 8px;border:1px solid #e0e0e0;white-space:nowrap;position:sticky;left:0;background:white;z-index:1;font-weight:500;${multiCampus ? 'color:#c62828;' : ''}">${escapeHtml(t.name)}${multiCampus ? ' ●' : ''}</td>`;
    html += `<td style="padding:4px 4px;border:1px solid #e0e0e0;text-align:center;font-weight:600;">${t.total_hours}</td>`;
    html += `<td style="padding:4px 4px;border:1px solid #e0e0e0;text-align:center;${multiCampus ? 'color:#c62828;font-weight:600;' : ''}">${t.campus_count}</td>`;
    dates.forEach(d => {
      const dayData = t.schedule[d] || {};
      // 检测半段跑：上午(早一+早二)或下午(下一+下二)有不同校区
      const amSlots = ['早一','早二'], pmSlots = ['下一','下二'];
      function getHalfDayRun(slotGroup) {
        const campusesInHalf = new Set();
        slotGroup.forEach(s => {
          const cell = dayData[s];
          if (cell) (cell.campuses || []).forEach(c => campusesInHalf.add(c));
        });
        return campusesInHalf.size > 1;
      }
      const amRun = getHalfDayRun(amSlots);
      const pmRun = getHalfDayRun(pmSlots);

      slots.forEach(s => {
        const cell = dayData[s];
        const isHalfRun = (amSlots.includes(s) && amRun) || (pmSlots.includes(s) && pmRun);
        if (!cell) {
          html += `<td style="padding:2px;border:1px solid #e0e0e0;background:#fafafa;min-width:38px;"></td>`;
        } else {
          const campuses = cell.campuses || [];
          const mainCampus = campuses[0] || '';
          const color = getHeatmapCampusColor(mainCampus);
          const bg = color + '18';
          const label = campuses.map(c => shortCampusName(c)).join('/');
          const crossCampus = campuses.length > 1;
          const halfRunStyle = isHalfRun ? 'outline:2px solid #ff6f00;outline-offset:-2px;' : '';
          const lessonLines = (cell.lessons || []).slice(0, 6).map(l => {
            const bits = [l.time, l.subject, l.student, l.room && roomShortName(l.room, l.campus || mainCampus)].filter(Boolean);
            return bits.join(' · ');
          }).join('\n');
          const title = `${t.name} ${d} ${s}: ${cell.hours}h @ ${label}${isHalfRun ? ' [半段跑]' : ''}${lessonLines ? '\n' + lessonLines : ''}`;
          html += `<td style="padding:2px 3px;border:1px solid #e0e0e0;background:${bg};min-width:38px;text-align:center;font-size:10px;${crossCampus ? 'outline:2px solid #c62828;outline-offset:-2px;' : halfRunStyle}" title="${escapeAttr(title)}"><span style="color:${color};font-weight:600;">${escapeHtml(label)}</span>${isHalfRun ? '<br><span style="color:#ff6f00;font-size:8px;font-weight:700;">半段跑</span>' : ''}<br><span style="color:#666;font-size:9px;">${escapeHtml(cell.hours)}h</span></td>`;
        }
      });
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:8px;">
    <p style="margin:0;font-size:11px;color:#999;">已显示 ${visibleTeachers.length}/${totalTeachers} 位教师 · 格子显示校区+课时 · 红色标记=跑多校区</p>
    ${visibleTeachers.length < totalTeachers ? `<button type="button" class="btn btn-refresh" style="padding:5px 12px;font-size:12px;" data-heatmap-action="load-more">加载更多 ${Math.min(HEATMAP_PAGE_SIZE, totalTeachers - visibleTeachers.length)} 位</button>` : ''}
  </div>`;
  container.innerHTML = html;
  heatmapRenderSignature = renderSignature;
}

['hmCampus','hmSubject','hmSearch'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    markUserEditing(4000);
    if (id === 'hmSearch') debouncedRenderHeatmap();
    else renderHeatmap();
  });
});
document.getElementById('hmHalfRun')?.addEventListener('change', () => {
  markUserEditing(4000);
  renderHeatmap();
});
document.getElementById('heatmapContent')?.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-heatmap-action="load-more"]');
  if (!btn || !this.contains(btn)) return;
  heatmapVisibleLimit += HEATMAP_PAGE_SIZE;
  renderHeatmap();
});
