(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     Constants & tiny helpers
     ------------------------------------------------------------------------ */

  const STORAGE_KEY = 'yiyu.focus.v1';
  const APP_NAME = '一隅';
  const DAY_MS = 86_400_000;
  const WEEKDAY_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  const PHASES = ['focus', 'short', 'long'];
  const MAX_ESTIMATE = 6;
  const MAX_IMPORT_SIZE = 5 * 1024 * 1024;

  const EMPTY_ART = `
    <svg class="empty-art" viewBox="0 0 160 120" fill="none" aria-hidden="true">
      <ellipse cx="80" cy="102" rx="42" ry="6.5" fill="#e6ddcf" opacity=".5"/>
      <path d="M80 42c-16.2 0-29 12.6-29 28.5S63.8 99 80 99s29-12.6 29-28.5S96.2 42 80 42Z" fill="#fbede6" stroke="#d6856e" stroke-width="1.4"/>
      <path d="M80 42c-3-9 2-17.2 11-20 2.5 8.7-1.6 16.6-11 20Z" fill="#a5b8a0"/>
      <path d="M80 42c4-8 12-12 20-9-2.5 8-11 12-20 9Z" fill="#c4d1bb"/>
      <path d="M80 42V30" stroke="#8fa38c" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M80 29c-6-1-10-5-11-11 6 .5 10 4.5 11 11Z" fill="#b3c3aa"/>
      <path d="M67 70c1.5-6.5 6-10.5 12-12" stroke="#efb3a1" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M55 52c-1-3-3-5-6-6M113 70c3-1 5-3 6-6M108 33l4-4M44 78l-4 4" stroke="#cfc4b4" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="119" cy="83" r="2" fill="#d7ccbc"/>
      <circle cx="44" cy="47" r="1.5" fill="#d7ccbc"/>
      <path d="M86 95c6-1 10-4 13-9" stroke="#e8bfb2" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>
    </svg>`;

  const pad2 = (value) => String(value).padStart(2, '0');

  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseDateKey(key) {
    const [year, month, day] = String(key).split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function isValidDateKey(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const date = parseDateKey(key);
    return !Number.isNaN(date.getTime()) && dateKey(date) === key;
  }

  function shiftDateKey(key, days) {
    const date = parseDateKey(key);
    date.setDate(date.getDate() + days);
    return dateKey(date);
  }

  function normalizeRange(start, end) {
    return start <= end ? [start, end] : [end, start];
  }

  function eachDateInRange(start, end, callback) {
    const [from, to] = normalizeRange(start, end);
    let current = from;
    let guard = 0;
    while (current <= to && guard < 400) {
      callback(current);
      current = shiftDateKey(current, 1);
      guard += 1;
    }
  }

  function isContiguousDateKeys(dates) {
    if (!Array.isArray(dates) || dates.length < 2) return true;
    for (let index = 0; index < dates.length - 1; index += 1) {
      if (shiftDateKey(dates[index], 1) !== dates[index + 1]) return false;
    }
    return true;
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function clampInt(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function formatClock(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${pad2(minutes)}:${pad2(seconds)}`;
  }

  function formatTimeOfDay(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function minutesLabel(minutes) {
    return `${minutes} 分钟`;
  }

  function getGreeting(date = new Date()) {
    const hour = date.getHours();
    if (hour < 5) return '夜深了';
    if (hour < 8) return '早上好';
    if (hour < 11) return '上午好';
    if (hour < 13) return '中午好';
    if (hour < 17) return '下午好';
    if (hour < 19) return '傍晚好';
    return '晚上好';
  }

  function iconMarkup(name) {
    return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function safeId(value) {
    const candidate = String(value || '');
    return /^[A-Za-z0-9_-]{1,100}$/.test(candidate) ? candidate : makeId();
  }

  /* ------------------------------------------------------------------------
     Data model
     ------------------------------------------------------------------------ */

  const CLEANUP_MODES = ['off', 'daily', 'weekly', 'monthly', 'once'];

  function normalizeClockTime(value, fallback = '23:00') {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return fallback;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return fallback;
    }
    return `${pad2(hours)}:${pad2(minutes)}`;
  }

  function normalizeAutoClear(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      mode: CLEANUP_MODES.includes(source.mode) ? source.mode : 'off',
      time: normalizeClockTime(source.time),
      onceDate: isValidDateKey(source.onceDate) ? source.onceDate : '',
      weekday: clampInt(source.weekday, 1, 7, 1),
      monthDay: clampInt(source.monthDay, 1, 31, 1),
      lastRunAt: Number.isFinite(source.lastRunAt) && source.lastRunAt > 0 ? source.lastRunAt : 0
    };
  }

  function defaultSettings() {
    return {
      focusMin: 25,
      shortMin: 5,
      longMin: 15,
      rounds: 4,
      sound: true,
      notifications: false,
      autoStart: false,
      resetRuntimeOnStart: true,
      autoClear: normalizeAutoClear(null)
    };
  }

  function durationForPhase(phase, settings) {
    const minutes = phase === 'focus'
      ? settings.focusMin
      : phase === 'short'
        ? settings.shortMin
        : settings.longMin;
    return minutes * 60_000;
  }

  function createDefaultState() {
    const settings = defaultSettings();
    const duration = durationForPhase('focus', settings);
    return {
      version: 1,
      tasks: [],
      sessions: [],
      settings,
      timer: {
        phase: 'focus',
        durationMs: duration,
        remainingMs: duration,
        running: false,
        endAt: null,
        cycleDone: 0,
        activeTaskId: null
      }
    };
  }

  function normalizeState(raw) {
    const defaults = createDefaultState();
    if (!raw || typeof raw !== 'object') return defaults;

    const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const settings = {
      focusMin: clampInt(rawSettings.focusMin, 1, 120, 25),
      shortMin: clampInt(rawSettings.shortMin, 1, 60, 5),
      longMin: clampInt(rawSettings.longMin, 1, 120, 15),
      rounds: clampInt(rawSettings.rounds, 1, 8, 4),
      sound: rawSettings.sound !== false,
      notifications: rawSettings.notifications === true,
      autoStart: rawSettings.autoStart === true,
      resetRuntimeOnStart: rawSettings.resetRuntimeOnStart !== false,
      autoClear: normalizeAutoClear(rawSettings.autoClear)
    };

    const seenTaskIds = new Set();
    const tasks = [];
    if (Array.isArray(raw.tasks)) {
      for (const entry of raw.tasks) {
        if (!entry || typeof entry !== 'object') continue;
        if (!isValidDateKey(entry.date)) continue;
        const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 120) : '';
        if (!title) continue;

        let id = safeId(entry.id);
        if (seenTaskIds.has(id)) id = makeId();
        seenTaskIds.add(id);

        const completed = entry.completed === true;
        const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now();
        tasks.push({
          id,
          date: entry.date,
          title,
          estimate: clampInt(entry.estimate, 1, 12, 1),
          pomosDone: clampInt(entry.pomosDone, 0, 999, 0),
          completed,
          createdAt,
          completedAt: completed
            ? (Number.isFinite(entry.completedAt) ? entry.completedAt : createdAt)
            : null
        });
      }
    }

    const sessions = [];
    if (Array.isArray(raw.sessions)) {
      for (const entry of raw.sessions) {
        if (!entry || typeof entry !== 'object') continue;
        if (!isValidDateKey(entry.date)) continue;
        const minutes = clampNumber(entry.minutes, 0.1, 240, 0);
        if (!minutes) continue;
        const completedAt = Number.isFinite(entry.completedAt) ? entry.completedAt : Date.now();
        sessions.push({
          id: safeId(entry.id),
          date: entry.date,
          minutes: Math.round(minutes * 10) / 10,
          completedAt
        });
      }
    }

    const rawTimer = raw.timer && typeof raw.timer === 'object' ? raw.timer : {};
    const phase = PHASES.includes(rawTimer.phase) ? rawTimer.phase : 'focus';
    const fallbackDuration = durationForPhase(phase, settings);
    let durationMs = clampInt(rawTimer.durationMs, 60_000, 86_400_000, fallbackDuration);

    let endAt = Number.isFinite(rawTimer.endAt) && rawTimer.endAt > 0 ? rawTimer.endAt : null;
    let running = rawTimer.running === true && endAt !== null;

    let remainingMs = clampNumber(rawTimer.remainingMs, 0, durationMs, durationMs);
    if (running) {
      const timeLeft = endAt - Date.now();
      remainingMs = timeLeft > 0 ? Math.min(durationMs, timeLeft) : 0;
    } else {
      endAt = null;
      if (remainingMs <= 0) remainingMs = durationMs;
    }

    let activeTaskId = typeof rawTimer.activeTaskId === 'string' ? rawTimer.activeTaskId : null;
    if (activeTaskId && !tasks.some((task) => task.id === activeTaskId && !task.completed)) {
      activeTaskId = null;
    }

    return {
      version: 1,
      tasks,
      sessions,
      settings,
      timer: {
        phase,
        durationMs,
        remainingMs,
        running,
        endAt,
        cycleDone: clampInt(rawTimer.cycleDone, 0, settings.rounds, 0),
        activeTaskId
      }
    };
  }

  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return {
        state: createDefaultState(),
        warning: '浏览器禁止了本地存储，本次数据在关闭页面后不会保留。'
      };
    }

    if (!raw) return { state: createDefaultState(), warning: '' };

    try {
      return { state: normalizeState(JSON.parse(raw)), warning: '' };
    } catch (error) {
      return {
        state: createDefaultState(),
        warning: '本地数据读取失败，已为你打开一份全新的记录。'
      };
    }
  }

  /* ------------------------------------------------------------------------
     Runtime state
     ------------------------------------------------------------------------ */

  function clockParts(value) {
    const normalized = normalizeClockTime(value);
    const [hours, minutes] = normalized.split(':').map(Number);
    return { hours, minutes };
  }

  function buildLocalDate(year, monthIndex, dayOfMonth, timeValue, clampDay = false) {
    const { hours, minutes } = clockParts(timeValue);
    let day = dayOfMonth;
    if (clampDay) {
      const lastDay = new Date(year, monthIndex + 1, 0).getDate();
      day = Math.min(day, lastDay);
    }
    return new Date(year, monthIndex, day, hours, minutes, 0, 0);
  }

  function getOnceScheduledDate(config) {
    if (!config || !isValidDateKey(config.onceDate)) return null;
    const date = parseDateKey(config.onceDate);
    const { hours, minutes } = clockParts(config.time);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  function getNextCleanupOccurrence(config, from = new Date()) {
    if (!config || config.mode === 'off') return null;
    const reference = new Date(from.getTime());

    if (config.mode === 'once') {
      const scheduled = getOnceScheduledDate(config);
      return scheduled && scheduled.getTime() > reference.getTime() ? scheduled : null;
    }

    const { hours, minutes } = clockParts(config.time);

    if (config.mode === 'daily') {
      const next = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), hours, minutes, 0, 0);
      if (next.getTime() <= reference.getTime()) next.setDate(next.getDate() + 1);
      return next;
    }

    if (config.mode === 'weekly') {
      const targetWeekday = clampInt(config.weekday, 1, 7, 1);
      const currentWeekday = ((reference.getDay() + 6) % 7) + 1;
      const daysAhead = (targetWeekday - currentWeekday + 7) % 7;
      const next = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + daysAhead, hours, minutes, 0, 0);
      if (next.getTime() <= reference.getTime()) next.setDate(next.getDate() + 7);
      return next;
    }

    if (config.mode === 'monthly') {
      const targetDay = clampInt(config.monthDay, 1, 31, 1);
      let next = buildLocalDate(reference.getFullYear(), reference.getMonth(), targetDay, config.time, true);
      if (next.getTime() <= reference.getTime()) {
        next = buildLocalDate(reference.getFullYear(), reference.getMonth() + 1, targetDay, config.time, true);
      }
      return next;
    }

    return null;
  }

  function getPreviousCleanupOccurrence(config, from = new Date()) {
    if (!config || config.mode === 'off') return null;
    const reference = new Date(from.getTime());

    if (config.mode === 'once') {
      const scheduled = getOnceScheduledDate(config);
      return scheduled && scheduled.getTime() <= reference.getTime() ? scheduled : null;
    }

    const { hours, minutes } = clockParts(config.time);

    if (config.mode === 'daily') {
      const previous = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), hours, minutes, 0, 0);
      if (previous.getTime() > reference.getTime()) previous.setDate(previous.getDate() - 1);
      return previous;
    }

    if (config.mode === 'weekly') {
      const targetWeekday = clampInt(config.weekday, 1, 7, 1);
      const currentWeekday = ((reference.getDay() + 6) % 7) + 1;
      const daysBack = (currentWeekday - targetWeekday + 7) % 7;
      const previous = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - daysBack, hours, minutes, 0, 0);
      if (previous.getTime() > reference.getTime()) previous.setDate(previous.getDate() - 7);
      return previous;
    }

    if (config.mode === 'monthly') {
      const targetDay = clampInt(config.monthDay, 1, 31, 1);
      let previous = buildLocalDate(reference.getFullYear(), reference.getMonth(), targetDay, config.time, true);
      if (previous.getTime() > reference.getTime()) {
        previous = buildLocalDate(reference.getFullYear(), reference.getMonth() - 1, targetDay, config.time, true);
      }
      return previous;
    }

    return null;
  }

  function formatCleanupTimestamp(date, reference = new Date()) {
    if (!date) return '';
    const time = formatTimeOfDay(date.getTime());
    const dateAtMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const referenceAtMidnight = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    const dayDifference = Math.round((dateAtMidnight.getTime() - referenceAtMidnight.getTime()) / DAY_MS);

    if (dayDifference === 0) return `今天 ${time}`;
    if (dayDifference === 1) return `明天 ${time}`;
    if (dayDifference === -1) return `昨天 ${time}`;
    if (date.getFullYear() === reference.getFullYear()) {
      return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_SHORT[date.getDay()]} ${time}`;
    }
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }

  function getCleanupRuleLabel(config) {
    if (!config || config.mode === 'off') return '学习记录清理未开启';
    const time = normalizeClockTime(config.time);
    if (config.mode === 'daily') return `每天 ${time}`;
    if (config.mode === 'weekly') return `每周${WEEK_LABELS[clampInt(config.weekday, 1, 7, 1) - 1]} ${time}`;
    if (config.mode === 'monthly') return `每月 ${clampInt(config.monthDay, 1, 31, 1)} 日 ${time}`;
    if (config.mode === 'once') return '仅一次';
    return '学习记录清理未开启';
  }

  function cleanupConfigsEqual(a, b) {
    if (!a || !b) return false;
    return a.mode === b.mode
      && a.time === b.time
      && a.onceDate === b.onceDate
      && a.weekday === b.weekday
      && a.monthDay === b.monthDay;
  }

  const loaded = loadState();
  let state = loaded.state;
  let currentToday = dateKey();
  let ui = createUiState();
  let tickerId = null;
  let audioContext = null;
  let deadlineWorker = null;
  let deadlineWorkerFailed = false;
  let deadlineWorkerUrl = null;
  let toastTimer = null;
  let toastCallback = null;
  let justCompletedTaskId = null;
  let lastTaskRangeKey = '';
  let storageAvailable = true;
  let storageWarningShown = false;
  let bootWarning = loaded.warning;
  let booted = false;
  let restoredExpiredPhase = false;

  let draggingCalendar = false;
  let dragAnchor = null;
  let dragHasMoved = false;
  let dragAdditive = false;
  let dragToggle = false;
  let dragBaseSelection = null;

  function createUiState() {
    const today = dateKey();
    const date = parseDateKey(today);
    return {
      viewYear: date.getFullYear(),
      viewMonth: date.getMonth(),
      selectedDates: new Set([today]),
      multiSelect: false,
      composerEstimate: 1
    };
  }

  /* ------------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);

  const dom = {
    calTodayBtn: $('calTodayBtn'),
    multiSelectBtn: $('multiSelectBtn'),
    prevMonthBtn: $('prevMonthBtn'),
    nextMonthBtn: $('nextMonthBtn'),
    monthLabel: $('monthLabel'),
    calendarGrid: $('calendarGrid'),
    calendarTip: $('calendarTip'),
    weekTotal: $('weekTotal'),
    weekChart: $('weekChart'),
    streakCount: $('streakCount'),
    todayMinutes: $('todayMinutes'),
    autoClearIndicator: $('autoClearIndicator'),
    autoClearIndicatorText: $('autoClearIndicatorText'),
    fullDate: $('fullDate'),
    greetingText: $('greetingText'),
    heroSub: $('heroSub'),
    todayPomo: $('todayPomo'),
    heroSettingsBtn: $('heroSettingsBtn'),
    sidebarSettingsBtn: $('sidebarSettingsBtn'),
    timerPanel: $('timerPanel'),
    phaseBadgeText: $('phaseBadgeText'),
    phaseMinutesBadge: $('phaseMinutesBadge'),
    soundBtn: $('soundBtn'),
    zenBtn: $('zenBtn'),
    ringProgress: $('ringProgress'),
    timeDisplay: $('timeDisplay'),
    ringEyebrow: $('ringEyebrow'),
    dialSub: $('dialSub'),
    resetBtn: $('resetBtn'),
    startBtn: $('startBtn'),
    skipBtn: $('skipBtn'),
    cycleDots: $('cycleDots'),
    roundLabel: $('roundLabel'),
    nextHint: $('nextHint'),
    taskPanel: document.querySelector('.task-panel'),
    taskCountBadge: $('taskCountBadge'),
    taskDateBig: $('taskDateBig'),
    taskWeekday: $('taskWeekday'),
    taskMonthYear: $('taskMonthYear'),
    taskTodayBtn: $('taskTodayBtn'),
    taskProgressText: $('taskProgressText'),
    taskProgressFill: $('taskProgressFill'),
    taskProgressTrack: $('taskProgressTrack'),
    taskForm: $('taskForm'),
    taskInput: $('taskInput'),
    estimateMinus: $('estimateMinus'),
    estimatePlus: $('estimatePlus'),
    estimateNumber: $('estimateNumber'),
    addTaskBtn: $('addTaskBtn'),
    addTaskLabel: $('addTaskLabel'),
    rangeNote: $('rangeNote'),
    taskList: $('taskList'),
    settingsDialog: $('settingsDialog'),
    closeSettingsBtn: $('closeSettingsBtn'),
    settingsForm: $('settingsForm'),
    settingsTitle: $('settingsTitle'),
    settingsSub: $('settingsSub'),
    settingsTabTimer: $('settingsTabTimer'),
    settingsTabData: $('settingsTabData'),
    settingsPanelTimer: $('settingsPanelTimer'),
    settingsPanelData: $('settingsPanelData'),
    settingFocus: $('settingFocus'),
    settingShort: $('settingShort'),
    settingLong: $('settingLong'),
    settingRounds: $('settingRounds'),
    testSoundBtn: $('testSoundBtn'),
    settingSound: $('settingSound'),
    settingNotifications: $('settingNotifications'),
    settingAutoStart: $('settingAutoStart'),
    settingResetRuntime: $('settingResetRuntime'),
    resetRuntimeBtn: $('resetRuntimeBtn'),
    notificationHint: $('notificationHint'),
    settingCleanupMode: $('settingCleanupMode'),
    cleanupTimeWrap: $('cleanupTimeWrap'),
    settingCleanupTime: $('settingCleanupTime'),
    cleanupOnceWrap: $('cleanupOnceWrap'),
    settingCleanupOnceDate: $('settingCleanupOnceDate'),
    cleanupWeekdayWrap: $('cleanupWeekdayWrap'),
    settingCleanupWeekday: $('settingCleanupWeekday'),
    cleanupMonthDayWrap: $('cleanupMonthDayWrap'),
    settingCleanupMonthDay: $('settingCleanupMonthDay'),
    cleanupNext: $('cleanupNext'),
    dataStatus: $('dataStatus'),
    exportBtn: $('exportBtn'),
    importBtn: $('importBtn'),
    importFile: $('importFile'),
    resetDataBtn: $('resetDataBtn'),
    cancelSettingsBtn: $('cancelSettingsBtn'),
    toast: $('toast'),
    toastIcon: $('toastIcon'),
    toastMessage: $('toastMessage'),
    toastAction: $('toastAction')
  };

  /* ------------------------------------------------------------------------
     Persistence
     ------------------------------------------------------------------------ */

  function saveState() {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      storageAvailable = false;
      if (booted && !storageWarningShown) {
        storageWarningShown = true;
        showToast('本地存储不可用，刚才的改动可能无法保留。', {
          tone: 'error',
          icon: 'alert',
          duration: 6200
        });
      } else if (!booted) {
        bootWarning = '浏览器无法写入本地数据，本次改动可能无法保存。';
      }
    }
  }

  /* ------------------------------------------------------------------------
     Toast
     ------------------------------------------------------------------------ */

  function showToast(message, options = {}) {
    const {
      tone = 'default',
      icon = 'check',
      actionLabel = '',
      onAction = null,
      duration = 3800
    } = options;

    if (!dom.toast) return;

    window.clearTimeout(toastTimer);
    toastCallback = null;
    dom.toast.dataset.tone = tone;
    dom.toastMessage.textContent = message;
    dom.toastIcon.innerHTML = iconMarkup(icon);

    if (actionLabel && typeof onAction === 'function') {
      dom.toastAction.hidden = false;
      dom.toastAction.textContent = actionLabel;
      toastCallback = onAction;
    } else {
      dom.toastAction.hidden = true;
      dom.toastAction.textContent = '';
    }

    dom.toast.classList.add('is-visible');
    if (typeof dom.toast.showPopover === 'function') {
      try {
        if (!dom.toast.matches(':popover-open')) dom.toast.showPopover();
      } catch (error) {
        /* Popover is an enhancement; the toast still works without it. */
      }
    }
    toastTimer = window.setTimeout(hideToast, duration);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    dom.toast.classList.remove('is-visible');
    if (typeof dom.toast.hidePopover === 'function') {
      try {
        if (dom.toast.matches(':popover-open')) dom.toast.hidePopover();
      } catch (error) {
        /* noop */
      }
    }
    toastCallback = null;
  }

  /* ------------------------------------------------------------------------
     Date / stats rendering
     ------------------------------------------------------------------------ */

  function renderDateHeader() {
    const now = new Date();
    dom.fullDate.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · ${WEEKDAY_FULL[now.getDay()]}`;
    dom.greetingText.textContent = getGreeting(now);

    const hour = now.getHours();
    dom.heroSub.textContent = hour < 5 || hour >= 23
      ? '夜深了，完成这一轮就去休息吧。'
      : `一次只做一件事，${state.settings.focusMin} 分钟后见。`;
  }

  function taskStatsByDate() {
    const map = new Map();
    for (const task of state.tasks) {
      let stats = map.get(task.date);
      if (!stats) {
        stats = { total: 0, done: 0 };
        map.set(task.date, stats);
      }
      stats.total += 1;
      if (task.completed) stats.done += 1;
    }
    return map;
  }

  function renderStats() {
    const today = dateKey();
    const todaySessions = state.sessions.filter((session) => session.date === today);
    const todayMinutes = Math.round(todaySessions.reduce((total, session) => total + session.minutes, 0));
    dom.todayPomo.textContent = String(todaySessions.length);
    dom.todayMinutes.textContent = `今日 ${todayMinutes} 分钟`;

    const todayDate = parseDateKey(today);
    const mondayOffset = (todayDate.getDay() + 6) % 7;
    const weekStart = shiftDateKey(today, -mondayOffset);
    const counts = WEEK_LABELS.map(() => 0);
    const minutes = WEEK_LABELS.map(() => 0);

    for (let index = 0; index < 7; index += 1) {
      const key = shiftDateKey(weekStart, index);
      for (const session of state.sessions) {
        if (session.date === key) {
          counts[index] += 1;
          minutes[index] += session.minutes;
        }
      }
    }

    const total = counts.reduce((sum, count) => sum + count, 0);
    const maxCount = Math.max(state.settings.rounds, ...counts, 1);
    const todayIndex = mondayOffset;

    dom.weekChart.innerHTML = WEEK_LABELS.map((label, index) => {
      const isToday = index === todayIndex;
      const count = counts[index];
      const height = count === 0 ? 0 : Math.max(12, Math.round((count / maxCount) * 100));
      const title = `周${label} · ${count} 个番茄 · ${Math.round(minutes[index])} 分钟`;
      return `
        <div class="week-day${isToday ? ' is-today' : ''}" title="${escapeHTML(title)}">
          <div class="week-bar-track">
            <span class="week-bar-fill" style="height:${height}%"></span>
          </div>
          <span class="week-day-label">${label}</span>
        </div>`;
    }).join('');

    dom.weekChart.setAttribute('aria-label', `本周共完成 ${total} 个番茄；今天是周${WEEK_LABELS[todayIndex]}，完成 ${counts[todayIndex]} 个。`);
    dom.weekTotal.textContent = `共 ${total} 个`;
    dom.streakCount.textContent = String(calculateStreak());
  }

  function calculateStreak() {
    const sessionDays = new Set(state.sessions.map((session) => session.date));
    const today = dateKey();
    let cursor = sessionDays.has(today) ? today : shiftDateKey(today, -1);
    if (!sessionDays.has(cursor)) return 0;

    let streak = 0;
    while (sessionDays.has(cursor) && streak < 10_000) {
      streak += 1;
      cursor = shiftDateKey(cursor, -1);
    }
    return streak;
  }

  function refreshClock() {
    const newToday = dateKey();
    if (newToday !== currentToday) {
      const wasOnlyToday = ui.selectedDates.size === 1 && ui.selectedDates.has(currentToday);
      currentToday = newToday;
      if (wasOnlyToday) {
        const date = parseDateKey(newToday);
        ui.selectedDates = new Set([newToday]);
        ui.viewYear = date.getFullYear();
        ui.viewMonth = date.getMonth();
      }
      renderAll();
    } else {
      renderDateHeader();
    }
  }

  /* ------------------------------------------------------------------------
     Calendar
     ------------------------------------------------------------------------ */

  function getSelectedDates() {
    return Array.from(ui.selectedDates).sort();
  }

  function commitSelectedDates(nextDates) {
    const unique = [...new Set(nextDates)].filter(isValidDateKey).sort();
    if (unique.length === 0) return false;

    const current = ui.selectedDates;
    const unchanged = unique.length === current.size && unique.every((key) => current.has(key));
    if (unchanged) return false;

    ui.selectedDates = new Set(unique);
    paintCalendarSelection();
    renderTasks();
    return true;
  }

  function selectSingleDate(key) {
    if (ui.selectedDates.size === 1 && ui.selectedDates.has(key)) return false;
    return commitSelectedDates([key]);
  }

  function addDateToSelection(key) {
    if (ui.selectedDates.has(key)) return false;
    const next = new Set(ui.selectedDates);
    next.add(key);
    return commitSelectedDates(next);
  }

  function toggleDateInSelection(key) {
    if (ui.selectedDates.has(key) && ui.selectedDates.size === 1) {
      showToast('至少要保留一天。');
      return false;
    }

    const next = new Set(ui.selectedDates);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return commitSelectedDates(next);
  }

  function toggleMultiSelectMode() {
    ui.multiSelect = !ui.multiSelect;
    updateMultiSelectButton();
    dom.calendarGrid.classList.toggle('is-multiselect', ui.multiSelect);
    updateCalendarTip();
    if (ui.multiSelect) {
      showToast('多选已开启：点击日期加减，拖动可加选一段。', { icon: 'check' });
    }
  }

  function updateMultiSelectButton() {
    dom.multiSelectBtn.setAttribute('aria-pressed', String(ui.multiSelect));
    dom.multiSelectBtn.title = ui.multiSelect
      ? '关闭多选模式'
      : '开启多选模式：点击或拖动日期可加选、取消';
  }

  function selectRange(start, end, { additive = false, base = null } = {}) {
    const next = additive ? new Set(base || ui.selectedDates) : new Set();
    eachDateInRange(start, end, (key) => next.add(key));
    return commitSelectedDates(next);
  }

  function renderCalendar() {
    const firstOfMonth = new Date(ui.viewYear, ui.viewMonth, 1, 12);
    const offset = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(ui.viewYear, ui.viewMonth, 1 - offset, 12);
    const today = dateKey();
    const selectedDates = ui.selectedDates;
    const selectedCount = selectedDates.size;
    const isSingleSelection = selectedCount === 1;
    const stats = taskStatsByDate();

    let html = '';
    let hasTabStop = false;

    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const key = dateKey(date);
      const outside = date.getMonth() !== ui.viewMonth;
      const info = stats.get(key) || { total: 0, done: 0 };
      const isSelected = !outside && selectedDates.has(key);
      const isEndpoint = isSelected && (
        isSingleSelection
        || !selectedDates.has(shiftDateKey(key, -1))
        || !selectedDates.has(shiftDateKey(key, 1))
      );
      const classes = ['cal-day'];

      if (outside) classes.push('is-outside');
      if (!outside && key === today) classes.push('is-today');
      if (info.total > 0) classes.push('has-tasks');
      if (info.total > 0 && info.done === info.total) classes.push('all-done');
      if (isSelected && !isSingleSelection && !isEndpoint) classes.push('in-range');
      if (isEndpoint) classes.push('is-selected');

      let tabIndex = -1;
      if (isSelected && !hasTabStop) {
        tabIndex = 0;
        hasTabStop = true;
      }

      const labelParts = [
        `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
        WEEKDAY_FULL[date.getDay()]
      ];
      if (key === today && !outside) labelParts.push('今天');
      if (info.total > 0) labelParts.push(`${info.total} 项任务，已完成 ${info.done} 项`);
      const ariaLabel = escapeHTML(labelParts.join('，'));

      html += `<button class="${classes.join(' ')}" type="button" data-date="${key}" tabindex="${tabIndex}" aria-pressed="${isSelected}" aria-label="${ariaLabel}"${outside ? ' disabled aria-hidden="true"' : ''}><span class="day-num">${date.getDate()}</span><span class="day-mark"></span></button>`;
    }

    dom.monthLabel.textContent = `${ui.viewYear}年${ui.viewMonth + 1}月`;
    dom.calendarGrid.innerHTML = html;
    dom.calendarGrid.classList.remove('is-selecting', 'is-additive');
    dom.calendarGrid.classList.toggle('is-multiselect', ui.multiSelect);

    if (!dom.calendarGrid.querySelector('button.cal-day[tabindex="0"]')) {
      const firstAvailable = dom.calendarGrid.querySelector('button.cal-day:not([disabled])');
      if (firstAvailable) firstAvailable.tabIndex = 0;
    }

    updateMultiSelectButton();
    updateCalendarTip();
  }

  function updateCalendarTip() {
    const dates = getSelectedDates();
    const days = dates.length;
    const contiguous = isContiguousDateKeys(dates);
    dom.calendarTip.title = '按住 Ctrl 或 Shift 拖动可加选断开的日期；也可以开启「多选」。';

    if (ui.multiSelect) {
      dom.calendarTip.textContent = '多选模式 · 点击或拖动日期加减';
      dom.calendarTip.classList.add('is-active');
      return;
    }

    if (days > 1) {
      dom.calendarTip.textContent = contiguous
        ? `已选 ${days} 天 · 可一起安排任务`
        : `已选 ${days} 天（含断开日期）· 可一起安排`;
      dom.calendarTip.classList.add('is-active');
    } else {
      dom.calendarTip.textContent = '拖动框选 · 按住 Ctrl 可加选断开日期';
      dom.calendarTip.classList.remove('is-active');
    }
  }

  function paintCalendarSelection() {
    const selectedDates = ui.selectedDates;
    const selectedCount = selectedDates.size;
    const isSingleSelection = selectedCount === 1;
    const buttons = dom.calendarGrid.querySelectorAll('button.cal-day');
    let hasTabStop = false;

    buttons.forEach((button) => {
      if (button.disabled) return;
      const key = button.dataset.date;
      const isSelected = selectedDates.has(key);
      const isEndpoint = isSelected && (
        isSingleSelection
        || !selectedDates.has(shiftDateKey(key, -1))
        || !selectedDates.has(shiftDateKey(key, 1))
      );

      button.classList.toggle('in-range', isSelected && !isSingleSelection && !isEndpoint);
      button.classList.toggle('is-selected', isEndpoint);
      button.classList.remove('range-start', 'range-end');
      button.setAttribute('aria-pressed', String(isSelected));

      if (isSelected && !hasTabStop) {
        button.tabIndex = 0;
        hasTabStop = true;
      } else {
        button.tabIndex = -1;
      }
    });

    if (!hasTabStop) {
      const firstAvailable = dom.calendarGrid.querySelector('button.cal-day:not([disabled])');
      if (firstAvailable) firstAvailable.tabIndex = 0;
    }

    updateCalendarTip();
  }

  function shiftViewMonth(direction) {
    const next = new Date(ui.viewYear, ui.viewMonth + direction, 1, 12);
    ui.viewYear = next.getFullYear();
    ui.viewMonth = next.getMonth();
    renderCalendar();
  }

  function goToToday() {
    const today = dateKey();
    const date = parseDateKey(today);
    currentToday = today;
    ui.selectedDates = new Set([today]);
    ui.multiSelect = false;
    ui.viewYear = date.getFullYear();
    ui.viewMonth = date.getMonth();
    renderCalendar();
    renderTasks();
  }

  /* ------------------------------------------------------------------------
     Task rendering & actions
     ------------------------------------------------------------------------ */

  function getTasksInSelection() {
    return state.tasks
      .filter((task) => ui.selectedDates.has(task.date))
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return a.createdAt - b.createdAt;
      });
  }

  function getActiveTask() {
    if (!state.timer.activeTaskId) return null;
    return state.tasks.find((task) => task.id === state.timer.activeTaskId && !task.completed) || null;
  }

  function emptyStateHTML(isSingle, isToday) {
    let title = '这几天，还留着一页空白';
    if (isSingle) title = isToday ? '今天，还留着一页空白' : '这一天，还留着一页空白';
    const note = isSingle
      ? '写下第一件小事，让专注有一个落点。'
      : '给这几天各安排一件小事，或写下一件共同要做的事。';
    return `
      <div class="task-empty">
        ${EMPTY_ART}
        <h3>${title}</h3>
        <p>${note}</p>
      </div>`;
  }

  function taskHTML(task) {
    const active = state.timer.activeTaskId === task.id && !task.completed;
    const runningFocus = active && state.timer.running && state.timer.phase === 'focus';
    const classes = ['task-item'];
    if (task.completed) classes.push('is-completed');
    if (active) classes.push('is-active');
    if (task.id === justCompletedTaskId && task.completed) classes.push('is-just-completed');

    const escapedTitle = escapeHTML(task.title);
    let meta = '';
    if (task.completed) {
      const completedTime = task.completedAt ? formatTimeOfDay(task.completedAt) : '';
      meta = `<span>已完成${completedTime ? ` · ${completedTime}` : ''}</span>`;
    } else {
      const pomoText = task.pomosDone > 0
        ? `${task.pomosDone} / ${task.estimate} 个番茄`
        : `预计 ${task.estimate} 个番茄`;
      meta = `<span class="meta-pomo">${iconMarkup('tomato')}${pomoText}</span>`;
    }

    const nowTag = active ? `<span class="now-tag">${runningFocus ? '专注中' : '当前'}</span>` : '';
    const focusAction = task.completed ? '' : `
      <button class="task-action focus-task" type="button" data-action="focus" aria-label="开始专注：${escapedTitle}" title="${active ? '切换到这个任务' : '用番茄钟专注这件事'}">
        ${iconMarkup('play')}
      </button>`;

    return `
      <div class="${classes.join(' ')}" data-id="${task.id}">
        <button class="task-check" type="button" data-action="toggle" aria-label="${task.completed ? '取消完成' : '标记完成'}：${escapedTitle}" aria-pressed="${task.completed}">
          ${iconMarkup('check')}
        </button>
        <div class="task-body">
          <div class="task-title">${escapedTitle}${nowTag}</div>
          <div class="task-meta">${meta}</div>
        </div>
        <div class="task-actions">
          ${focusAction}
          <button class="task-action delete" type="button" data-action="delete" aria-label="删除任务：${escapedTitle}" title="删除任务">
            ${iconMarkup('trash')}
          </button>
        </div>
      </div>`;
  }

  function updateAddButtonState() {
    const hasText = dom.taskInput.value.trim().length > 0;
    dom.addTaskBtn.disabled = !hasText;
  }

  function setComposerEstimate(value) {
    ui.composerEstimate = clampInt(value, 1, MAX_ESTIMATE, 1);
    dom.estimateNumber.textContent = String(ui.composerEstimate);
    dom.estimateMinus.disabled = ui.composerEstimate <= 1;
    dom.estimatePlus.disabled = ui.composerEstimate >= MAX_ESTIMATE;
  }

  function renderTasks() {
    const dates = getSelectedDates();
    const dayCount = dates.length;
    const isSingle = dayCount === 1;
    const contiguous = isContiguousDateKeys(dates);
    const firstDate = parseDateKey(dates[0]);
    const lastDate = parseDateKey(dates[dayCount - 1]);
    const sameMonth = firstDate.getFullYear() === lastDate.getFullYear()
      && firstDate.getMonth() === lastDate.getMonth();
    const tasks = getTasksInSelection();
    const total = tasks.length;
    const done = tasks.filter((task) => task.completed).length;
    const allDone = total > 0 && done === total;
    const rangeKey = dates.join('|');
    const shouldResetScroll = rangeKey !== lastTaskRangeKey;
    const previousScroll = dom.taskList.scrollTop;

    dom.taskPanel.classList.toggle('all-done', allDone);
    dom.taskDateBig.classList.toggle('is-range', !isSingle);
    dom.taskDateBig.classList.toggle('is-count', !isSingle && (!contiguous || !sameMonth));

    if (isSingle) {
      dom.taskDateBig.textContent = pad2(firstDate.getDate());
      dom.taskWeekday.textContent = WEEKDAY_FULL[firstDate.getDay()];
      dom.taskMonthYear.textContent = `${firstDate.getFullYear()}年${firstDate.getMonth() + 1}月`;
    } else if (contiguous && sameMonth) {
      dom.taskDateBig.textContent = `${pad2(firstDate.getDate())}–${pad2(lastDate.getDate())}`;
      dom.taskWeekday.textContent = `${WEEKDAY_SHORT[firstDate.getDay()]} — ${WEEKDAY_SHORT[lastDate.getDay()]}`;
      dom.taskMonthYear.textContent = `${firstDate.getFullYear()}年${firstDate.getMonth() + 1}月 · ${dayCount} 天`;
    } else {
      dom.taskDateBig.innerHTML = `${dayCount}<span class="task-date-unit">天</span>`;
      if (sameMonth) {
        dom.taskWeekday.textContent = '不连续选择';
        dom.taskMonthYear.textContent = `${firstDate.getFullYear()}年${firstDate.getMonth() + 1}月`;
      } else {
        dom.taskWeekday.textContent = contiguous ? '跨月连续' : '跨月不连续';
        dom.taskMonthYear.textContent = `${firstDate.getFullYear()}年${firstDate.getMonth() + 1}月 — ${lastDate.getFullYear()}年${lastDate.getMonth() + 1}月`;
      }
    }

    dom.taskTodayBtn.hidden = isSingle && dates[0] === currentToday;
    dom.taskCountBadge.textContent = `${total} 项`;
    dom.taskProgressText.textContent = `${done} / ${total}`;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    dom.taskProgressFill.style.width = `${percent}%`;
    dom.taskProgressTrack.setAttribute('aria-valuenow', String(percent));
    dom.taskProgressTrack.setAttribute('aria-label', `${done} / ${total} 项任务已完成`);

    if (isSingle) {
      dom.rangeNote.hidden = true;
      dom.addTaskLabel.textContent = '添加任务';
      dom.taskInput.placeholder = '写下一件要做的事…';
    } else {
      dom.rangeNote.hidden = false;
      dom.rangeNote.textContent = contiguous
        ? `这条任务会添加到选中的 ${dayCount} 天`
        : `只加到选中的 ${dayCount} 天，不会包含未选中的日期`;
      dom.addTaskLabel.textContent = `添加至 ${dayCount} 天`;
      dom.taskInput.placeholder = `为这 ${dayCount} 天添加同一件事…`;
    }

    let content = '';
    if (total === 0) {
      content = emptyStateHTML(isSingle, isSingle && dates[0] === currentToday);
    } else if (isSingle) {
      content = tasks.map(taskHTML).join('');
    } else {
      dates.forEach((key) => {
        const dayTasks = tasks.filter((task) => task.date === key);
        if (dayTasks.length === 0) return;
        const date = parseDateKey(key);
        content += `
          <div class="task-group">
            <div class="task-group-label">${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAY_SHORT[date.getDay()]}</div>
            ${dayTasks.map(taskHTML).join('')}
          </div>`;
      });
    }

    dom.taskList.innerHTML = content;
    justCompletedTaskId = null;

    if (shouldResetScroll) {
      dom.taskList.scrollTop = 0;
      lastTaskRangeKey = rangeKey;
    } else {
      dom.taskList.scrollTop = previousScroll;
    }

    setComposerEstimate(ui.composerEstimate);
    updateAddButtonState();
  }

  function addTask(event) {
    event.preventDefault();
    const title = dom.taskInput.value.trim();
    if (!title) return;

    const dates = getSelectedDates();
    const baseTime = Date.now();
    const estimate = ui.composerEstimate;

    dates.forEach((date, index) => {
      state.tasks.push({
        id: makeId(),
        date,
        title: title.slice(0, 120),
        estimate,
        pomosDone: 0,
        completed: false,
        createdAt: baseTime + index,
        completedAt: null
      });
    });

    saveState();
    dom.taskInput.value = '';
    setComposerEstimate(1);
    renderTasks();
    renderCalendar();
    updateAddButtonState();
    dom.taskInput.focus({ preventScroll: true });

    showToast(dates.length > 1 ? `已添加到 ${dates.length} 天。` : '任务已添加。', {
      icon: 'check'
    });
  }

  function toggleTask(id) {
    const task = state.tasks.find((entry) => entry.id === id);
    if (!task) return;

    const completing = !task.completed;
    task.completed = completing;
    task.completedAt = completing ? Date.now() : null;

    if (completing) {
      justCompletedTaskId = task.id;
      if (state.timer.activeTaskId === task.id) {
        state.timer.activeTaskId = null;
      }
    }

    saveState();
    renderTasks();
    renderCalendar();
    renderTimer();

    const remainingTasks = getTasksInSelection();
    const allDone = remainingTasks.length > 0 && remainingTasks.every((entry) => entry.completed);

    if (completing && allDone) {
      const selectedDates = getSelectedDates();
      const message = selectedDates.length === 1
        ? (selectedDates[0] === currentToday ? '今天的任务全部完成，做得很好。' : '这一天的任务全部完成。')
        : '选中的任务全部完成，辛苦啦。';
      window.setTimeout(() => {
        showToast(message, { tone: 'celebrate', icon: 'sparkle', duration: 4800 });
      }, 80);
    }

    const nextFocus = dom.taskList.querySelector(`.task-item[data-id="${id}"] .task-check`);
    if (nextFocus) nextFocus.focus({ preventScroll: true });
  }

  function deleteTask(id) {
    const index = state.tasks.findIndex((task) => task.id === id);
    if (index === -1) return;
    const [removed] = state.tasks.splice(index, 1);

    if (state.timer.activeTaskId === id) {
      state.timer.activeTaskId = null;
    }

    saveState();
    renderTasks();
    renderCalendar();
    renderTimer();

    const shortTitle = removed.title.length > 22 ? `${removed.title.slice(0, 22)}…` : removed.title;
    showToast(`已删除「${shortTitle}」`, {
      icon: 'trash',
      actionLabel: '撤销',
      duration: 5200,
      onAction: () => {
        state.tasks.splice(index, 0, removed);
        saveState();
        renderTasks();
        renderCalendar();
        showToast('任务已恢复。');
      }
    });
  }

  function setActiveTask(id) {
    const task = state.tasks.find((entry) => entry.id === id && !entry.completed);
    if (!task) return;

    state.timer.activeTaskId = id;
    saveState();

    if (!state.timer.running && state.timer.phase === 'focus') {
      startTimer();
      renderTasks();
      showToast(`开始专注「${task.title.length > 26 ? `${task.title.slice(0, 26)}…` : task.title}」`);
      return;
    }

    renderTasks();
    renderTimer();

    if (state.timer.running && state.timer.phase === 'focus') {
      showToast('已切换本轮的专注任务。');
    } else if (state.timer.phase !== 'focus') {
      showToast('已设为下一轮专注任务，先好好休息。');
    } else {
      showToast('已设为当前专注任务。');
    }
  }

  /* ------------------------------------------------------------------------
     Timer
     ------------------------------------------------------------------------ */

  function phaseName(phase) {
    if (phase === 'short') return '短休息';
    if (phase === 'long') return '长休息';
    return '专注时间';
  }

  function phaseEnglish(phase) {
    if (phase === 'short') return 'SHORT BREAK';
    if (phase === 'long') return 'LONG BREAK';
    return 'FOCUS SESSION';
  }

  function startTicker() {
    stopTicker();
    tickerId = window.setInterval(tickTimer, 200);
  }

  function stopTicker() {
    if (tickerId !== null) {
      window.clearInterval(tickerId);
      tickerId = null;
    }
    cancelDeadlineWorker();
  }

  function ensureDeadlineWorker() {
    if (deadlineWorker || deadlineWorkerFailed) return deadlineWorker;
    if (typeof window.Worker !== 'function' || typeof window.Blob !== 'function') return null;

    try {
      const source = `
        let deadline = null;
        self.onmessage = (event) => {
          const data = event.data || {};
          if (data.type === 'schedule') {
            if (deadline !== null) clearTimeout(deadline);
            const delay = Math.max(0, Number(data.delay) || 0);
            deadline = setTimeout(() => {
              deadline = null;
              self.postMessage({ type: 'deadline' });
            }, delay);
          } else if (data.type === 'cancel') {
            if (deadline !== null) clearTimeout(deadline);
            deadline = null;
          }
        };`;
      const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      deadlineWorkerUrl = blobUrl;
      const worker = new Worker(blobUrl);
      deadlineWorker = worker;
      worker.onmessage = (event) => {
        if (!event.data || event.data.type !== 'deadline') return;
        if (!state.timer.running) return;
        tickTimer();
        if (state.timer.running) scheduleDeadlineWorker();
      };
      worker.onerror = () => {
        deadlineWorkerFailed = true;
        try { worker.terminate(); } catch (error) { /* noop */ }
        deadlineWorker = null;
      };
      window.setTimeout(() => {
        if (deadlineWorkerUrl) {
          URL.revokeObjectURL(deadlineWorkerUrl);
          deadlineWorkerUrl = null;
        }
      }, 4000);
      return worker;
    } catch (error) {
      deadlineWorkerFailed = true;
      return null;
    }
  }

  function scheduleDeadlineWorker() {
    const worker = ensureDeadlineWorker();
    if (!worker || !state.timer.running || !state.timer.endAt) return;
    try {
      worker.postMessage({ type: 'schedule', delay: Math.max(0, state.timer.endAt - Date.now()) });
    } catch (error) {
      deadlineWorkerFailed = true;
      try { worker.terminate(); } catch (terminateError) { /* noop */ }
      deadlineWorker = null;
    }
  }

  function cancelDeadlineWorker() {
    if (!deadlineWorker) return;
    try {
      deadlineWorker.postMessage({ type: 'cancel' });
    } catch (error) {
      /* noop */
    }
  }

  function tickTimer() {
    const timer = state.timer;
    if (!timer.running || !timer.endAt) return;

    const timeLeft = timer.endAt - Date.now();
    if (timeLeft <= 0) {
      timer.remainingMs = 0;
      completePhase();
      return;
    }

    timer.remainingMs = timeLeft;
    paintTimerProgress();
    updateDocumentTitle();
  }

  function paintTimerProgress() {
    const timer = state.timer;
    const remaining = Math.max(0, Math.min(timer.durationMs, timer.remainingMs));
    const ratio = timer.durationMs > 0 ? remaining / timer.durationMs : 0;
    dom.timeDisplay.textContent = formatClock(remaining);
    dom.ringProgress.style.strokeDashoffset = String(100 - (ratio * 100));
  }

  function updateDocumentTitle() {
    const timer = state.timer;
    if (timer.running) {
      const mode = timer.phase === 'focus' ? '专注中' : '休息中';
      document.title = `${formatClock(timer.remainingMs)} · ${mode} — ${APP_NAME}`;
    } else if (timer.remainingMs > 0 && timer.remainingMs < timer.durationMs - 100) {
      document.title = `${formatClock(timer.remainingMs)} · 已暂停 — ${APP_NAME}`;
    } else {
      document.title = `${APP_NAME} · 番茄专注`;
    }
  }

  function renderTimer() {
    const timer = state.timer;
    const phase = timer.phase;
    const running = timer.running;
    const paused = !running && timer.remainingMs > 0 && timer.remainingMs < timer.durationMs - 100;
    const activeTask = getActiveTask();

    dom.timerPanel.dataset.phase = phase;
    dom.timerPanel.classList.toggle('is-running', running);

    if (running) {
      dom.phaseBadgeText.textContent = phase === 'focus' ? '专注中' : '休息中';
    } else if (paused) {
      dom.phaseBadgeText.textContent = `${phaseName(phase)} · 已暂停`;
    } else {
      dom.phaseBadgeText.textContent = phaseName(phase);
    }

    dom.phaseMinutesBadge.textContent = minutesLabel(Math.round(timer.durationMs / 60_000));
    dom.ringEyebrow.textContent = phaseEnglish(phase);

    if (phase === 'focus') {
      dom.dialSub.textContent = activeTask ? activeTask.title : '只做眼前这一件事';
      dom.dialSub.classList.toggle('has-task', Boolean(activeTask));
    } else if (phase === 'short') {
      dom.dialSub.textContent = '起身走走，看看远处';
      dom.dialSub.classList.remove('has-task');
    } else {
      dom.dialSub.textContent = '四轮结束，好好犒劳自己';
      dom.dialSub.classList.remove('has-task');
    }

    let startLabel = '开始专注';
    if (running) {
      startLabel = '暂停一下';
    } else if (paused) {
      startLabel = phase === 'focus' ? '继续专注' : '继续休息';
    } else if (phase === 'short') {
      startLabel = '开始休息';
    } else if (phase === 'long') {
      startLabel = '开始长休息';
    }

    dom.startBtn.innerHTML = `${iconMarkup(running ? 'pause' : 'play')}<span>${startLabel}</span>`;
    dom.startBtn.setAttribute('aria-label', startLabel);

    const dots = [];
    for (let index = 0; index < state.settings.rounds; index += 1) {
      const done = index < timer.cycleDone;
      const current = !done && index === timer.cycleDone && phase === 'focus';
      dots.push(`<span class="cycle-dot${done ? ' is-done' : ''}${current ? ' is-current' : ''}"></span>`);
    }
    dom.cycleDots.innerHTML = dots.join('');
    dom.cycleDots.setAttribute('aria-label', `已完成 ${timer.cycleDone} / ${state.settings.rounds} 轮`);

    if (phase === 'focus') {
      dom.roundLabel.textContent = `第 ${Math.min(timer.cycleDone + 1, state.settings.rounds)} / ${state.settings.rounds} 轮`;
      const willLong = timer.cycleDone + 1 >= state.settings.rounds;
      dom.nextHint.textContent = willLong
        ? `完成这轮后 · 长休息 ${state.settings.longMin} 分钟`
        : `完成这轮后 · 短休息 ${state.settings.shortMin} 分钟`;
    } else if (phase === 'short') {
      dom.roundLabel.textContent = `${timer.cycleDone} / ${state.settings.rounds} 轮完成`;
      dom.nextHint.textContent = '休息结束后 · 开始下一轮专注';
    } else {
      dom.roundLabel.textContent = `${state.settings.rounds} / ${state.settings.rounds} 轮完成`;
      dom.nextHint.textContent = '这是长休息 · 让大脑真正放空';
    }

    paintTimerProgress();
    updateDocumentTitle();
  }

  function startTimer({ auto = false } = {}) {
    const timer = state.timer;
    if (timer.running) return;

    if (!auto) ensureAudioContext();

    if (timer.remainingMs <= 0) {
      timer.durationMs = durationForPhase(timer.phase, state.settings);
      timer.remainingMs = timer.durationMs;
    }

    timer.endAt = Date.now() + timer.remainingMs;
    timer.running = true;
    startTicker();
    scheduleDeadlineWorker();
    saveState();
    renderTimer();
  }

  function pauseTimer() {
    const timer = state.timer;
    if (!timer.running) return;

    const timeLeft = timer.endAt - Date.now();
    timer.remainingMs = Math.max(0, timeLeft);
    timer.running = false;
    timer.endAt = null;
    stopTicker();

    if (timer.remainingMs <= 0) {
      completePhase();
      return;
    }

    saveState();
    renderTimer();
  }

  function resetTimer() {
    stopTicker();
    const timer = state.timer;
    timer.running = false;
    timer.endAt = null;
    timer.durationMs = durationForPhase(timer.phase, state.settings);
    timer.remainingMs = timer.durationMs;
    saveState();
    renderTimer();
  }

  function hasRuntimeState() {
    const timer = state.timer;
    return timer.running
      || timer.endAt !== null
      || timer.activeTaskId !== null
      || timer.cycleDone > 0
      || timer.phase !== 'focus'
      || timer.remainingMs < timer.durationMs - 1000;
  }

  function resetRuntimeState({ persist = true, render = true } = {}) {
    stopTicker();
    const timer = state.timer;
    timer.phase = 'focus';
    timer.durationMs = durationForPhase('focus', state.settings);
    timer.remainingMs = timer.durationMs;
    timer.running = false;
    timer.endAt = null;
    timer.cycleDone = 0;
    timer.activeTaskId = null;
    justCompletedTaskId = null;
    lastTaskRangeKey = '';

    currentToday = dateKey();
    const today = parseDateKey(currentToday);
    ui.viewYear = today.getFullYear();
    ui.viewMonth = today.getMonth();
    ui.selectedDates = new Set([currentToday]);
    ui.multiSelect = false;

    if (persist) saveState();
    if (render) renderAll();
  }

  function manuallyResetRuntime() {
    const confirmed = window.confirm('只会重置计时器、轮次、当前任务和日期选择，不会删除任何任务或专注记录。\n确定重置运行状态吗？');
    if (!confirmed) return;

    closeSettings();
    resetRuntimeState();
    showToast('运行状态已重置，学习记录保持不变。', { icon: 'reset', duration: 4200 });
  }

  function skipPhase() {
    const timer = state.timer;
    const finished = timer.phase;
    stopTicker();
    timer.running = false;
    timer.endAt = null;

    let nextPhase;
    let message;
    if (finished === 'focus') {
      nextPhase = 'short';
      message = '已跳过这一轮，先休息一下吧。';
    } else if (finished === 'short') {
      nextPhase = 'focus';
      message = '已跳过短休息，准备好后开始下一轮。';
    } else {
      timer.cycleDone = 0;
      nextPhase = 'focus';
      message = '已跳过这次长休息，重新出发。';
    }

    enterPhase(nextPhase);
    saveState();
    renderTasks();
    renderStats();
    renderTimer();
    showToast(message, { icon: 'skip' });
  }

  function enterPhase(nextPhase) {
    const timer = state.timer;
    timer.phase = nextPhase;
    timer.durationMs = durationForPhase(nextPhase, state.settings);
    timer.remainingMs = timer.durationMs;
    timer.running = false;
    timer.endAt = null;
  }

  function recordFocusSession(minutes) {
    state.sessions.push({
      id: makeId(),
      date: dateKey(),
      minutes,
      completedAt: Date.now()
    });
  }

  function creditActiveTask() {
    const task = state.tasks.find((entry) => entry.id === state.timer.activeTaskId);
    if (!task) {
      state.timer.activeTaskId = null;
      return;
    }
    task.pomosDone = (task.pomosDone || 0) + 1;
    if (task.completed) state.timer.activeTaskId = null;
  }

  function completePhase({ restored = false } = {}) {
    stopTicker();
    const timer = state.timer;
    const finished = timer.phase;
    const minutes = Math.max(1, Math.round(timer.durationMs / 60_000));
    timer.running = false;
    timer.endAt = null;
    timer.remainingMs = 0;

    let nextPhase;
    let toastMessage;
    let notificationTitle;
    let notificationBody;

    if (finished === 'focus') {
      timer.cycleDone = Math.min(state.settings.rounds, timer.cycleDone + 1);
      recordFocusSession(minutes);
      creditActiveTask();

      if (timer.cycleDone >= state.settings.rounds) {
        nextPhase = 'long';
        toastMessage = `四轮专注完成，去休息 ${state.settings.longMin} 分钟吧。`;
        notificationTitle = '四轮完成 · 去长休息吧';
        notificationBody = `一组番茄钟完成了。离开屏幕，给自己 ${state.settings.longMin} 分钟。`;
      } else {
        nextPhase = 'short';
        toastMessage = `这一轮完成，休息 ${state.settings.shortMin} 分钟吧。`;
        notificationTitle = '这一轮完成 · 休息一下';
        notificationBody = `起身走走，喝口水。${state.settings.shortMin} 分钟后回来。`;
      }
    } else if (finished === 'short') {
      nextPhase = 'focus';
      toastMessage = '短休息结束，准备好开始下一轮了吗？';
      notificationTitle = '休息结束 · 回来专注吧';
      notificationBody = '准备好后，开始下一轮专注。';
    } else {
      timer.cycleDone = 0;
      nextPhase = 'focus';
      toastMessage = '长休息结束，带着好状态重新出发。';
      notificationTitle = '长休息结束 · 重新出发';
      notificationBody = '新的一组番茄钟在等你。';
    }

    enterPhase(nextPhase);
    saveState();
    renderTasks();
    renderCalendar();
    renderStats();
    renderTimer();

    if (restored) {
      restoredExpiredPhase = true;
      return;
    }

    playChime(finished === 'focus' ? 'rest' : 'focus');
    notifyCompletion(notificationTitle, notificationBody);
    showToast(toastMessage, {
      tone: 'celebrate',
      icon: finished === 'focus' ? 'sparkle' : 'play',
      duration: 5200
    });

    if (state.settings.autoStart) {
      startTimer({ auto: true });
    }
  }

  function restoreTimerState() {
    const timer = state.timer;
    if (timer.running && timer.endAt) {
      if (timer.endAt <= Date.now()) {
        timer.remainingMs = 0;
        completePhase({ restored: true });
      } else {
        timer.remainingMs = timer.endAt - Date.now();
        startTicker();
        scheduleDeadlineWorker();
      }
      return;
    }

    timer.running = false;
    timer.endAt = null;
    if (!Number.isFinite(timer.remainingMs) || timer.remainingMs <= 0) {
      timer.remainingMs = timer.durationMs;
    }
  }

  function toggleTimer() {
    if (state.timer.running) {
      pauseTimer();
    } else {
      startTimer();
    }
  }

  /* ------------------------------------------------------------------------
     Sound & notifications
     ------------------------------------------------------------------------ */

  function ensureAudioContext() {
    try {
      if (!audioContext) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return null;
        audioContext = new AudioCtor();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      return audioContext;
    } catch (error) {
      return null;
    }
  }

  function playChime(kind = 'focus', force = false) {
    if (!force && !state.settings.sound) return;
    const context = ensureAudioContext();
    if (!context) return;

    const notes = kind === 'rest'
      ? [783.99, 659.25, 523.25]
      : kind === 'focus'
        ? [523.25, 659.25, 783.99]
        : [659.25, 783.99];

    const play = () => {
      try {
        const master = context.createGain();
        master.gain.value = 0.16;
        master.connect(context.destination);

        notes.forEach((frequency, index) => {
          const startAt = context.currentTime + index * 0.18;
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.linearRampToValueAtTime(0.55, startAt + 0.035);
          gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.1);
          oscillator.connect(gain);
          gain.connect(master);
          oscillator.start(startAt);
          oscillator.stop(startAt + 1.2);
        });

        window.setTimeout(() => {
          try { master.disconnect(); } catch (error) { /* noop */ }
        }, 2200);
      } catch (error) {
        /* audio is a progressive enhancement */
      }
    };

    if (context.state === 'suspended') {
      context.resume().then(play).catch(() => {});
    } else {
      play();
    }
  }

  function updateSoundButton() {
    const soundOn = state.settings.sound;
    dom.soundBtn.innerHTML = iconMarkup(soundOn ? 'volume' : 'volume-off');
    dom.soundBtn.setAttribute('aria-pressed', String(soundOn));
    dom.soundBtn.setAttribute('aria-label', soundOn ? '关闭提示音' : '开启提示音');
    dom.soundBtn.title = soundOn ? '关闭提示音' : '开启提示音';
  }

  function toggleSound() {
    state.settings.sound = !state.settings.sound;
    saveState();
    updateSoundButton();
    if (state.settings.sound) {
      ensureAudioContext();
      playChime('focus', true);
      showToast('提示音已开启。');
    } else {
      showToast('提示音已关闭。');
    }
  }

  function notifyCompletion(title, body) {
    if (!state.settings.notifications) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
      const notification = new Notification(`${APP_NAME} · ${title}`, {
        body,
        icon: 'favicon.svg',
        tag: 'yiyu-timer',
        silent: true
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      window.setTimeout(() => {
        try { notification.close(); } catch (error) { /* noop */ }
      }, 9000);
    } catch (error) {
      /* system notifications are optional */
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch (error) {
      return false;
    }
  }

  /* ------------------------------------------------------------------------
     Settings & backup
     ------------------------------------------------------------------------ */

  function updateNotificationHint() {
    if (!('Notification' in window)) {
      dom.notificationHint.textContent = '当前浏览器不支持桌面通知';
      dom.settingNotifications.disabled = true;
      dom.settingNotifications.checked = false;
      return;
    }

    dom.settingNotifications.disabled = false;
    if (Notification.permission === 'denied') {
      dom.notificationHint.textContent = '通知权限已被浏览器关闭，请在站点设置中重新允许';
    } else if (Notification.permission === 'granted') {
      dom.notificationHint.textContent = '通知已开启，切到别的窗口也能收到提醒';
    } else {
      dom.notificationHint.textContent = '开启后，切到别的窗口也能收到提醒';
    }
  }

  function readCleanupConfigFromForm() {
    const mode = CLEANUP_MODES.includes(dom.settingCleanupMode.value)
      ? dom.settingCleanupMode.value
      : 'off';
    return {
      mode,
      time: normalizeClockTime(dom.settingCleanupTime.value, ''),
      onceDate: dom.settingCleanupOnceDate.value || '',
      weekday: clampInt(dom.settingCleanupWeekday.value, 1, 7, 1),
      monthDay: clampInt(dom.settingCleanupMonthDay.value, 1, 31, 1),
      lastRunAt: 0
    };
  }

  function validateCleanupDraft(config, now = new Date()) {
    if (config.mode === 'off') {
      return { ok: true, config: { ...config, time: config.time || '23:00' } };
    }

    if (!config.time) {
      return { ok: false, message: '请选择自动清理的时间。', field: 'time' };
    }

    if (config.mode === 'once') {
      if (!isValidDateKey(config.onceDate)) {
        return { ok: false, message: '请选择自动清理的日期。', field: 'onceDate' };
      }
      const scheduled = getOnceScheduledDate(config);
      if (!scheduled || scheduled.getTime() <= now.getTime()) {
        return { ok: false, message: '一次清理的时间需要晚于现在。', field: 'onceDate' };
      }
    }

    if (config.mode === 'monthly') {
      const rawDay = Number.parseInt(dom.settingCleanupMonthDay.value, 10);
      if (!Number.isInteger(rawDay) || rawDay < 1 || rawDay > 31) {
        return { ok: false, message: '请填写 1 到 31 之间的日期。', field: 'monthDay' };
      }
      config.monthDay = rawDay;
    }

    return { ok: true, config };
  }

  function syncCleanupFieldVisibility() {
    const mode = dom.settingCleanupMode.value;
    dom.settingCleanupTime.disabled = mode === 'off';
    dom.cleanupOnceWrap.hidden = mode !== 'once';
    dom.cleanupWeekdayWrap.hidden = mode !== 'weekly';
    dom.cleanupMonthDayWrap.hidden = mode !== 'monthly';
    dom.settingCleanupOnceDate.min = currentToday;

    if (mode === 'once' && !dom.settingCleanupOnceDate.value) {
      dom.settingCleanupOnceDate.value = shiftDateKey(currentToday, 1);
    }
  }

  function updateCleanupPreview() {
    const draft = readCleanupConfigFromForm();
    dom.cleanupNext.classList.remove('is-armed', 'is-error');

    if (draft.mode === 'off') {
      dom.cleanupNext.textContent = '学习记录自动清理未开启，任务与记录会一直保留。';
      return;
    }

    const validation = validateCleanupDraft(draft);
    if (!validation.ok) {
      dom.cleanupNext.textContent = validation.message;
      dom.cleanupNext.classList.add('is-error');
      return;
    }

    const next = getNextCleanupOccurrence(validation.config);
    if (!next) {
      dom.cleanupNext.textContent = '还没有可执行的下一次清理时间。';
      dom.cleanupNext.classList.add('is-error');
      return;
    }

    dom.cleanupNext.textContent = `${getCleanupRuleLabel(validation.config)} · 下次清理：${formatCleanupTimestamp(next)} · 清空任务与专注记录`;
    dom.cleanupNext.classList.add('is-armed');
  }

  function populateCleanupForm() {
    const config = normalizeAutoClear(state.settings.autoClear);
    dom.settingCleanupMode.value = config.mode;
    dom.settingCleanupTime.value = config.time;
    dom.settingCleanupOnceDate.value = config.onceDate || shiftDateKey(currentToday, 1);
    dom.settingCleanupWeekday.value = String(config.weekday);
    dom.settingCleanupMonthDay.value = String(config.monthDay);
    syncCleanupFieldVisibility();
    updateCleanupPreview();
  }

  function handleCleanupFieldChange() {
    syncCleanupFieldVisibility();
    updateCleanupPreview();
  }

  function switchSettingsTab(tab, { moveFocus = false } = {}) {
    const isData = tab === 'data';
    dom.settingsTabTimer.classList.toggle('is-active', !isData);
    dom.settingsTabData.classList.toggle('is-active', isData);
    dom.settingsTabTimer.setAttribute('aria-selected', String(!isData));
    dom.settingsTabData.setAttribute('aria-selected', String(isData));
    dom.settingsTabTimer.tabIndex = isData ? -1 : 0;
    dom.settingsTabData.tabIndex = isData ? 0 : -1;
    dom.settingsPanelTimer.hidden = isData;
    dom.settingsPanelData.hidden = !isData;
    dom.settingsTitle.textContent = isData ? '数据与清理' : '设置你的节奏';
    dom.settingsSub.textContent = isData
      ? '运行状态自动重置，学习记录由你决定何时清理。'
      : '不需要追赶时间，只需要找到自己的频率。';

    if (moveFocus) (isData ? dom.settingsTabData : dom.settingsTabTimer).focus();
    const shell = dom.settingsDialog.querySelector('.dialog-shell');
    if (dom.settingsDialog.open && shell) shell.scrollTop = 0;
  }

  function handleSettingsTabKeydown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextTab = event.currentTarget === dom.settingsTabTimer ? 'data' : 'timer';
    switchSettingsTab(nextTab, { moveFocus: true });
  }

  function openSettings(tab = 'timer') {
    dom.settingsForm.reset();
    dom.settingFocus.value = String(state.settings.focusMin);
    dom.settingShort.value = String(state.settings.shortMin);
    dom.settingLong.value = String(state.settings.longMin);
    dom.settingRounds.value = String(state.settings.rounds);
    dom.settingSound.checked = state.settings.sound;
    dom.settingAutoStart.checked = state.settings.autoStart;
    dom.settingResetRuntime.checked = state.settings.resetRuntimeOnStart !== false;
    dom.settingNotifications.checked = state.settings.notifications
      && 'Notification' in window
      && Notification.permission === 'granted';
    updateNotificationHint();
    populateCleanupForm();
    dom.dataStatus.hidden = true;
    dom.dataStatus.classList.remove('is-error');
    dom.dataStatus.textContent = '';
    switchSettingsTab(tab);

    if (!dom.settingsDialog.open) {
      if (typeof dom.settingsDialog.showModal === 'function') {
        dom.settingsDialog.showModal();
      } else {
        dom.settingsDialog.setAttribute('open', '');
      }
    }
    const shell = dom.settingsDialog.querySelector('.dialog-shell');
    if (shell) shell.scrollTop = 0;
  }

  function closeSettings() {
    if (!dom.settingsDialog.open) {
      dom.settingsDialog.removeAttribute('open');
      return;
    }
    if (typeof dom.settingsDialog.close === 'function') {
      dom.settingsDialog.close();
    } else {
      dom.settingsDialog.removeAttribute('open');
    }
  }

  function showDataStatus(message, isError = false) {
    dom.dataStatus.hidden = false;
    dom.dataStatus.textContent = message;
    dom.dataStatus.classList.toggle('is-error', isError);
  }

  function saveSettings(event) {
    event.preventDefault();

    const previousSettings = { ...state.settings };
    const previousAutoClear = normalizeAutoClear(previousSettings.autoClear);
    const cleanupValidation = validateCleanupDraft(readCleanupConfigFromForm());
    if (!cleanupValidation.ok) {
      switchSettingsTab('data');
      updateCleanupPreview();
      const fieldMap = {
        time: dom.settingCleanupTime,
        onceDate: dom.settingCleanupOnceDate,
        monthDay: dom.settingCleanupMonthDay
      };
      const field = fieldMap[cleanupValidation.field];
      if (field) field.focus();
      return;
    }

    const nowTimestamp = Date.now();
    const cleanupConfig = { ...cleanupValidation.config };
    const scheduleChanged = !cleanupConfigsEqual(previousAutoClear, cleanupConfig);
    cleanupConfig.lastRunAt = 0;

    if (cleanupConfig.mode === 'off') {
      cleanupConfig.lastRunAt = 0;
    } else if (cleanupConfig.mode === 'once') {
      cleanupConfig.lastRunAt = 0;
    } else if (scheduleChanged || !previousAutoClear.lastRunAt) {
      cleanupConfig.lastRunAt = nowTimestamp;
    } else {
      cleanupConfig.lastRunAt = previousAutoClear.lastRunAt;
    }

    const nextSettings = {
      focusMin: clampInt(dom.settingFocus.value, 1, 120, previousSettings.focusMin),
      shortMin: clampInt(dom.settingShort.value, 1, 60, previousSettings.shortMin),
      longMin: clampInt(dom.settingLong.value, 1, 120, previousSettings.longMin),
      rounds: clampInt(dom.settingRounds.value, 1, 8, previousSettings.rounds),
      sound: dom.settingSound.checked,
      notifications: dom.settingNotifications.checked
        && 'Notification' in window
        && Notification.permission === 'granted',
      autoStart: dom.settingAutoStart.checked,
      resetRuntimeOnStart: dom.settingResetRuntime.checked,
      autoClear: cleanupConfig
    };

    state.settings = nextSettings;
    if (state.timer.cycleDone > nextSettings.rounds) {
      state.timer.cycleDone = nextSettings.rounds;
    }

    const timer = state.timer;
    const isPristine = !timer.running && Math.abs(timer.remainingMs - timer.durationMs) < 1000;
    if (isPristine) {
      timer.durationMs = durationForPhase(timer.phase, nextSettings);
      timer.remainingMs = timer.durationMs;
    }

    saveState();
    closeSettings();
    updateSoundButton();
    updateAutoClearIndicator();
    renderDateHeader();
    renderTimer();
    renderStats();
    showToast(nextSettings.autoClear.mode === 'off'
      ? '设置已保存。'
      : '设置已保存，学习记录清理规则已生效。');
  }

  function exportBackup() {
    const payload = {
      app: 'yiyu-focus',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        tasks: state.tasks,
        sessions: state.sessions,
        settings: state.settings
      }
    };

    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `一隅专注备份_${dateKey()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      showDataStatus('备份已导出。换电脑时可以用「导入备份」恢复。');
    } catch (error) {
      showDataStatus('导出失败，请稍后再试。', true);
    }
  }

  async function importBackup(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    try {
      if (file.size > MAX_IMPORT_SIZE) {
        throw new Error('file too large');
      }
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payload = parsed && typeof parsed.data === 'object' ? parsed.data : parsed;
      if (!payload || !Array.isArray(payload.tasks) || !Array.isArray(payload.sessions)) {
        throw new Error('invalid backup');
      }

      if (!window.confirm(`导入备份会覆盖当前的任务与专注记录，确定继续吗？\n备份中包含 ${payload.tasks.length} 项任务。`)) {
        return;
      }

      const imported = normalizeState({
        tasks: payload.tasks,
        sessions: payload.sessions,
        settings: payload.settings
      });

      // A restored schedule should not immediately erase the backup that was just imported.
      const importedCleanup = imported.settings.autoClear;
      if (importedCleanup.mode === 'once') {
        const scheduled = getOnceScheduledDate(importedCleanup);
        if (!scheduled || scheduled.getTime() <= Date.now()) importedCleanup.mode = 'off';
      } else if (importedCleanup.mode !== 'off') {
        importedCleanup.lastRunAt = Date.now();
      }

      stopTicker();
      state = imported;
      currentToday = dateKey();
      ui = createUiState();
      saveState();
      closeSettings();
      renderAll();
      updateSoundButton();
      showToast(`备份已导入，共恢复 ${imported.tasks.length} 项任务。`);
    } catch (error) {
      showDataStatus('导入失败：这个文件不是有效的「一隅」备份。', true);
    } finally {
      dom.importFile.value = '';
    }
  }

  function clearUsageData({ source = 'manual' } = {}) {
    const snapshot = {
      tasks: state.tasks.map((task) => ({ ...task })),
      sessions: state.sessions.map((session) => ({ ...session })),
      activeTaskId: state.timer.activeTaskId
    };
    const hadData = snapshot.tasks.length > 0 || snapshot.sessions.length > 0;

    state.tasks = [];
    state.sessions = [];
    state.timer.activeTaskId = null;
    justCompletedTaskId = null;
    lastTaskRangeKey = '';
    saveState();
    renderAll();

    if (!hadData) {
      if (source === 'manual') showToast('当前没有可清除的数据。');
      return false;
    }

    showToast(
      source === 'auto' ? '已按计划清空任务与专注记录。' : '任务与专注记录已清除。',
      {
        icon: 'trash',
        actionLabel: '撤销',
        duration: 12_000,
        onAction: () => {
          const currentTaskIds = new Set(state.tasks.map((task) => task.id));
          const currentSessionIds = new Set(state.sessions.map((session) => session.id));
          state.tasks = [
            ...state.tasks,
            ...snapshot.tasks.filter((task) => !currentTaskIds.has(task.id))
          ];
          state.sessions = [
            ...state.sessions,
            ...snapshot.sessions.filter((session) => !currentSessionIds.has(session.id))
          ];
          if (!state.timer.activeTaskId && snapshot.activeTaskId) {
            const restoredTask = state.tasks.find((task) => task.id === snapshot.activeTaskId && !task.completed);
            if (restoredTask) state.timer.activeTaskId = snapshot.activeTaskId;
          }
          saveState();
          renderAll();
          showToast('已恢复清理前的数据。');
        }
      }
    );

    return true;
  }

  function manuallyClearData() {
    const confirmed = window.confirm('将清空所有任务和专注记录，设置与记录清理规则会保留。\n清空后 12 秒内可以撤销，确定继续吗？');
    if (!confirmed) return;

    closeSettings();
    clearUsageData({ source: 'manual' });
  }

  function checkScheduledCleanup() {
    if (!booted) return false;

    const config = normalizeAutoClear(state.settings.autoClear);
    if (config.mode === 'off') return false;

    const now = new Date();
    const previous = getPreviousCleanupOccurrence(config, now);
    if (!previous || previous.getTime() <= config.lastRunAt) return false;

    const hadData = state.tasks.length > 0 || state.sessions.length > 0;
    state.settings.autoClear.lastRunAt = now.getTime();
    if (config.mode === 'once') {
      state.settings.autoClear.mode = 'off';
    }

    if (hadData) {
      clearUsageData({ source: 'auto' });
    } else {
      saveState();
      updateAutoClearIndicator();
    }
    return true;
  }

  function updateAutoClearIndicator() {
    const config = normalizeAutoClear(state.settings.autoClear);
    if (config.mode === 'off') {
      dom.autoClearIndicator.hidden = true;
      return;
    }

    const next = getNextCleanupOccurrence(config, new Date());
    dom.autoClearIndicatorText.textContent = next
      ? `记录清理：${formatCleanupTimestamp(next)}`
      : '记录清理：等待执行';
    dom.autoClearIndicator.title = next
      ? `${getCleanupRuleLabel(config)}，下次清理：${formatCleanupTimestamp(next)}。到点会清空任务和专注记录，可在设置中关闭。`
      : '自动清理已开启。到点会清空任务和专注记录，可在设置中关闭。';
    dom.autoClearIndicator.hidden = false;
  }

  /* ------------------------------------------------------------------------
     Sound / zen / misc UI
     ------------------------------------------------------------------------ */

  function setZenMode(enabled) {
    document.body.classList.toggle('is-zen', enabled);
    dom.zenBtn.setAttribute('aria-pressed', String(enabled));
    dom.zenBtn.setAttribute('aria-label', enabled ? '退出专注模式' : '进入专注模式');
    dom.zenBtn.title = enabled ? '退出专注模式 (Esc)' : '专注模式';
    dom.zenBtn.innerHTML = iconMarkup(enabled ? 'minimize' : 'maximize');
  }

  function toggleZenMode() {
    setZenMode(!document.body.classList.contains('is-zen'));
  }

  function renderAll() {
    renderDateHeader();
    renderCalendar();
    renderTasks();
    renderStats();
    renderTimer();
    updateSoundButton();
    updateAutoClearIndicator();
    updateAddButtonState();
  }

  /* ------------------------------------------------------------------------
     Events
     ------------------------------------------------------------------------ */

  function bindEvents() {
    dom.startBtn.addEventListener('click', toggleTimer);
    dom.resetBtn.addEventListener('click', resetTimer);
    dom.skipBtn.addEventListener('click', skipPhase);
    dom.soundBtn.addEventListener('click', toggleSound);
    dom.zenBtn.addEventListener('click', toggleZenMode);

    dom.calTodayBtn.addEventListener('click', goToToday);
    dom.taskTodayBtn.addEventListener('click', goToToday);
    dom.multiSelectBtn.addEventListener('click', toggleMultiSelectMode);
    dom.prevMonthBtn.addEventListener('click', () => shiftViewMonth(-1));
    dom.nextMonthBtn.addEventListener('click', () => shiftViewMonth(1));

    dom.calendarGrid.addEventListener('pointerdown', handleCalendarPointerDown);
    window.addEventListener('pointermove', handleCalendarPointerMove, { passive: false });
    window.addEventListener('pointerup', finishCalendarDrag);
    window.addEventListener('pointercancel', cancelCalendarDrag);
    dom.calendarGrid.addEventListener('click', handleCalendarClick);
    dom.calendarGrid.addEventListener('keydown', handleCalendarKeydown);

    dom.taskForm.addEventListener('submit', addTask);
    dom.taskInput.addEventListener('input', updateAddButtonState);
    dom.taskInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        dom.taskInput.value = '';
        updateAddButtonState();
      }
    });
    dom.estimateMinus.addEventListener('click', () => setComposerEstimate(ui.composerEstimate - 1));
    dom.estimatePlus.addEventListener('click', () => setComposerEstimate(ui.composerEstimate + 1));

    dom.taskList.addEventListener('click', (event) => {
      const actionButton = event.target.closest('button[data-action]');
      if (!actionButton) return;
      const taskItem = actionButton.closest('.task-item');
      if (!taskItem) return;
      const id = taskItem.dataset.id;
      const action = actionButton.dataset.action;

      if (action === 'toggle') toggleTask(id);
      else if (action === 'focus') setActiveTask(id);
      else if (action === 'delete') deleteTask(id);
    });

    dom.heroSettingsBtn.addEventListener('click', () => openSettings('timer'));
    dom.sidebarSettingsBtn.addEventListener('click', () => openSettings('data'));
    dom.settingsTabTimer.addEventListener('click', () => switchSettingsTab('timer'));
    dom.settingsTabData.addEventListener('click', () => switchSettingsTab('data'));
    dom.settingsTabTimer.addEventListener('keydown', handleSettingsTabKeydown);
    dom.settingsTabData.addEventListener('keydown', handleSettingsTabKeydown);
    dom.resetRuntimeBtn.addEventListener('click', manuallyResetRuntime);
    dom.closeSettingsBtn.addEventListener('click', closeSettings);
    dom.cancelSettingsBtn.addEventListener('click', closeSettings);
    dom.settingsForm.addEventListener('submit', saveSettings);
    dom.testSoundBtn.addEventListener('click', () => playChime('focus', true));
    dom.exportBtn.addEventListener('click', exportBackup);
    dom.importBtn.addEventListener('click', () => dom.importFile.click());
    dom.importFile.addEventListener('change', importBackup);
    dom.resetDataBtn.addEventListener('click', manuallyClearData);
    dom.settingCleanupMode.addEventListener('change', handleCleanupFieldChange);
    [dom.settingCleanupTime, dom.settingCleanupOnceDate, dom.settingCleanupWeekday, dom.settingCleanupMonthDay]
      .forEach((field) => {
        field.addEventListener('input', updateCleanupPreview);
        field.addEventListener('change', updateCleanupPreview);
      });

    dom.settingNotifications.addEventListener('change', async () => {
      if (!dom.settingNotifications.checked) {
        updateNotificationHint();
        return;
      }
      const granted = await requestNotificationPermission();
      if (!granted) {
        dom.settingNotifications.checked = false;
      }
      updateNotificationHint();
    });

    dom.settingsDialog.addEventListener('click', (event) => {
      if (event.target === dom.settingsDialog) closeSettings();
    });

    dom.toastAction.addEventListener('click', () => {
      if (typeof toastCallback === 'function') {
        const callback = toastCallback;
        hideToast();
        callback();
      }
    });

    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        tickTimer();
        refreshClock();
        checkScheduledCleanup();
        if (state.timer.running) paintTimerProgress();
      }
    });

    window.setInterval(() => {
      refreshClock();
      checkScheduledCleanup();
    }, 15_000);
  }

  function handleGlobalKeydown(event) {
    if (dom.settingsDialog.open) return;

    if (event.key === 'Escape' && document.body.classList.contains('is-zen')) {
      setZenMode(false);
      return;
    }

    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const button = target instanceof Element ? target.closest('button') : null;

    if (event.code === 'Space') {
      if (button && button !== dom.startBtn) return;
      event.preventDefault();
      if (!event.repeat) toggleTimer();
      return;
    }

    if (event.key.toLowerCase() === 'r') {
      if (button) return;
      event.preventDefault();
      if (!event.repeat) resetTimer();
    }
  }

  function handleCalendarPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const dayButton = event.target.closest('button.cal-day');
    if (!dayButton || dayButton.disabled) return;

    event.preventDefault();
    draggingCalendar = true;
    dragAnchor = dayButton.dataset.date;
    dragHasMoved = false;
    dragAdditive = ui.multiSelect || event.ctrlKey || event.metaKey || event.shiftKey;
    dragToggle = ui.multiSelect || event.ctrlKey || event.metaKey;
    dragBaseSelection = dragAdditive ? new Set(ui.selectedDates) : null;
    dom.calendarGrid.classList.add('is-selecting');
    dom.calendarGrid.classList.toggle('is-additive', dragAdditive);

    if (!dragAdditive) selectSingleDate(dragAnchor);
  }

  function handleCalendarPointerMove(event) {
    if (!draggingCalendar) return;
    if (event.cancelable) event.preventDefault();

    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const dayButton = hit && hit.closest ? hit.closest('button.cal-day') : null;
    if (!dayButton || !dom.calendarGrid.contains(dayButton) || dayButton.disabled) return;

    const date = dayButton.dataset.date;
    if (!date) return;
    if (date === dragAnchor && !dragHasMoved) return;
    if (date !== dragAnchor) dragHasMoved = true;

    selectRange(dragAnchor, date, { additive: dragAdditive, base: dragBaseSelection });
  }

  function cleanupCalendarDrag() {
    draggingCalendar = false;
    dragAnchor = null;
    dragHasMoved = false;
    dragAdditive = false;
    dragToggle = false;
    dragBaseSelection = null;
    dom.calendarGrid.classList.remove('is-selecting', 'is-additive');
  }

  function finishCalendarDrag() {
    if (!draggingCalendar) return;

    const wasAdditive = dragAdditive;
    const wasToggle = dragToggle;
    const anchor = dragAnchor;
    const moved = dragHasMoved;
    cleanupCalendarDrag();

    if (moved || !wasAdditive || !anchor) return;
    if (wasToggle) {
      toggleDateInSelection(anchor);
    } else {
      addDateToSelection(anchor);
    }
  }

  function cancelCalendarDrag() {
    if (!draggingCalendar) return;
    cleanupCalendarDrag();
  }

  function handleCalendarClick(event) {
    if (event.detail !== 0) return;
    const dayButton = event.target.closest('button.cal-day');
    if (!dayButton || dayButton.disabled) return;
    event.preventDefault();

    const key = dayButton.dataset.date;
    if (ui.multiSelect || event.ctrlKey || event.metaKey) {
      toggleDateInSelection(key);
    } else if (event.shiftKey) {
      addDateToSelection(key);
    } else {
      selectSingleDate(key);
    }
  }

  function handleCalendarKeydown(event) {
    const deltas = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7
    };
    if (!(event.key in deltas)) return;

    const dayButton = event.target.closest('button.cal-day');
    if (!dayButton || dayButton.disabled) return;

    event.preventDefault();
    const nextKey = shiftDateKey(dayButton.dataset.date, deltas[event.key]);
    const nextDate = parseDateKey(nextKey);

    if (nextDate.getFullYear() !== ui.viewYear || nextDate.getMonth() !== ui.viewMonth) {
      ui.viewYear = nextDate.getFullYear();
      ui.viewMonth = nextDate.getMonth();
      ui.selectedDates = new Set([nextKey]);
      renderCalendar();
      renderTasks();
    } else {
      selectSingleDate(nextKey);
    }

    const nextButton = dom.calendarGrid.querySelector(`button.cal-day[data-date="${nextKey}"]`);
    if (nextButton) nextButton.focus();
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  function init() {
    currentToday = dateKey();
    ui = createUiState();
    bindEvents();

    const resetRuntimeOnStart = state.settings.resetRuntimeOnStart !== false;
    let runtimeResetOnBoot = false;
    if (resetRuntimeOnStart && hasRuntimeState()) {
      // If a focus session finished while the app was closed, record it first,
      // then start from a clean runtime state. Records are never sacrificed.
      if (state.timer.running && state.timer.endAt && state.timer.endAt <= Date.now()) {
        restoreTimerState();
      }
      resetRuntimeState({ persist: true, render: false });
      runtimeResetOnBoot = true;
    } else {
      restoreTimerState();
    }

    renderAll();
    setComposerEstimate(ui.composerEstimate);
    booted = true;
    requestPersistentStorage();

    if (bootWarning) {
      window.setTimeout(() => {
        showToast(bootWarning, { tone: 'error', icon: 'alert', duration: 6500 });
      }, 350);
    } else if (restoredExpiredPhase) {
      window.setTimeout(() => {
        showToast(
          runtimeResetOnBoot
            ? '上次结束的专注已记入记录，运行状态已重置。'
            : '上次的专注计时已经结束，新的阶段准备好了。',
          { icon: runtimeResetOnBoot ? 'reset' : 'clock', duration: 5000 }
        );
      }, 350);
    }

    window.setTimeout(() => {
      checkScheduledCleanup();
    }, 900);
  }

  function requestPersistentStorage() {
    try {
      if (!navigator.storage || typeof navigator.storage.persist !== 'function') return;
      Promise.resolve(navigator.storage.persisted())
        .then((alreadyPersisted) => {
          if (!alreadyPersisted) return navigator.storage.persist();
          return false;
        })
        .catch(() => {});
    } catch (error) {
      /* persistent storage is an optional browser protection */
    }
  }

  init();
})();