(() => {
  "use strict";

  const STORAGE_KEY = "rijin-personal-workbench-v1-release";
  const WELCOME_SEEN_KEY = "rijin-welcome-seen-v2";
  const MUSIC_PREFERENCE_KEY = "rijin-music-enabled-v1";
  const MUSIC_VOLUME_KEY = "rijin-music-volume-v1";
  const IOS_INSTALL_TIP_KEY = "rijin-ios-install-tip-dismissed-v1";
  const AUTH_SESSION_KEY = "rijin-supabase-session-v1";
  const DEVICE_ID_KEY = "rijin-device-id-v1";
  const SUPABASE = window.RIJIN_SUPABASE || {};
  const COLORS = ["#61715f", "#d86e59", "#c69a42", "#718390", "#9a7b68", "#8b7f9c"];
  const EMOJIS = ["📖", "🏃", "✍️", "🌿", "💧", "🧘", "💼", "🎧", "☀️", "🍵"];
  const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const SHORT_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  const MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  const CATEGORY_COLORS = {
    成长: "#61715f",
    健康: "#d86e59",
    工作: "#718390",
    学习: "#667f8a",
    生活: "#c69a42",
    关系: "#8b7f9c",
    其他: "#9a927f",
  };

  const ui = {
    view: "today",
    period: "day",
    activePlanDate: todayKey(),
    selectedDate: todayKey(),
    calendarDate: startOfMonth(new Date()),
    editingHabitId: null,
    selectedEmoji: "📖",
    selectedColor: COLORS[0],
    quickTaskType: "bonus",
    quickTaskDate: todayKey(),
    modalQuickCategory: "其他",
  };

  let state = loadState();
  let authSession = loadAuthSession();
  let authEmail = "";
  let noteTimer = null;
  let toastTimer = null;
  let toastActionHandler = null;
  let lastDeletedExtra = null;
  let pendingConfirmAction = null;
  let syncTimer = null;
  let syncInFlight = false;
  let applyingRemote = false;
  let lastSyncedAt = null;
  let ocrWorker = null;
  let ocrPreviewUrl = null;
  let ocrRunToken = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function parseKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function addMonths(date, amount) {
    return new Date(date.getFullYear(), date.getMonth() + amount, 1);
  }

  function startOfWeekMonday(date) {
    const next = new Date(date);
    const day = next.getDay();
    next.setDate(next.getDate() - (day === 0 ? 6 : day - 1));
    next.setHours(0, 0, 0, 0);
    return next;
  }

  function daysInMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  function uid(prefix = "id") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function createSeedState() {
    const created = todayKey();
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
      freshSeed: true,
      habits: [
        {
          id: uid("habit"),
          title: "阅读 20 分钟",
          emoji: "📖",
          category: "成长",
          color: "#61715f",
          taskType: "baseline",
          startTime: "21:00",
          endTime: "21:20",
          createdAt: created,
          archivedAt: null,
        },
        {
          id: uid("habit"),
          title: "运动 30 分钟",
          emoji: "🏃",
          category: "健康",
          color: "#d86e59",
          taskType: "baseline",
          startTime: "19:30",
          endTime: "20:00",
          createdAt: created,
          archivedAt: null,
        },
        {
          id: uid("habit"),
          title: "写下今日收获",
          emoji: "✍️",
          category: "成长",
          color: "#c69a42",
          taskType: "bonus",
          startTime: "22:00",
          endTime: "22:10",
          createdAt: created,
          archivedAt: null,
        },
      ],
      days: {},
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createSeedState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.habits) || typeof parsed.days !== "object") {
        throw new Error("Invalid saved data");
      }
      return normalizeState(parsed);
    } catch (error) {
      console.warn("Could not load saved data:", error);
      return createSeedState();
    }
  }

  function normalizeState(candidate) {
    const normalized = {
      version: 1,
      createdAt: candidate.createdAt || new Date().toISOString(),
      updatedAt: Number(candidate.updatedAt) || Date.parse(candidate.createdAt) || 0,
      freshSeed: false,
      habits: candidate.habits
        .filter((habit) => habit && habit.id && habit.title)
        .map((habit, index) => ({
          id: String(habit.id),
          title: String(habit.title).slice(0, 30),
          emoji: habit.emoji || "✦",
          category: CATEGORY_COLORS[habit.category] ? habit.category : "其他",
          color: /^#[0-9a-f]{6}$/i.test(habit.color || "") ? habit.color : COLORS[index % COLORS.length],
          taskType: ["baseline", "bonus", "weekly"].includes(habit.taskType) ? habit.taskType : "baseline",
          startTime: /^\d{2}:\d{2}$/.test(habit.startTime || "") ? habit.startTime : "",
          endTime: /^\d{2}:\d{2}$/.test(habit.endTime || "") ? habit.endTime : "",
          weekday:
            Number.isInteger(habit.weekday) && habit.weekday >= 0 && habit.weekday <= 6
              ? habit.weekday
              : null,
          createdAt: habit.createdAt || todayKey(),
          archivedAt: habit.archivedAt || null,
        })),
      days: {},
    };

    Object.entries(candidate.days || {}).forEach(([key, day]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day || typeof day !== "object") return;
      normalized.days[key] = {
        habits: day.habits && typeof day.habits === "object" ? day.habits : {},
        extras: Array.isArray(day.extras)
          ? day.extras
              .filter((task) => task && task.id && task.title)
              .map((task) => ({
                id: String(task.id),
                title: String(task.title).slice(0, 80),
                category: CATEGORY_COLORS[task.category] ? task.category : "其他",
                taskType: ["baseline", "bonus", "weekly"].includes(task.taskType) ? task.taskType : "bonus",
                startTime: /^\d{2}:\d{2}$/.test(task.startTime || "") ? task.startTime : "",
                endTime: /^\d{2}:\d{2}$/.test(task.endTime || "") ? task.endTime : "",
                createdAt: task.createdAt || new Date().toISOString(),
                completedAt: task.completedAt || null,
              }))
          : [],
        note: typeof day.note === "string" ? day.note.slice(0, 500) : "",
        logs: day.logs && typeof day.logs === "object" ? day.logs : {},
      };
    });

    return normalized;
  }

  function persist(options = {}) {
    const { touch = true, schedule = true } = options;
    if (touch && !applyingRemote) {
      state.updatedAt = Date.now();
      state.freshSeed = false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (schedule && authSession) scheduleSync();
    } catch (error) {
      console.error("Could not save data:", error);
      showToast("保存失败，请导出备份");
    }
  }

  function ensureDay(key = todayKey()) {
    if (!state.days[key]) {
      state.days[key] = { habits: {}, extras: [], note: "", logs: {} };
    }
    if (!state.days[key].logs) state.days[key].logs = {};
    return state.days[key];
  }

  function habitsForDate(key, includeArchivedCompletion = false) {
    const day = state.days[key];
    const weekday = parseKey(key).getDay();
    return state.habits.filter(
      (habit) =>
        (habit.weekday == null || habit.weekday === weekday) &&
        habit.createdAt <= key &&
        (!habit.archivedAt ||
          habit.archivedAt > key ||
          (includeArchivedCompletion &&
            habit.archivedAt === key &&
            Boolean(day?.habits?.[habit.id])))
    );
  }

  function getDayStats(key) {
    const day = state.days[key] || { habits: {}, extras: [], note: "" };
    const activeHabits = habitsForDate(key, true);
    const completedHabitIds = new Set(
      Object.entries(day.habits || {})
        .filter(([, completedAt]) => Boolean(completedAt))
        .map(([id]) => id)
    );
    const completedHabits = activeHabits.filter((habit) => completedHabitIds.has(habit.id)).length;
    const extras = Array.isArray(day.extras) ? day.extras : [];
    const completedExtras = extras.filter((task) => task.completedAt).length;
    const planned = activeHabits.length + extras.length;
    const completed = completedHabits + completedExtras;
    return {
      key,
      activeHabits,
      completedHabitIds,
      completedHabits,
      extras,
      completedExtras,
      planned,
      completed,
      rate: planned ? Math.round((completed / planned) * 100) : 0,
    };
  }

  function getRangeKeys(start, end) {
    const keys = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cursor <= last) {
      keys.push(dateKey(cursor));
      cursor = addDays(cursor, 1);
    }
    return keys;
  }

  function aggregate(keys) {
    return keys.reduce(
      (total, key) => {
        const stats = getDayStats(key);
        const day = state.days[key];
        const logs = Object.values(day?.logs || {});
        total.planned += stats.planned;
        total.completed += stats.completed;
        total.activeDays += stats.completed > 0 ? 1 : 0;
        total.minutes += logs.reduce((sum, log) => sum + (Number(log.actualMinutes) || 0), 0);
        total.quantity += logs.reduce((sum, log) => sum + (Number(log.quantity) || 0), 0);
        total.blockers += logs.filter((log) => String(log.blocker || "").trim()).length;
        if (stats.planned > 0) total.trackedDays += 1;
        return total;
      },
      { planned: 0, completed: 0, activeDays: 0, trackedDays: 0, rate: 0, minutes: 0, quantity: 0, blockers: 0 }
    );
  }

  function currentStreak() {
    let cursor = new Date();
    let streak = 0;
    if (getDayStats(dateKey(cursor)).completed === 0) {
      cursor = addDays(cursor, -1);
    }
    for (let i = 0; i < 3660; i += 1) {
      if (getDayStats(dateKey(cursor)).completed > 0) {
        streak += 1;
        cursor = addDays(cursor, -1);
      } else {
        break;
      }
    }
    return streak;
  }

  function allTimeCompleted() {
    return Object.keys(state.days).reduce((sum, key) => sum + getDayStats(key).completed, 0);
  }

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 6) return "夜深了";
    if (hour < 11) return "上午好";
    if (hour < 14) return "中午好";
    if (hour < 18) return "下午好";
    return "晚上好";
  }

  function formatMonthDay(date) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function categoryColor(category) {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS.其他;
  }

  function renderAll() {
    renderChrome();
    renderToday();
    renderReview();
    renderHabits();
    renderCloudAccount();
  }

  function renderChrome() {
    const now = new Date();
    $("#topbar-weekday").textContent = WEEKDAYS[now.getDay()];
    $("#topbar-date").textContent = formatMonthDay(now);
    $("#greeting").textContent = getGreeting();
    $("#current-streak").textContent = currentStreak();
    $("#all-time-completed").textContent = allTimeCompleted();

    const streak = currentStreak();
    const insight = $("#sidebar-insight");
    if (streak >= 7) {
      insight.textContent = `你已经连续 ${streak} 天有完成。稳定，正在变成你的力量。`;
    } else if (allTimeCompleted() > 0) {
      insight.textContent = `你已经留下 ${allTimeCompleted()} 次完成记录。每一次，都让轨迹更清晰。`;
    } else {
      insight.textContent = "今天完成一件小事，也算认真生活。";
    }
  }

  function taskTemplate({ task, completed, completedAt, type, log, day, deletable = true }) {
    const color = task.color || categoryColor(task.category);
    const habitOrigin =
      type === "habit" && Number.isInteger(task.weekday)
        ? `每周${SHORT_WEEKDAYS[task.weekday]}`
        : "每日固定";
    const typeMeta =
      type === "habit"
        ? `<span class="task-origin">${habitOrigin}</span>`
        : `<span class="task-origin">${completedAt ? `${formatTime(completedAt)} 完成` : "本次计划"}</span>`;
    const detailBits = [];
    if (Number(log?.actualMinutes) > 0) detailBits.push(`${Number(log.actualMinutes)} 分钟`);
    if (Number(log?.quantity) > 0) detailBits.push(`${Number(log.quantity)} 题`);
    if (log?.blocker) detailBits.push("有卡点");
    const scheduleLabel = task.startTime
      ? `${task.startTime}${task.endTime ? `–${task.endTime}` : ""}`
      : "";
    return `
      <article
        class="task-item ${completed ? "is-completed" : ""}"
        style="--task-color: ${escapeHtml(color)}"
        data-task-type="${type}"
        data-task-id="${escapeHtml(task.id)}"
        data-task-day="${escapeHtml(day || ui.activePlanDate)}"
      >
        <button class="task-check" type="button" data-action="toggle-task" aria-label="${completed ? "标记为未完成" : "标记为完成"}">
          <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg>
        </button>
        <div class="task-main">
          <span class="task-title">${escapeHtml(task.title)}</span>
          <div class="task-meta">
            <span class="task-category">${escapeHtml(task.category || "其他")}</span>
            ${scheduleLabel ? `<span class="task-schedule">${escapeHtml(scheduleLabel)}</span>` : ""}
            ${typeMeta}
            ${detailBits.length ? `<span class="task-detail-chip">${detailBits.join(" · ")}</span>` : ""}
          </div>
        </div>
        <div class="task-actions">
          ${type === "habit" ? `<span class="task-emoji" aria-hidden="true">${escapeHtml(task.emoji)}</span>` : ""}
          <button class="task-log-button ${log ? "has-log" : ""}" type="button" data-action="open-task-log" aria-label="记录用时、题量和卡点" title="记录用时、题量和卡点">
            <svg viewBox="0 0 24 24"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/></svg>
          </button>
          ${
            type === "extra" && deletable
              ? `<button class="task-delete" type="button" data-action="delete-extra" aria-label="删除事项">
                   <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
                 </button>`
              : ""
          }
        </div>
      </article>
    `;
  }

  function weeklyItemsForKeys(keys) {
    return keys.flatMap((key) => {
      const day = state.days[key];
      if (!day) return [];
      const entries = [];
      habitsForDate(key).forEach((habit) => {
        if (habit.taskType !== "weekly") return;
        entries.push({
          key,
          type: "habit",
          task: habit,
          completed: Boolean(day.habits?.[habit.id]),
          completedAt: day.habits?.[habit.id],
          log: day.logs?.[habit.id],
        });
      });
      (day.extras || []).forEach((task) => {
        if (task.taskType !== "weekly") return;
        entries.push({
          key,
          type: "extra",
          task,
          completed: Boolean(task.completedAt),
          completedAt: task.completedAt,
          log: day.logs?.[task.id],
        });
      });
      return entries;
    });
  }

  function renderToday() {
    const key = ui.activePlanDate;
    const activeDate = parseKey(key);
    const isToday = key === todayKey();
    const day = state.days[key] || { habits: {}, extras: [], note: "", logs: {} };
    const stats = getDayStats(key);
    const habits = habitsForDate(key);
    const extras = Array.isArray(day.extras) ? day.extras : [];
    const progress = stats.planned ? Math.round((stats.completed / stats.planned) * 100) : 0;

    $("#greeting").textContent = isToday ? getGreeting() : "未来计划";
    $("#today-heading").textContent = isToday ? "今天，把重要的事做好。" : `${formatMonthDay(activeDate)}，提前安排好。`;
    $("#today-intro-copy").textContent = isToday
      ? "不必追赶所有事情，只把眼前这几件一点点完成。"
      : "先安排下来，真正到来时就能少一点仓促。";

    $("#today-progress-ring").style.setProperty("--progress", `${progress * 3.6}deg`);
    $("#today-progress-value").textContent = `${progress}%`;

    if (progress === 100 && stats.planned > 0) {
      $("#today-progress-title").textContent = isToday ? "今天的计划都完成了" : "这一天的计划都完成了";
      $("#today-progress-copy").textContent = isToday ? "可以安心收尾，记得留下一句记录" : "安排清晰，可以继续查看其他日期";
    } else if (progress >= 50) {
      $("#today-progress-title").textContent = "已经走过一半";
      $("#today-progress-copy").textContent = `已完成 ${stats.completed} 件，还有 ${Math.max(stats.planned - stats.completed, 0)} 件待完成`;
    } else if (progress > 0) {
      $("#today-progress-title").textContent = "好的开始";
      $("#today-progress-copy").textContent = `已完成 ${stats.completed} 件，还有 ${Math.max(stats.planned - stats.completed, 0)} 件待完成`;
    } else {
      $("#today-progress-title").textContent = stats.planned ? "从第一件小事开始" : "今天还很轻盈";
      $("#today-progress-copy").textContent = stats.planned ? `还有 ${stats.planned} 件待完成` : "暂无安排，也可以留一点时间给自己";
    }

    const weekDates = Array.from({ length: 7 }, (_, offset) =>
      addDays(startOfWeekMonday(new Date()), offset)
    );
    const weekKeys = weekDates.map(dateKey);
    const weekStats = aggregate(weekKeys);
    const weeklyItems = weeklyItemsForKeys(weekKeys);
    $("#week-summary").textContent = `本周 ${weekStats.completed} / ${weekStats.planned}`;
    $("#week-strip").innerHTML = weekDates.map((date) => {
      const dateValue = dateKey(date);
      const dateStats = getDayStats(dateValue);
      const dayProgress = dateStats.planned ? Math.round((dateStats.completed / dateStats.planned) * 100) : 0;
      return `
        <button class="week-day ${dateValue === key ? "is-selected" : ""} ${dateValue === todayKey() ? "is-today" : ""}" type="button" data-plan-date="${dateValue}" style="--day-progress: ${dayProgress}%">
          <span>${dateValue === todayKey() ? "今天" : `周${SHORT_WEEKDAYS[date.getDay()]}`}</span>
          <strong>${date.getDate()}</strong>
          <small>${dateStats.completed}/${dateStats.planned}</small>
          <i class="week-day-progress" aria-hidden="true"><b></b></i>
        </button>`;
    }).join("");

    $("#weekly-task-preview").innerHTML = weeklyItems.length
      ? weeklyItems
          .map((item) => {
            const date = parseKey(item.key);
            const dayLabel = item.key === todayKey() ? "今天" : `周${SHORT_WEEKDAYS[date.getDay()]}`;
            return `
              <button class="weekly-preview-item ${item.completed ? "is-completed" : ""}" type="button" data-open-week-view>
                <span class="weekly-preview-day">${dayLabel}</span>
                <span class="weekly-preview-title">${item.task.startTime ? `${escapeHtml(item.task.startTime)} · ` : ""}${escapeHtml(item.task.title)}</span>
                <i>${item.completed ? "✓" : "→"}</i>
              </button>`;
          })
          .join("")
      : `<button class="weekly-preview-empty" type="button" data-add-type="weekly">本周还没有单独任务，点这里添加一件要持续推进的事 →</button>`;

    $("#week-total-completed").textContent = weekStats.completed;
    $("#week-total-rate").textContent = `${weekStats.planned ? Math.round((weekStats.completed / weekStats.planned) * 100) : 0}%`;
    $("#week-total-tasks").textContent = weeklyItems.length;
    const scheduleItems = weekKeys.flatMap((dateValue) => {
      const day = state.days[dateValue];
      if (!day) return [];
      const scheduled = [];
      habitsForDate(dateValue).forEach((habit) => {
        if (!habit.startTime && habit.taskType !== "weekly") return;
        scheduled.push({
          task: habit,
          type: "habit",
          key: dateValue,
          completed: Boolean(day.habits?.[habit.id]),
          completedAt: day.habits?.[habit.id],
          log: day.logs?.[habit.id],
        });
      });
      (day.extras || []).forEach((task) => {
        if (!task.startTime && task.taskType !== "weekly") return;
        scheduled.push({
          task,
          type: "extra",
          key: dateValue,
          completed: Boolean(task.completedAt),
          completedAt: task.completedAt,
          log: day.logs?.[task.id],
        });
      });
      return scheduled;
    });
    const timeSlots = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"];
    const slotIndex = (startTime) => {
      if (!startTime) return -1;
      const [hours, minutes] = startTime.split(":").map(Number);
      return Math.max(0, Math.min(timeSlots.length - 1, Math.floor((hours * 60 + minutes - 360) / 120)));
    };
    const scheduleChip = (item) => `
      <button
        class="schedule-task ${item.completed ? "is-completed" : ""}"
        type="button"
        data-action="open-task-log"
        data-task-type="${item.type}"
        data-task-id="${escapeHtml(item.task.id)}"
        data-task-day="${item.key}"
        style="--schedule-color: ${escapeHtml(item.task.color || categoryColor(item.task.category))}"
        title="${escapeHtml(item.task.title)}"
      >
        <span>${item.task.startTime ? escapeHtml(item.task.startTime) : "未排"}</span>
        <strong>${escapeHtml(item.task.title)}</strong>
      </button>`;
    const timetableHeader = weekDates.map((date) => {
      const dateValue = dateKey(date);
      const dateStats = getDayStats(dateValue);
      return `<div class="timetable-day ${dateValue === todayKey() ? "is-today" : ""}">
        <strong>${dateValue === todayKey() ? "今天" : `周${SHORT_WEEKDAYS[date.getDay()]}`}</strong>
        <span>${date.getMonth() + 1}/${date.getDate()} · ${dateStats.completed}/${dateStats.planned}</span>
      </div>`;
    }).join("");
    const timetableRows = timeSlots.map((slot, index) => {
      const cells = weekKeys.map((dateValue) => {
        const items = scheduleItems.filter(
          (item) => item.key === dateValue && slotIndex(item.task.startTime) === index
        );
        return `<div class="timetable-cell">${items.map(scheduleChip).join("")}</div>`;
      }).join("");
      return `<div class="timetable-time">${slot}</div>${cells}`;
    }).join("");
    const unscheduledCells = weekKeys.map((dateValue) => {
      const items = scheduleItems.filter(
        (item) => item.key === dateValue && !item.task.startTime
      );
      return `<div class="timetable-cell">${items.map(scheduleChip).join("")}</div>`;
    }).join("");
    $("#week-timetable").innerHTML = `
      <div class="timetable-corner">时间</div>
      ${timetableHeader}
      ${timetableRows}
      <div class="timetable-time timetable-unscheduled">未排时间</div>
      ${unscheduledCells}
    `;
    $("#week-modal-tasks").innerHTML = weeklyItems.length
      ? weekKeys
          .map((dateValue) => {
            const items = weeklyItems.filter((item) => item.key === dateValue);
            if (!items.length) return "";
            return `
              <section class="week-modal-day-group">
                <h3>${formatMonthDay(parseKey(dateValue))} <span>周${SHORT_WEEKDAYS[parseKey(dateValue).getDay()]}</span></h3>
                <div class="task-list">
                  ${items
                    .map((item) =>
                      taskTemplate({
                        task: item.task,
                        type: item.type,
                        completed: item.completed,
                        completedAt: item.completedAt,
                        log: item.log,
                        day: item.key,
                      })
                    )
                    .join("")}
                </div>
              </section>`;
          })
          .join("")
      : `<div class="lane-empty">这一周还没有单独任务。可以安排一件需要几天持续推进的事。</div>`;

    const lanes = {
      baseline: { element: $("#baseline-task-list"), count: $("#baseline-lane-count"), items: [] },
      bonus: { element: $("#bonus-task-list"), count: $("#bonus-lane-count"), items: [] },
    };
    habits.forEach((habit) => {
      const taskType =
        habit.taskType === "weekly"
          ? Number.isInteger(habit.weekday)
            ? "baseline"
            : "bonus"
          : habit.taskType || "baseline";
      lanes[taskType].items.push({
        task: habit,
        day: key,
        type: "habit",
        completed: Boolean(day.habits?.[habit.id]),
        completedAt: day.habits?.[habit.id],
      });
    });
    extras.forEach((task) => {
      const taskType = task.taskType || "bonus";
      if (taskType === "weekly") return;
      lanes[taskType].items.push({
        task,
        day: key,
        type: "extra",
        completed: Boolean(task.completedAt),
        completedAt: task.completedAt,
      });
    });

    Object.values(lanes).forEach((lane) => {
      const completed = lane.items.filter((item) => item.completed).length;
      lane.count.textContent = `${completed} / ${lane.items.length}`;
      lane.element.innerHTML = lane.items.length
        ? lane.items
            .map((item) =>
              taskTemplate({
                ...item,
                day: key,
                log: day.logs?.[item.task.id],
              })
            )
            .join("")
        : `<div class="lane-empty">这里还很空，可以添加一件真正重要的事。</div>`;
    });

    $("#task-board-title").textContent = isToday ? "今天的任务" : `${formatMonthDay(activeDate)}的任务`;
    $("#task-board-count").textContent = `${stats.completed} / ${stats.planned} 项`;
    $("#quick-task-input").placeholder = isToday ? "快速写下今天要安排的一件事…" : `添加到 ${formatMonthDay(activeDate)}…`;

    const note = $("#daily-note");
    if (document.activeElement !== note) {
      note.value = day.note || "";
    }
    const noteLength = note.value.length;
    $("#note-count").textContent = `${noteLength} / 500`;
    const reflectionHeading = $(".reflection-heading h3");
    if (reflectionHeading) reflectionHeading.textContent = isToday ? "今天，想留下一点什么？" : "这一天，想提前留下什么？";
  }

  function renderReview() {
    const label = $("#period-label");
    const selected = parseKey(ui.selectedDate);

    if (ui.period === "day") {
      const isToday = ui.selectedDate === todayKey();
      label.textContent = isToday ? "今天" : `${selected.getFullYear()}年${formatMonthDay(selected)}`;
    } else if (ui.period === "month") {
      label.textContent = `${selected.getFullYear()}年 ${selected.getMonth() + 1}月`;
    } else {
      label.textContent = `${selected.getFullYear()}年`;
    }

    let summaryKeys = [];
    let chartItems = [];
    let activityKeys = [];

    if (ui.period === "day") {
      summaryKeys = [ui.selectedDate];
      activityKeys = [ui.selectedDate];
      const start = addDays(selected, -13);
      chartItems = getRangeKeys(start, selected).map((key) => ({
        key,
        label: key === todayKey() ? "今天" : `${parseKey(key).getMonth() + 1}/${parseKey(key).getDate()}`,
        value: getDayStats(key).completed,
      }));
      $("#trend-title").textContent = "近 14 天";
      $("#trend-subtitle").textContent = "每天完成了多少件事";
    } else if (ui.period === "month") {
      const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
      const monthEnd = new Date(selected.getFullYear(), selected.getMonth(), daysInMonth(monthStart));
      const allKeys = getRangeKeys(monthStart, monthEnd);
      summaryKeys = allKeys.filter((key) => key <= todayKey());
      activityKeys = [...summaryKeys].reverse();
      chartItems = allKeys.map((key) => ({
        key,
        label: `${parseKey(key).getDate()}日`,
        value: key <= todayKey() ? getDayStats(key).completed : 0,
      }));
      $("#trend-title").textContent = "本月每天";
      $("#trend-subtitle").textContent = "整月的完成节奏";
    } else {
      const year = selected.getFullYear();
      const monthItems = Array.from({ length: 12 }, (_, month) => {
        const start = new Date(year, month, 1);
        const end = new Date(year, month, daysInMonth(start));
        return {
          key: `${year}-${pad(month + 1)}-01`,
          label: `${month + 1}月`,
          keys: getRangeKeys(start, end),
        };
      });
      summaryKeys = monthItems.flatMap((item) => item.keys).filter((key) => key <= todayKey());
      activityKeys = [...summaryKeys].reverse();
      chartItems = monthItems.map((item) => ({
        key: item.key,
        label: item.label,
        value: aggregate(item.keys.filter((key) => key <= todayKey())).completed,
      }));
      $("#trend-title").textContent = "这一年的每个月";
      $("#trend-subtitle").textContent = "每月完成事项总数";
    }

    const stats = aggregate(summaryKeys);
    const rate = stats.planned ? Math.round((stats.completed / stats.planned) * 100) : 0;
    $("#metric-completed").textContent = stats.completed;
    $("#metric-rate").textContent = rate;
    $("#metric-active-days").textContent = stats.activeDays;
    $("#metric-streak").textContent = currentStreak();
    $("#metric-minutes").textContent = stats.minutes;
    $("#metric-quantity").textContent = stats.quantity;
    $("#metric-blockers").textContent = stats.blockers;

    if (ui.period === "day") {
      const dayStats = getDayStats(ui.selectedDate);
      $("#metric-completed-detail").textContent = dayStats.planned
        ? `固定事项 ${dayStats.completedHabits} 件 · 临时事项 ${dayStats.completedExtras} 件`
        : "这一天还没有安排";
      $("#metric-rate-detail").textContent = dayStats.planned
        ? `共安排 ${dayStats.planned} 件`
        : "还没有安排事项";
      $("#metric-active-detail").textContent = stats.activeDays ? "这一天有留下记录" : "这一天还没有完成";
    } else {
      $("#metric-completed-detail").textContent = `固定与临时事项合计`;
      $("#metric-rate-detail").textContent = stats.planned ? `共安排 ${stats.planned} 件` : "还没有安排事项";
      $("#metric-active-detail").textContent =
        summaryKeys.length > 0
          ? `共 ${summaryKeys.length} 天里有完成`
          : "持续积累中";
    }
    $("#metric-streak-detail").textContent =
      currentStreak() > 0 ? "保持住自己的节奏" : "今天完成一件就开始了";

    renderTrendChart(chartItems);
    renderCalendar();
    renderActivity(activityKeys);
    renderCategorySummary(summaryKeys);
  }

  function renderTrendChart(items) {
    const chart = $("#trend-chart");
    const max = Math.max(1, ...items.map((item) => item.value));
    chart.classList.toggle("is-dense", items.length > 16);
    chart.innerHTML = items
      .map((item) => {
        const height = item.value ? Math.max(5, (item.value / max) * 100) : 2;
        const isToday = item.key === todayKey() || (ui.period === "year" && item.key.startsWith(`${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`));
        return `
          <div class="chart-column ${item.value ? "" : "is-empty"} ${isToday ? "is-today" : ""}" title="${escapeHtml(item.label)}：完成 ${item.value} 件">
            <span class="chart-value">${item.value}</span>
            <i class="chart-bar" style="height: ${height}%; --bar-height: ${height}%"></i>
            <span class="chart-label">${escapeHtml(item.label)}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderCalendar() {
    const month = ui.calendarDate;
    $("#calendar-title").textContent =
      month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth()
        ? "本月足迹"
        : `${month.getFullYear()}年 ${month.getMonth() + 1}月`;

    const first = startOfMonth(month);
    const mondayOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
    const gridStart = addDays(first, -mondayOffset);
    const cells = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
    const max = Math.max(1, ...cells.map((date) => getDayStats(dateKey(date)).completed));

    $("#calendar-grid").innerHTML = cells
      .map((date) => {
        const key = dateKey(date);
        const stats = getDayStats(key);
        const isOutside = date.getMonth() !== month.getMonth();
        const level = stats.completed ? Math.min(4, Math.max(1, Math.ceil((stats.completed / max) * 4))) : 0;
        return `
          <button
            class="calendar-day ${isOutside ? "is-outside" : ""} ${level ? `level-${level}` : ""} ${key === todayKey() ? "is-today" : ""} ${key === ui.selectedDate ? "is-selected" : ""}"
            type="button"
            data-date="${key}"
            aria-label="${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日，完成${stats.completed}件"
            title="完成 ${stats.completed} 件"
          >${date.getDate()}</button>
        `;
      })
      .join("");
  }

  function completedEventsForKeys(keys) {
    const events = [];
    keys.forEach((key) => {
      const day = state.days[key];
      if (!day) return;
      const habits = habitsForDate(key);
      habits.forEach((habit) => {
        const completedAt = day.habits?.[habit.id];
        if (completedAt) {
          events.push({
            id: habit.id,
            title: habit.title,
            category: habit.category,
            emoji: habit.emoji,
            color: habit.color,
            completedAt,
            key,
            log: day.logs?.[habit.id] || null,
            taskType: habit.taskType || "baseline",
          });
        }
      });
      (day.extras || []).forEach((task) => {
        if (task.completedAt) {
          events.push({
            id: task.id,
            title: task.title,
            category: task.category,
            emoji: "＋",
            color: categoryColor(task.category),
            completedAt: task.completedAt,
            key,
            log: day.logs?.[task.id] || null,
            taskType: task.taskType || "bonus",
          });
        }
      });
    });
    return events.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  }

  function renderActivity(keys) {
    const events = completedEventsForKeys(keys);
    $("#activity-count").textContent = `${events.length} 项`;

    if (ui.period === "day") {
      $("#activity-title").textContent = ui.selectedDate === todayKey() ? "今天做了什么" : `${formatMonthDay(parseKey(ui.selectedDate))}做了什么`;
    } else if (ui.period === "month") {
      $("#activity-title").textContent = "这个月做了什么";
    } else {
      $("#activity-title").textContent = "这一年做了什么";
    }

    if (!events.length) {
      $("#activity-list").innerHTML = `
        <div class="activity-empty">
          <div>
            <div class="empty-state-icon">✦</div>
            还没有完成记录。<br />从今天的第一件小事开始。
          </div>
        </div>`;
      return;
    }

    const visible = events.slice(0, ui.period === "day" ? 20 : 12);
    $("#activity-list").innerHTML = visible
      .map((event) => {
        const showDate = ui.period !== "day";
        const date = new Date(event.completedAt);
        const detail = [
          Number(event.log?.actualMinutes) ? `${event.log.actualMinutes} 分钟` : "",
          Number(event.log?.quantity) ? `${event.log.quantity} 题` : "",
          event.log?.blocker ? "有卡点" : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return `
          <div class="activity-item">
            <span class="activity-icon" style="--task-color-soft: color-mix(in srgb, ${escapeHtml(event.color)} 14%, white)">${escapeHtml(event.emoji)}</span>
            <div class="activity-main">
              <strong>${escapeHtml(event.title)}</strong>
              <span>${escapeHtml(event.category)}${showDate ? ` · ${date.getMonth() + 1}月${date.getDate()}日` : ""}${detail ? ` · ${escapeHtml(detail)}` : ""}</span>
            </div>
            <span class="activity-time">${formatTime(event.completedAt)}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderCategorySummary(keys) {
    const counts = {};
    completedEventsForKeys(keys).forEach((event) => {
      counts[event.category] = (counts[event.category] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(([, count]) => count));
    const container = $("#category-summary");

    if (!entries.length) {
      container.innerHTML = `
        <div class="activity-empty" style="min-height: 165px">
          <div>
            <div class="empty-state-icon">◌</div>
            完成一些事情后，<br />这里会出现你的投入分布。
          </div>
        </div>`;
      return;
    }

    container.innerHTML = entries
      .map(([category, count]) => {
        const color = categoryColor(category);
        return `
          <div class="category-row" style="--category-color: ${color}">
            <span class="category-name"><i></i>${escapeHtml(category)}</span>
            <span class="category-number">${count} 件</span>
            <span class="category-track"><i class="category-fill" style="width: ${(count / max) * 100}%"></i></span>
          </div>
        `;
      })
      .join("");
  }

  function renderHabits() {
    const activeHabits = state.habits.filter((habit) => !habit.archivedAt);
    $("#habit-count-large").textContent = activeHabits.length;
    const container = $("#habit-cards");
    if (!activeHabits.length) {
      container.innerHTML = `
        <div class="empty-state" style="margin-top: 0">
          <div>
            <span class="empty-state-icon">＋</span>
            <strong>还没有固定事项</strong>
            <p>点击右上角“新增固定事项”，建立每天的节奏。</p>
          </div>
        </div>`;
      return;
    }

    container.innerHTML = activeHabits
      .map(
        (habit) => `
          <article class="habit-card" style="--habit-color: ${escapeHtml(habit.color)}">
            <span class="habit-card-icon" aria-hidden="true">${escapeHtml(habit.emoji)}</span>
            <div class="habit-card-main">
              <h3>${escapeHtml(habit.title)}</h3>
              <p>${taskTypeLabel(habit.taskType)} · ${
                Number.isInteger(habit.weekday) ? `每周${SHORT_WEEKDAYS[habit.weekday]}` : "每天自动出现"
              } · 从 ${escapeHtml(habit.createdAt.replaceAll("-", "."))} 开始</p>
            </div>
            <span class="habit-category-tag">${escapeHtml(habit.category)}</span>
            <div class="habit-actions">
              <button class="habit-action" type="button" data-action="edit-habit" data-id="${escapeHtml(habit.id)}" aria-label="编辑">
                <svg viewBox="0 0 24 24"><path d="m14.5 5.5 4 4M4 20l4.5-1 10-10a2.8 2.8 0 0 0-4-4l-10 10L4 20Z"/></svg>
              </button>
              <button class="habit-action danger" type="button" data-action="delete-habit" data-id="${escapeHtml(habit.id)}" aria-label="停用">
                <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
              </button>
            </div>
          </article>
        `
      )
      .join("");
  }

  function setView(view, options = {}) {
    if (!["today", "review", "habits"].includes(view)) return;
    ui.view = view;
    $$(".view").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === view));
    $$("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
    if (view === "review") renderReview();
    if (view === "habits") renderHabits();
    if (!options.keepScroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleTask(type, id, key = ui.activePlanDate) {
    const day = ensureDay(key);
    if (type === "habit") {
      day.habits[id] = day.habits[id] ? null : new Date().toISOString();
    } else {
      const task = day.extras.find((item) => item.id === id);
      if (!task) return;
      task.completedAt = task.completedAt ? null : new Date().toISOString();
    }
    persist();
    renderAll();
  }

  function addExtraTask(
    title,
    category = "其他",
    taskType = "bonus",
    key = ui.activePlanDate,
    startTime = "",
    endTime = ""
  ) {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const day = ensureDay(key);
    day.extras.push({
      id: uid("extra"),
      title: cleanTitle.slice(0, 80),
      category: CATEGORY_COLORS[category] ? category : "其他",
      taskType: ["baseline", "bonus", "weekly"].includes(taskType) ? taskType : "bonus",
      startTime,
      endTime,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    persist();
    renderAll();
    showToast(key === todayKey() ? "已加入今天" : `已加入 ${formatMonthDay(parseKey(key))}`);
  }

  function deleteExtraTask(id, key = ui.activePlanDate) {
    const day = ensureDay(key);
    const index = day.extras.findIndex((task) => task.id === id);
    if (index === -1) return;
    const deleted = day.extras[index];
    day.extras = day.extras.filter((task) => task.id !== id);
    persist();
    renderAll();
    lastDeletedExtra = { task: deleted, index, date: key };
    showToast("已删除临时事项", "撤销", () => {
      if (!lastDeletedExtra) return;
      const targetDay = ensureDay(lastDeletedExtra.date);
      if (!targetDay.extras.some((task) => task.id === lastDeletedExtra.task.id)) {
        targetDay.extras.splice(Math.min(lastDeletedExtra.index, targetDay.extras.length), 0, lastDeletedExtra.task);
      }
      persist();
      renderAll();
      lastDeletedExtra = null;
      showToast("已恢复");
    });
  }

  function openHabitModal(id = null) {
    ui.editingHabitId = id;
    const habit = id ? state.habits.find((item) => item.id === id) : null;
    ui.selectedEmoji = habit?.emoji || EMOJIS[0];
    ui.selectedColor = habit?.color || COLORS[0];
    $("#habit-modal-eyebrow").textContent = habit ? "调整节奏" : "新的开始";
    $("#habit-modal-title").textContent = habit ? "编辑固定事项" : "新增固定事项";
    $("#habit-id").value = habit?.id || "";
    $("#habit-title").value = habit?.title || "";
    $("#habit-category").value = habit?.category || "成长";
    $("#habit-task-type").value = habit?.taskType || "baseline";
    $("#habit-start-time").value = habit?.startTime || "";
    $("#habit-end-time").value = habit?.endTime || "";
    renderEmojiPicker();
    renderColorPicker();
    const dialog = $("#habit-modal");
    dialog.showModal();
    window.setTimeout(() => $("#habit-title").focus(), 50);
  }

  function renderEmojiPicker() {
    $("#emoji-picker").innerHTML = EMOJIS.map(
      (emoji) => `
        <button class="emoji-choice ${ui.selectedEmoji === emoji ? "is-selected" : ""}" type="button" role="radio" aria-checked="${ui.selectedEmoji === emoji}" data-emoji="${emoji}">
          ${emoji}
        </button>
      `
    ).join("");
  }

  function renderColorPicker() {
    $("#color-picker").innerHTML = COLORS.map(
      (color) => `
        <button class="color-choice ${ui.selectedColor === color ? "is-selected" : ""}" style="--choice-color: ${color}" type="button" role="radio" aria-checked="${ui.selectedColor === color}" data-color="${color}" aria-label="颜色 ${color}">
          <i></i>
        </button>
      `
    ).join("");
  }

  function saveHabit() {
    const title = $("#habit-title").value.trim();
    if (!title) {
      $("#habit-title").focus();
      return;
    }
    const category = $("#habit-category").value;
    const taskType = $("#habit-task-type").value;
    const startTime = $("#habit-start-time").value;
    const endTime = $("#habit-end-time").value;
    const existing = ui.editingHabitId
      ? state.habits.find((habit) => habit.id === ui.editingHabitId)
      : null;
    if (existing) {
      existing.title = title.slice(0, 30);
      existing.category = category;
      existing.emoji = ui.selectedEmoji;
      existing.color = ui.selectedColor;
      existing.taskType = taskType;
      existing.startTime = startTime;
      existing.endTime = endTime;
      showToast("固定事项已更新");
    } else {
      state.habits.push({
        id: uid("habit"),
        title: title.slice(0, 30),
        category,
        emoji: ui.selectedEmoji,
        color: ui.selectedColor,
        taskType,
        startTime,
        endTime,
        createdAt: todayKey(),
        archivedAt: null,
      });
      showToast("固定事项已添加");
    }
    persist();
    renderAll();
  }

  function archiveHabit(id) {
    const habit = state.habits.find((item) => item.id === id);
    if (!habit) return;
    openConfirm(
      "停用这个固定事项？",
      "它会从今天的清单中移除，但过去已经完成的记录会继续保留。",
      "确认停用",
      () => {
        habit.archivedAt = todayKey();
        persist();
        renderAll();
        showToast("已停用固定事项");
      }
    );
  }

  function openQuickModal(presetType = null, key = ui.activePlanDate) {
    ui.quickTaskType = ["baseline", "bonus", "weekly"].includes(presetType)
      ? presetType
      : $("#quick-task-type-inline").value || "bonus";
    ui.quickTaskDate = key;
    $("#quick-modal-input").value = "";
    $("#quick-modal-category").value = "其他";
    $("#quick-modal-type").value = ui.quickTaskType;
    $("#quick-modal-date").value = key;
    $("#quick-modal-start-time").value = "";
    $("#quick-modal-end-time").value = "";
    $(".quick-modal .eyebrow").textContent =
      key === todayKey() ? "安排今天" : `安排 ${formatMonthDay(parseKey(key))}`;
    const dialog = $("#quick-modal");
    dialog.showModal();
    window.setTimeout(() => $("#quick-modal-input").focus(), 50);
  }

  function taskTypeLabel(taskType) {
    return { baseline: "底线", bonus: "加分", weekly: "周任务" }[taskType] || "底线";
  }

  function splitDelimitedRow(line) {
    const delimiter = line.includes("\t") ? "\t" : ",";
    const cells = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === delimiter && !quoted) {
        cells.push(value.trim());
        value = "";
      } else {
        value += character;
      }
    }
    cells.push(value.trim());
    return cells;
  }

  function normalizeImportTime(value) {
    const match = String(value || "")
      .trim()
      .match(/^(\d{1,2})(?:[:：点](\d{1,2}))?/);
    if (!match) return "";
    const hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    if (hours > 23 || minutes > 59) return "";
    return `${pad(hours)}:${pad(minutes)}`;
  }

  function resolveImportDate(dateValue = "", weekdayValue = "") {
    const dateText = String(dateValue).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      return dateText;
    }
    const monthDay = dateText.match(/^(\d{1,2})[月/.\-](\d{1,2})日?$/);
    if (monthDay) {
      return dateKey(new Date(new Date().getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2])));
    }
    const normalized = String(weekdayValue || dateText)
      .trim()
      .toLowerCase()
      .replace(/^星期/, "")
      .replace(/^周/, "");
    const weekdayMap = {
      一: 0,
      二: 1,
      三: 2,
      四: 3,
      五: 4,
      六: 5,
      日: 6,
      天: 6,
      mon: 0,
      monday: 0,
      tue: 1,
      tues: 1,
      tuesday: 1,
      wed: 2,
      wednesday: 2,
      thu: 3,
      thur: 3,
      thursday: 3,
      fri: 4,
      friday: 4,
      sat: 5,
      saturday: 5,
      sun: 6,
      sunday: 6,
      1: 0,
      2: 1,
      3: 2,
      4: 3,
      5: 4,
      6: 5,
      7: 6,
    };
    const target = weekdayMap[normalized];
    return target === undefined ? "" : dateKey(addDays(startOfWeekMonday(new Date()), target));
  }

  function timetableRowsFromText(text) {
    const lines = String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return [];

    const headerMap = {};
    const firstCells = splitDelimitedRow(lines[0]).map((cell) => cell.toLowerCase().replace(/\s+/g, ""));
    const aliases = {
      date: ["日期", "date", "day"],
      weekday: ["周几", "星期", "星期几", "weekday", "dayofweek"],
      start: ["开始", "开始时间", "start", "starttime"],
      end: ["结束", "结束时间", "end", "endtime"],
      title: ["事项", "任务", "课程", "课程名", "task", "title", "subject"],
      category: ["分类", "类别", "category", "type"],
    };
    Object.entries(aliases).forEach(([field, words]) => {
      const index = firstCells.findIndex((cell) => words.some((word) => cell === word || cell.includes(word)));
      if (index !== -1) headerMap[field] = index;
    });
    const hasHeader =
      headerMap.title !== undefined &&
      (headerMap.date !== undefined || headerMap.weekday !== undefined) &&
      (headerMap.start !== undefined || headerMap.date !== undefined || headerMap.weekday !== undefined);
    const contentLines = hasHeader ? lines.slice(1) : lines;
    const rows = [];

    contentLines.forEach((line) => {
      const cells = splitDelimitedRow(line);
      let date = "";
      let startTime = "";
      let endTime = "";
      let title = "";
      let category = "学习";

      if (hasHeader) {
        date = resolveImportDate(
          headerMap.date !== undefined ? cells[headerMap.date] : "",
          headerMap.weekday !== undefined ? cells[headerMap.weekday] : ""
        );
        startTime = normalizeImportTime(headerMap.start !== undefined ? cells[headerMap.start] : "");
        endTime = normalizeImportTime(headerMap.end !== undefined ? cells[headerMap.end] : "");
        title = headerMap.title !== undefined ? String(cells[headerMap.title] || "").trim() : "";
        category = headerMap.category !== undefined ? String(cells[headerMap.category] || "").trim() : "学习";
      } else {
        const directMatch = line.match(
          /^(周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[月/.\-]\d{1,2}日?|\d{4}-\d{2}-\d{2})\s+(\d{1,2}[:：点]\d{1,2})\s*[-–—~至]\s*(\d{1,2}[:：点]\d{1,2})\s+(.+)$/
        );
        if (directMatch) {
          date = resolveImportDate(directMatch[1]);
          startTime = normalizeImportTime(directMatch[2]);
          endTime = normalizeImportTime(directMatch[3]);
          title = directMatch[4].trim();
        } else if (cells.length >= 4) {
          date = resolveImportDate(cells[0], cells[0]);
          startTime = normalizeImportTime(cells[1]);
          endTime = normalizeImportTime(cells[2]);
          title = String(cells[3] || "").trim();
          category = String(cells[4] || "学习").trim();
        }
      }

      if (!date || !startTime || !title) return;
      rows.push({
        date,
        title: title.slice(0, 80),
        startTime,
        endTime,
        category: CATEGORY_COLORS[category] ? category : "学习",
      });
    });
    return rows;
  }

  function openWeekOverview() {
    const dialog = $("#week-overview-modal");
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => {
      const wrap = $(".weekly-timetable-wrap");
      const today = $("#week-timetable .timetable-day.is-today");
      if (!wrap || !today) return;
      const nextLeft = today.offsetLeft + today.offsetWidth / 2 - wrap.clientWidth / 2;
      wrap.scrollTo({ left: Math.max(0, nextLeft), behavior: "smooth" });
    }, 120);
  }

  function commitTimetableRows(rows, sourceLabel = "课表") {
    let added = 0;
    let skipped = 0;
    const createdHabitIds = [];
    rows.forEach((row) => {
      const weekday = parseKey(row.date).getDay();
      const duplicate = state.habits.some(
        (habit) =>
          habit.taskType === "weekly" &&
          habit.weekday === weekday &&
          habit.title === row.title.slice(0, 30) &&
          habit.startTime === row.startTime &&
          (habit.endTime || "") === (row.endTime || "")
      );
      if (duplicate) {
        skipped += 1;
        return;
      }
      const habit = {
        id: uid("class"),
        title: row.title.slice(0, 30),
        category: row.category,
        taskType: "weekly",
        weekday,
        startTime: row.startTime,
        endTime: row.endTime,
        emoji: "📚",
        color: categoryColor(row.category),
        createdAt: dateKey(startOfWeekMonday(new Date())),
        archivedAt: null,
      };
      state.habits.push(habit);
      createdHabitIds.push(habit.id);
      added += 1;
    });

    if (!added) {
      showToast(skipped ? `这 ${skipped} 项已经导入过了` : "没有识别到课表，请检查格式");
      return;
    }

    persist();
    renderAll();
    const importDialog = $("#schedule-import-modal");
    if (importDialog.open) importDialog.close();
    window.setTimeout(openWeekOverview, 80);
    showToast(
      `${sourceLabel}已生成 ${added} 项${skipped ? `，跳过 ${skipped} 项重复内容` : ""}`,
      "撤销",
      () => {
        state.habits = state.habits.filter((habit) => !createdHabitIds.includes(habit.id));
        persist();
        renderAll();
        showToast("已撤销这次导入");
      },
      6500
    );
  }

  function importTimetable(text) {
    const rows = timetableRowsFromText(text);
    commitTimetableRows(rows);
  }

  function normalizeOcrWord(value) {
    return String(value || "")
      .replace(/[|｜丨]/g, " ")
      .replace(/\s+/g, "")
      .trim();
  }

  function collectOcrLines(data) {
    const lines = [];
    const seen = new Set();

    const tsvLines = (() => {
      if (!data?.tsv) return [];
      const grouped = new Map();
      String(data.tsv)
        .split(/\r?\n/)
        .slice(1)
        .forEach((row) => {
          const cells = row.split("\t");
          if (cells.length < 12 || Number(cells[0]) !== 5) return;
          const text = normalizeOcrWord(cells.slice(11).join("\t"));
          if (!text) return;
          const key = `${cells[1]}:${cells[2]}:${cells[3]}:${cells[4]}`;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push({
            text,
            wordNumber: Number(cells[5]) || 0,
            bbox: {
              x0: Number(cells[6]) || 0,
              y0: Number(cells[7]) || 0,
              x1: (Number(cells[6]) || 0) + (Number(cells[8]) || 0),
              y1: (Number(cells[7]) || 0) + (Number(cells[9]) || 0),
            },
          });
        });
      return [...grouped.values()]
        .map((words) => {
          words.sort((a, b) => a.wordNumber - b.wordNumber || a.bbox.x0 - b.bbox.x0);
          const bbox = words.reduce(
            (total, word) => ({
              x0: Math.min(total.x0, word.bbox.x0),
              y0: Math.min(total.y0, word.bbox.y0),
              x1: Math.max(total.x1, word.bbox.x1),
              y1: Math.max(total.y1, word.bbox.y1),
            }),
            { ...words[0].bbox }
          );
          return {
            words,
            bbox,
            text: words.map((word) => word.text).join(" "),
            x: (bbox.x0 + bbox.x1) / 2,
            y: (bbox.y0 + bbox.y1) / 2,
            height: Math.max(1, bbox.y1 - bbox.y0),
          };
        })
        .sort((a, b) => a.y - b.y || a.x - b.x);
    })();
    if (tsvLines.length) return tsvLines;

    const addLine = (line) => {
      const words = (line?.words || [])
        .map((word) => {
          const text = normalizeOcrWord(word.text);
          const bbox = word.bbox || {};
          if (!text || !Number.isFinite(bbox.x0) || !Number.isFinite(bbox.y0)) return null;
          return {
            text,
            bbox: {
              x0: Number(bbox.x0),
              y0: Number(bbox.y0),
              x1: Number(bbox.x1),
              y1: Number(bbox.y1),
            },
          };
        })
        .filter(Boolean);
      if (!words.length) return;
      const bbox = words.reduce(
        (total, word) => ({
          x0: Math.min(total.x0, word.bbox.x0),
          y0: Math.min(total.y0, word.bbox.y0),
          x1: Math.max(total.x1, word.bbox.x1),
          y1: Math.max(total.y1, word.bbox.y1),
        }),
        { ...words[0].bbox }
      );
      const signature = `${Math.round(bbox.x0)}:${Math.round(bbox.y0)}:${words.map((word) => word.text).join("")}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      lines.push({
        words,
        bbox,
        text: words.map((word) => word.text).join(" "),
        x: (bbox.x0 + bbox.x1) / 2,
        y: (bbox.y0 + bbox.y1) / 2,
        height: Math.max(1, bbox.y1 - bbox.y0),
      });
    };

    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.lines)) node.lines.forEach(addLine);
      if (Array.isArray(node.paragraphs)) node.paragraphs.forEach(walk);
      if (Array.isArray(node.blocks)) node.blocks.forEach(walk);
    };

    walk(data);
    if (!lines.length && Array.isArray(data?.lines)) data.lines.forEach(addLine);
    return lines.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function weekdayIndexFromOcrText(value) {
    const text = normalizeOcrWord(value).toLowerCase();
    if (!text || text.length > 12) return -1;
    const chinese = text.match(/(?:星期|周|礼拜)([一二三四五六日天1-7])/);
    if (chinese) {
      const labels = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 };
      return labels[chinese[1]] ?? -1;
    }
    const english = text.match(/^(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/);
    if (!english) return -1;
    return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].findIndex((day) => english[1].startsWith(day));
  }

  function weekdayCandidatesFromOcrLine(line) {
    const candidates = [];
    line.words.forEach((word) => {
      const day = weekdayIndexFromOcrText(word.text);
      if (day === -1) return;
      candidates.push({
        day,
        x: (word.bbox.x0 + word.bbox.x1) / 2,
        y: (word.bbox.y0 + word.bbox.y1) / 2,
      });
    });
    if (!candidates.length) {
      for (let start = 0; start < line.words.length; start += 1) {
        let combined = "";
        for (let end = start; end < Math.min(line.words.length, start + 4); end += 1) {
          combined += normalizeOcrWord(line.words[end].text);
          const day = weekdayIndexFromOcrText(combined);
          if (day !== -1) {
            const words = line.words.slice(start, end + 1);
            const bbox = words.reduce(
              (total, word) => ({
                x0: Math.min(total.x0, word.bbox.x0),
                y0: Math.min(total.y0, word.bbox.y0),
                x1: Math.max(total.x1, word.bbox.x1),
                y1: Math.max(total.y1, word.bbox.y1),
              }),
              { ...words[0].bbox }
            );
            candidates.push({ day, x: (bbox.x0 + bbox.x1) / 2, y: line.y });
            start = end;
            break;
          }
          if (combined.length >= 4) break;
        }
      }
    }
    if (candidates.length) return candidates;

    const compactLine = normalizeOcrWord(line.text);
    const matches = [...compactLine.matchAll(/(?:星期|周|礼拜)([一二三四五六日天1-7])/g)];
    if (matches.length < 2) return candidates;
    matches.forEach((match, index) => {
      const labels = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 };
      const x0 = line.bbox.x0 + ((line.bbox.x1 - line.bbox.x0) * index) / matches.length;
      const x1 = line.bbox.x0 + ((line.bbox.x1 - line.bbox.x0) * (index + 1)) / matches.length;
      candidates.push({ day: labels[match[1]], x: (x0 + x1) / 2, y: line.y });
    });
    return candidates;
  }

  function findOcrDayColumns(lines, width, height) {
    const candidates = lines
      .filter((line) => line.y < height * 0.45)
      .flatMap(weekdayCandidatesFromOcrLine);
    if (candidates.length < 3) return [];

    const clusters = [];
    candidates.forEach((candidate) => {
      const cluster = clusters.find((item) => Math.abs(item.y - candidate.y) < height * 0.025);
      if (cluster) {
        cluster.items.push(candidate);
        cluster.y = (cluster.y * (cluster.items.length - 1) + candidate.y) / cluster.items.length;
      } else {
        clusters.push({ y: candidate.y, items: [candidate] });
      }
    });
    clusters.sort((a, b) => b.items.length - a.items.length || a.y - b.y);

    for (const cluster of clusters) {
      const byDay = new Map();
      cluster.items.forEach((candidate) => {
        const previous = byDay.get(candidate.day);
        if (!previous || Math.abs(previous.x - candidate.x) > width * 0.025) {
          byDay.set(candidate.day, candidate);
        }
      });
      if (byDay.size < 3) continue;
      const columns = [...byDay.values()].sort((a, b) => a.x - b.x);
      if (columns[columns.length - 1].x - columns[0].x < width * 0.25) continue;
      return columns;
    }
    return [];
  }

  function ocrTimesFromText(value) {
    const text = String(value || "")
      .replace(/[Oo]/g, "0")
      .replace(/[：．]/g, ":")
      .replace(/[–—~～]/g, "-");
    const times = [];
    for (const match of text.matchAll(/(?:^|[^\d])([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?!\d)/g)) {
      const hour = Number(match[1]);
      if (hour < 5) continue;
      const value = `${pad(hour)}:${match[2]}`;
      if (!times.includes(value)) times.push(value);
    }
    return times;
  }

  function findOcrTimeRows(lines, dayColumns, width, height) {
    const firstDayX = dayColumns[0].x;
    const gutterLimit = firstDayX - Math.max(12, width * 0.015);
    const rows = [];
    lines.forEach((line) => {
      const gutterWords = line.words.filter(
        (word) => (word.bbox.x0 + word.bbox.x1) / 2 < gutterLimit
      );
      if (!gutterWords.length) return;
      const times = ocrTimesFromText(gutterWords.map((word) => word.text).join(""));
      if (!times.length) return;
      const row = {
        y: line.y,
        start: times[0],
        end: times[1] || "",
      };
      const duplicate = rows.some(
        (item) =>
          (Math.abs(item.y - row.y) < height * 0.018 && item.start === row.start) ||
          (item.start === row.start && item.end === row.end && Math.abs(item.y - row.y) < height * 0.04)
      );
      if (!duplicate) rows.push(row);
    });
    const sorted = rows.sort((a, b) => a.y - b.y);
    if (sorted.length < 2) return sorted;
    const gaps = sorted
      .slice(1)
      .map((row, index) => row.y - sorted[index].y)
      .filter((gap) => gap > 0)
      .sort((a, b) => a - b);
    const medianGap = gaps[Math.floor(gaps.length / 2)] || height * 0.05;
    const groupGap = Math.max(height * 0.02, medianGap * 0.58);
    const grouped = [];
    sorted.forEach((row) => {
      const previous = grouped[grouped.length - 1];
      if (previous && !previous.end && !row.end && row.y - previous.lastY < groupGap) {
        previous.end = row.start;
        previous.lastY = row.y;
        previous.y = (previous.y + row.y) / 2;
        return;
      }
      grouped.push({ ...row, lastY: row.y });
    });
    return grouped.map(({ lastY, ...row }) => row);
  }

  function inferScheduleCategory(title) {
    if (/(体育|跑步|健身|游泳|瑜伽|锻炼)/.test(title)) return "健康";
    if (/(会议|项目|工作|实习|值班)/.test(title)) return "工作";
    if (/(英语|数学|语文|物理|化学|生物|历史|地理|政治|课|讲座|实验|学习|阅读)/.test(title)) return "学习";
    return "学习";
  }

  function cleanOcrCourseTitle(value) {
    return String(value || "")
      .replace(/[|｜丨]/g, " ")
      .replace(/(?:星期|周|礼拜)[一二三四五六日天1-7]/g, " ")
      .replace(/\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/gi, " ")
      .replace(/(?:[01]?\d|2[0-3])\s*[:：]\s*[0-5]\d/g, " ")
      .replace(/(?:课程|科目|任务)[:：]/g, " ")
      .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/^[\-—,:：;；\s]+|[\-—,:：;；\s]+$/g, "")
      .trim();
  }

  function timetableRowsFromOcr(data, width, height) {
    const lines = collectOcrLines(data);
    const dayColumns = findOcrDayColumns(lines, width, height);
    if (dayColumns.length < 3) return { rows: [], reason: "没有定位到星期表头" };
    const timeRows = findOcrTimeRows(lines, dayColumns, width, height);
    if (timeRows.length < 2) return { rows: [], reason: "没有定位到左侧时间" };

    const headerBottom = Math.min(...dayColumns.map((column) => column.y)) + height * 0.04;
    const columnBounds = dayColumns.map((column, index) => {
      const previous = dayColumns[index - 1];
      const next = dayColumns[index + 1];
      return {
        ...column,
        left: previous ? (previous.x + column.x) / 2 : column.x - (next.x - column.x) / 2,
        right: next ? (column.x + next.x) / 2 : column.x + (column.x - previous.x) / 2,
      };
    });
    const rowBounds = timeRows.map((row, index) => {
      const previous = timeRows[index - 1];
      const next = timeRows[index + 1];
      return {
        ...row,
        top: previous ? (previous.y + row.y) / 2 : headerBottom,
        bottom: next ? (row.y + next.y) / 2 : height,
      };
    });
    const buckets = new Map();

    lines
      .filter((line) => line.y > headerBottom)
      .forEach((line) => {
        const rowIndex = rowBounds.findIndex((row) => line.y >= row.top && line.y < row.bottom);
        if (rowIndex === -1) return;
        columnBounds.forEach((column, columnIndex) => {
          const words = line.words.filter((word) => {
            const x = (word.bbox.x0 + word.bbox.x1) / 2;
            return x >= column.left && x < column.right;
          });
          if (!words.length) return;
          const key = `${columnIndex}:${rowIndex}`;
          if (!buckets.has(key)) buckets.set(key, { columnIndex, rowIndex, lines: [] });
          buckets.get(key).lines.push({
            text: words.map((word) => word.text).join(" "),
            y: line.y,
            height: line.height,
          });
        });
      });

    const rows = [];
    buckets.forEach((bucket) => {
      const tasks = [];
      let current = [];
      let previousLine = null;
      bucket.lines
        .sort((a, b) => a.y - b.y)
        .forEach((line) => {
          if (previousLine && line.y - previousLine.y > Math.max(previousLine.height, line.height) * 2.1) {
            if (current.length) tasks.push(current.join(" "));
            current = [];
          }
          current.push(line.text);
          previousLine = line;
        });
      if (current.length) tasks.push(current.join(" "));

      tasks.forEach((rawTitle) => {
        const title = cleanOcrCourseTitle(rawTitle).slice(0, 80);
        if (!title || title.length < 2 || /^[\d\s\-—]+$/.test(title) || /^(时间|课程表|课表|节次)$/.test(title)) return;
        const column = dayColumns[bucket.columnIndex];
        const time = timeRows[bucket.rowIndex];
        const inlineTimes = ocrTimesFromText(rawTitle);
        const startTime = inlineTimes[0] || time.start;
        const endTime = inlineTimes[1] || time.end;
        rows.push({
          date: resolveImportDate("", SHORT_WEEKDAYS[column.day === 6 ? 0 : column.day + 1]),
          title,
          startTime,
          endTime,
          category: inferScheduleCategory(title),
        });
      });
    });

    return { rows, reason: rows.length ? "" : "没有从时间格中读到课程名称" };
  }

  function timetableRowsToImportText(rows) {
    return rows
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .map((row) => {
        const weekday = new Date(`${row.date}T00:00:00`).getDay();
        return `${WEEKDAYS[weekday]},${row.startTime},${row.endTime},${row.title},${row.category}`;
      })
      .join("\n");
  }

  function setOcrProgress(progress, status, state = "") {
    const safeProgress = clamp(Number(progress) || 0, 0, 1);
    $("#ocr-progress-bar").style.width = `${Math.round(safeProgress * 100)}%`;
    $("#ocr-status").textContent = status;
    $("#ocr-status").dataset.state = state;
  }

  function updateTimetableImportButton() {
    const button = $("#confirm-schedule-import");
    const count = timetableRowsFromText($("#schedule-import-text").value).length;
    button.disabled = false;
    button.textContent = count ? `生成周课表（${count} 项）` : "导入课表";
  }

  async function getOcrWorker() {
    if (ocrWorker) return ocrWorker;
    if (!window.Tesseract?.createWorker) {
      throw new Error("识别组件没有加载，请刷新页面后再试");
    }
    const assetUrl = (path) => new URL(path, window.location.href).href;
    ocrWorker = await window.Tesseract.createWorker("chi_sim+eng", 1, {
      workerPath: assetUrl("./assets/ocr/worker.min.js"),
      langPath: assetUrl("./assets/ocr/"),
      corePath: assetUrl("./assets/ocr/tesseract-core-simd-lstm.wasm.js"),
      logger: (message) => {
        const statusMap = {
          "loading tesseract core": "正在加载本地识别引擎",
          "initializing tesseract": "正在初始化识别引擎",
          "loading language traineddata": "正在加载中英文识别模型",
          "initializing api": "正在准备识别",
          "recognizing text": "正在读取课表中的文字",
        };
        const label = statusMap[message.status] || message.status || "正在识别";
        const progress = Number(message.progress);
        setOcrProgress(Number.isFinite(progress) ? 0.12 + progress * 0.82 : 0.2, label);
      },
    });
    await ocrWorker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
    });
    return ocrWorker;
  }

  async function prepareTimetableImage(file) {
    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    ocrPreviewUrl = URL.createObjectURL(file);
    $("#ocr-image-preview").src = ocrPreviewUrl;
    $("#ocr-preview").hidden = false;

    const image = new Image();
    image.src = ocrPreviewUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("这张图片无法读取，请换一张 JPG、PNG 或屏幕截图"));
    });

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) throw new Error("图片尺寸无效，请换一张图片");
    const largestSide = Math.max(sourceWidth, sourceHeight);
    const scale =
      largestSide > 2600
        ? 2600 / largestSide
        : largestSide < 1200
          ? Math.min(2, 1200 / largestSide)
          : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function releaseOcrPreview() {
    ocrRunToken += 1;
    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    ocrPreviewUrl = null;
    $("#ocr-preview").hidden = true;
    $("#ocr-image-preview").removeAttribute("src");
    $("#schedule-image-file").disabled = false;
    setOcrProgress(0, "准备识别");
    updateTimetableImportButton();
  }

  async function recognizeTimetableImage(file) {
    const runToken = ++ocrRunToken;
    const imageInput = $("#schedule-image-file");
    const textarea = $("#schedule-import-text");
    imageInput.disabled = true;
    textarea.value = "";
    $("#confirm-schedule-import").disabled = true;
    setOcrProgress(0.03, "正在优化图片清晰度");

    let worker = null;
    try {
      const canvas = await prepareTimetableImage(file);
      setOcrProgress(0.08, "图片已就绪，正在加载识别模型");
      worker = await getOcrWorker();
      const result = await worker.recognize(canvas, {}, { blocks: true, text: true, tsv: true });
      if (runToken !== ocrRunToken) return;

      const gridResult = timetableRowsFromOcr(result.data, canvas.width, canvas.height);
      const fallbackRows = gridResult.rows.length
        ? gridResult.rows
        : timetableRowsFromText(result.data?.text || "");
      if (fallbackRows.length) {
        textarea.value = timetableRowsToImportText(fallbackRows);
        updateTimetableImportButton();
        setOcrProgress(1, `识别完成，找到 ${fallbackRows.length} 项安排`, "success");
      } else {
        textarea.value = String(result.data?.text || "").trim();
        updateTimetableImportButton();
        setOcrProgress(
          1,
          `${gridResult.reason || "没有读到完整课表"}。请检查下面文字，或换一张更清晰、完整的截图`,
          "warning"
        );
      }
      textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      if (runToken === ocrRunToken) {
        console.error("Timetable OCR failed:", error);
        setOcrProgress(1, error?.message || "识别失败，请换一张清晰图片", "error");
        updateTimetableImportButton();
      }
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch {
          // The next import can create a fresh worker.
        }
        if (ocrWorker === worker) ocrWorker = null;
      }
      if (runToken === ocrRunToken) imageInput.disabled = false;
    }
  }

  function findTask(type, id, key = ui.activePlanDate) {
    if (type === "habit") return state.habits.find((habit) => habit.id === id) || null;
    const day = state.days[key];
    return day?.extras?.find((task) => task.id === id) || null;
  }

  function openTaskLogModal(type, id, key = ui.activePlanDate) {
    const task = findTask(type, id, key);
    if (!task) return;
    const log = state.days[key]?.logs?.[id] || {};
    $("#task-log-day").value = key;
    $("#task-log-type").value = type;
    $("#task-log-id").value = id;
    $("#task-log-title").textContent = task.title;
    $("#task-log-start").value = task.startTime || "";
    $("#task-log-end").value = task.endTime || "";
    $("#task-log-minutes").value = log.actualMinutes || "";
    $("#task-log-quantity").value = log.quantity || "";
    $("#task-log-blocker").value = log.blocker || "";
    $("#task-log-modal").showModal();
    window.setTimeout(() => $("#task-log-minutes").focus(), 50);
  }

  function saveTaskLog() {
    const key = $("#task-log-day").value;
    const id = $("#task-log-id").value;
    if (!key || !id) return;
    const day = ensureDay(key);
    const task = findTask($("#task-log-type").value, id, key);
    if (task) {
      task.startTime = $("#task-log-start").value;
      task.endTime = $("#task-log-end").value;
    }
    const log = {
      actualMinutes: Math.max(0, Number($("#task-log-minutes").value) || 0),
      quantity: Math.max(0, Number($("#task-log-quantity").value) || 0),
      blocker: $("#task-log-blocker").value.trim().slice(0, 300),
      updatedAt: new Date().toISOString(),
    };
    if (!log.actualMinutes && !log.quantity && !log.blocker) delete day.logs[id];
    else day.logs[id] = log;
    persist();
    renderAll();
    showToast("任务详情已保存");
  }

  function openConfirm(title, copy, okLabel, action) {
    $("#confirm-title").textContent = title;
    $("#confirm-copy").textContent = copy;
    $("#confirm-ok").textContent = okLabel || "确认";
    pendingConfirmAction = action;
    $("#confirm-modal").showModal();
  }

  function showToast(message, actionLabel = "", action = null, duration = 1900) {
    $("#toast-message").textContent = message;
    const actionButton = $("#toast-action");
    toastActionHandler = action;
    actionButton.textContent = actionLabel;
    actionButton.classList.toggle("is-visible", Boolean(action && actionLabel));
    $("#toast").classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      $("#toast").classList.remove("is-visible");
      toastActionHandler = null;
    }, duration);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readStoredNumber(key, fallback) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function readStoredFlag(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storePreference(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Preferences are optional; the core workbench can still function.
    }
  }

  function loadAuthSession() {
    try {
      const hash = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : "");
      if (hash.get("access_token") && hash.get("refresh_token")) {
        const session = {
          access_token: hash.get("access_token"),
          refresh_token: hash.get("refresh_token"),
          expires_at: Date.now() + Number(hash.get("expires_in") || 3600) * 1000,
          user: null,
        };
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
        history.replaceState(null, "", `${location.pathname}${location.search}`);
        return session;
      }
      const raw = localStorage.getItem(AUTH_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveAuthSession(payload) {
    authSession = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: Date.now() + Number(payload.expires_in || 3600) * 1000,
      user: payload.user || authSession?.user || null,
    };
    try {
      localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(authSession));
    } catch {
      showToast("无法保存登录状态");
    }
    return authSession;
  }

  function clearAuthSession() {
    authSession = null;
    authEmail = "";
    try {
      localStorage.removeItem(AUTH_SESSION_KEY);
    } catch {
      // Signing out locally still clears the in-memory session.
    }
  }

  function deviceId() {
    try {
      let value = localStorage.getItem(DEVICE_ID_KEY);
      if (!value) {
        value = uid("device");
        localStorage.setItem(DEVICE_ID_KEY, value);
      }
      return value;
    } catch {
      return "browser-session";
    }
  }

  async function supabaseRequest(path, options = {}) {
    if (!SUPABASE.url || !SUPABASE.publishableKey) {
      throw new Error("云端服务尚未配置");
    }

    let token = authSession?.access_token;
    if (options.useAuth !== false) {
      if (!authSession) throw new Error("请先登录");
      await refreshAuthSession();
      token = authSession.access_token;
    }

    const headers = {
      apikey: SUPABASE.publishableKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${SUPABASE.url}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      const message =
        payload?.msg ||
        payload?.message ||
        payload?.error_description ||
        payload?.error ||
        `请求失败 (${response.status})`;
      throw new Error(message);
    }
    return payload;
  }

  async function refreshAuthSession() {
    if (!authSession) return null;
    if (Number(authSession.expires_at) > Date.now() + 60_000) return authSession;
    const refreshed = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      useAuth: false,
      body: { refresh_token: authSession.refresh_token },
    });
    saveAuthSession(refreshed);
    if (!authSession.user) authSession.user = await fetchCurrentUser();
    return authSession;
  }

  async function fetchCurrentUser() {
    const user = await supabaseRequest("/auth/v1/user");
    if (authSession) {
      authSession.user = user;
      try {
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(authSession));
      } catch {
        // Current in-memory login still remains valid.
      }
    }
    return user;
  }

  function setSyncStatus(status, text) {
    const pill = $("#sync-pill");
    pill.dataset.state = status;
    $("#sync-status-text").textContent = text;
    pill.title =
      status === "synced"
        ? "云端已同步，点击再次检查"
        : status === "syncing"
          ? "正在保存到云端"
          : status === "offline"
            ? "网络不可用，记录仍保存在本机"
            : "点击登录并开启云端同步";
  }

  function renderCloudAccount() {
    const email = authSession?.user?.email;
    $("#cloud-account-email").textContent = email
      ? `${email} · ${lastSyncedAt ? `上次同步 ${formatTime(lastSyncedAt.toISOString())}` : "等待首次同步"}`
      : "尚未登录，数据目前只保存在本机。";
    $("#manual-sync").textContent = authSession ? "立即同步" : "登录并同步";
    $("#sign-out-button").hidden = !authSession;
  }

  function showAuthScreen(options = {}) {
    if (authSession) return;
    const welcome = $("#welcome-screen");
    if (!welcome.hidden && !welcome.classList.contains("is-hidden") && !options.force) return;
    const screen = $("#auth-screen");
    screen.hidden = false;
    if (options.message) setAuthStatus(options.message, options.status || "");
    window.setTimeout(() => $("#auth-email").focus(), 80);
    renderCloudAccount();
  }

  function hideAuthScreen() {
    $("#auth-screen").hidden = true;
  }

  function setAuthStatus(message, status = "") {
    const element = $("#auth-status");
    element.textContent = message;
    element.dataset.state = status;
  }

  function authErrorMessage(error) {
    const message = String(error?.message || error);
    if (/signups? not allowed|user not found/i.test(message)) {
      return "该邮箱不是此私人工作台绑定的邮箱。";
    }
    if (/security purposes|rate limit|too many/i.test(message)) {
      return "请求过于频繁，请稍后再试。";
    }
    if (/token.*(expired|invalid)|invalid.*token/i.test(message)) {
      return "验证码不正确或已经过期。";
    }
    return message;
  }

  async function sendLoginCode(email) {
    return supabaseRequest("/auth/v1/otp", {
      method: "POST",
      useAuth: false,
      body: { email, create_user: false },
    });
  }

  async function verifyLoginCode(email, token) {
    const payload = await supabaseRequest("/auth/v1/verify", {
      method: "POST",
      useAuth: false,
      body: { type: "email", email, token },
    });
    saveAuthSession(payload);
    if (!authSession.user) await fetchCurrentUser();
    hideAuthScreen();
    renderCloudAccount();
    await syncWorkbench({ initial: true });
  }

  function scheduleSync() {
    if (!authSession || !navigator.onLine) {
      if (authSession && !navigator.onLine) setSyncStatus("offline", "离线待同步");
      return;
    }
    clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => syncWorkbench(), 850);
  }

  async function applyCloudState(remote) {
    const cloudState = normalizeState(remote.data || {});
    cloudState.updatedAt = Number(remote.client_updated_at) || 0;
    applyingRemote = true;
    state = cloudState;
    persist({ touch: false, schedule: false });
    applyingRemote = false;
    renderAll();
  }

  async function pushCloudState() {
    const userId = authSession?.user?.id;
    if (!userId) throw new Error("登录信息不完整");
    const cloudData = { ...state, freshSeed: false };
    await supabaseRequest("/rest/v1/workbenches?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: {
        user_id: userId,
        data: cloudData,
        client_updated_at: Number(state.updatedAt) || Date.now(),
        device_id: deviceId(),
        updated_at: new Date().toISOString(),
      },
    });
    state.freshSeed = false;
    persist({ touch: false, schedule: false });
  }

  async function syncWorkbench(options = {}) {
    if (!authSession || syncInFlight) return;
    if (!navigator.onLine) {
      setSyncStatus("offline", "离线待同步");
      return;
    }

    syncInFlight = true;
    setSyncStatus("syncing", "正在同步");
    try {
      await refreshAuthSession();
      if (!authSession.user) await fetchCurrentUser();
      const userId = authSession.user.id;
      const rows = await supabaseRequest(
        `/rest/v1/workbenches?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`
      );
      const remote = rows?.[0];
      const localUpdatedAt = Number(state.updatedAt) || 0;
      const remoteUpdatedAt = Number(remote?.client_updated_at) || 0;

      if (!remote || (!state.freshSeed && localUpdatedAt > remoteUpdatedAt)) {
        await pushCloudState();
      } else if (state.freshSeed || remoteUpdatedAt >= localUpdatedAt) {
        await applyCloudState(remote);
      }

      lastSyncedAt = new Date();
      setSyncStatus("synced", "已同步");
      renderCloudAccount();
    } catch (error) {
      if (!navigator.onLine) {
        setSyncStatus("offline", "离线待同步");
      } else {
        setSyncStatus("offline", "同步异常");
        if (!options.quiet) showToast(`同步失败：${error.message}`);
      }
    } finally {
      syncInFlight = false;
    }
  }

  function initAuthUi() {
    renderCloudAccount();
    if (!authSession) showAuthScreen();

    $("#email-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = $("#auth-email").value.trim().toLowerCase();
      if (!email) return;
      authEmail = email;
      const button = $("#send-code-button");
      button.disabled = true;
      setAuthStatus("正在发送登录验证码…");
      try {
        await sendLoginCode(email);
        $("#email-form").hidden = true;
        $("#code-form").hidden = false;
        $("#code-form").dataset.email = email;
        setAuthStatus(`验证码已发送到 ${email}，请在邮箱中查看。`, "success");
        window.setTimeout(() => $("#auth-code").focus(), 80);
      } catch (error) {
        setAuthStatus(`发送失败：${authErrorMessage(error)}`, "error");
      } finally {
        button.disabled = false;
      }
    });

    $("#code-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = $("#auth-code").value.trim();
      const email = $("#code-form").dataset.email || authEmail;
      if (!/^\d{6,10}$/.test(code)) {
        setAuthStatus("请输入邮件中的数字验证码。", "error");
        return;
      }
      const button = $("#verify-code-button");
      button.disabled = true;
      setAuthStatus("正在验证并恢复云端记录…");
      try {
        await verifyLoginCode(email, code);
        setAuthStatus("登录成功，记录会自动同步。", "success");
        showToast("云端同步已开启");
      } catch (error) {
        setAuthStatus(`登录失败：${authErrorMessage(error)}`, "error");
      } finally {
        button.disabled = false;
      }
    });

    $("#change-email-button").addEventListener("click", () => {
      $("#code-form").hidden = true;
      $("#email-form").hidden = false;
      setAuthStatus("不需要密码。登录后，这台设备会保持登录状态。");
      $("#auth-email").focus();
    });

    $("#sync-pill").addEventListener("click", () => {
      if (authSession) syncWorkbench();
      else showAuthScreen({ force: true });
    });

    $("#manual-sync").addEventListener("click", () => {
      if (authSession) syncWorkbench();
      else showAuthScreen({ force: true });
    });

    $("#sign-out-button").addEventListener("click", () => {
      if (!authSession) return;
      openConfirm(
        "退出云端账号？",
        "云端记录不会被删除，这台设备上的数据也会保留。下次登录同一个邮箱即可恢复同步。",
        "退出登录",
        () => {
          clearAuthSession();
          localStorage.removeItem(STORAGE_KEY);
          state = createSeedState();
          persist({ touch: false, schedule: false });
          renderAll();
          setSyncStatus("offline", "未登录");
          renderCloudAccount();
          showAuthScreen({ force: true, message: "已退出登录，本机缓存已清除。云端记录仍然安全保留。" });
        }
      );
    });

    window.addEventListener("online", () => {
      if (authSession) syncWorkbench({ quiet: true });
    });
    window.addEventListener("offline", () => {
      if (authSession) setSyncStatus("offline", "离线待同步");
    });
  }

  function updateMusicUI(isPlaying) {
    const widget = $("#music-widget");
    const toggle = $("#music-toggle");
    widget.classList.toggle("is-playing", isPlaying);
    toggle.setAttribute("aria-pressed", String(isPlaying));
    toggle.setAttribute("aria-label", isPlaying ? "暂停背景音乐" : "播放背景音乐");
    $("#music-status").textContent = isPlaying ? "正在播放" : "轻触播放";
  }

  async function playAmbient(options = {}) {
    const audio = $("#ambient-audio");
    try {
      await audio.play();
      storePreference(MUSIC_PREFERENCE_KEY, "true");
      updateMusicUI(true);
      return true;
    } catch {
      if (!options.preservePreference) storePreference(MUSIC_PREFERENCE_KEY, "false");
      updateMusicUI(false);
      if (!options.quiet) showToast("轻触顶部音乐按钮即可播放");
      return false;
    }
  }

  function pauseAmbient() {
    const audio = $("#ambient-audio");
    audio.pause();
    storePreference(MUSIC_PREFERENCE_KEY, "false");
    updateMusicUI(false);
  }

  function toggleAmbient() {
    const audio = $("#ambient-audio");
    if (audio.paused) {
      playAmbient();
    } else {
      pauseAmbient();
    }
  }

  function finishWelcome(withMusic) {
    const welcome = $("#welcome-screen");
    storePreference(WELCOME_SEEN_KEY, "true");
    storePreference(MUSIC_PREFERENCE_KEY, String(withMusic));
    requestPersistentStorage();
    if (withMusic) playAmbient();
    welcome.classList.add("is-hidden");
    document.body.classList.remove("is-welcome-open");
    window.setTimeout(() => {
      welcome.hidden = true;
    }, 520);
    showAuthScreen();
  }

  async function requestPersistentStorage() {
    try {
      if (!navigator.storage?.persist) return;
      const alreadyPersistent = await navigator.storage.persisted?.();
      if (!alreadyPersistent) await navigator.storage.persist();
    } catch {
      // The JSON backup remains available when the browser declines persistence.
    }
  }

  async function registerOfflineSupport() {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    document.documentElement.classList.toggle("is-standalone", isStandalone);

    if (
      "serviceWorker" in navigator &&
      (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ) {
      try {
        const wasControlled = Boolean(navigator.serviceWorker.controller);
        let refreshingForUpdate = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!wasControlled || refreshingForUpdate) return;
          refreshingForUpdate = true;
          window.location.reload();
        });
        await navigator.serviceWorker.register("./sw.js");
        await navigator.serviceWorker.ready;
        navigator.serviceWorker.getRegistration().then((registration) => registration?.update());
        document.documentElement.dataset.offlineReady = "true";
      } catch (error) {
        document.documentElement.dataset.offlineReady = "unavailable";
        document.documentElement.dataset.offlineError = String(error?.message || error).slice(0, 120);
        // The app remains usable online if offline support cannot be registered.
      }
    }
  }

  function initIosInstallTip() {
    const card = $("#ios-install-card");
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    const dismissed = readStoredFlag(IOS_INSTALL_TIP_KEY) === "true";

    if (isIos && !isStandalone && location.protocol === "https:" && !dismissed) {
      card.hidden = false;
    }

    $("#dismiss-ios-install").addEventListener("click", () => {
      storePreference(IOS_INSTALL_TIP_KEY, "true");
      card.hidden = true;
    });
  }

  function initMusic() {
    const audio = $("#ambient-audio");
    const volume = clamp(readStoredNumber(MUSIC_VOLUME_KEY, 0.24), 0, 1);
    audio.volume = volume;
    $("#music-volume").value = String(volume);

    updateMusicUI(false);
    const welcomeSeen = readStoredFlag(WELCOME_SEEN_KEY) === "true";
    const welcome = $("#welcome-screen");
    if (welcomeSeen) {
      welcome.classList.add("is-hidden");
      welcome.hidden = true;
      document.body.classList.remove("is-welcome-open");
      if (readStoredFlag(MUSIC_PREFERENCE_KEY) === "true") {
        window.setTimeout(() => playAmbient({ quiet: true, preservePreference: true }), 120);
      }
    } else {
      document.body.classList.add("is-welcome-open");
    }

    $("#welcome-music").addEventListener("click", () => finishWelcome(true));
    $("#welcome-silent").addEventListener("click", () => finishWelcome(false));
    $("#music-toggle").addEventListener("click", toggleAmbient);
    $("#music-volume").addEventListener("input", (event) => {
      const nextVolume = clamp(Number(event.target.value), 0, 1);
      audio.volume = nextVolume;
      storePreference(MUSIC_VOLUME_KEY, nextVolume);
    });
    audio.addEventListener("play", () => updateMusicUI(true));
    audio.addEventListener("pause", () => updateMusicUI(false));
    audio.addEventListener("error", () => {
      updateMusicUI(false);
      $("#music-status").textContent = "音频不可用";
    });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `日进备份-${todayKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("备份已导出");
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result));
        if (!imported || !Array.isArray(imported.habits) || typeof imported.days !== "object") {
          throw new Error("Bad format");
        }
        openConfirm(
          "导入这份备份？",
          "当前数据将被备份文件中的数据替换。请确认这是你要恢复的记录。",
          "确认导入",
          () => {
            state = normalizeState(imported);
            persist();
            renderAll();
            showToast("备份已导入");
          }
        );
      } catch {
        showToast("备份文件格式不正确");
      }
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        setView(viewButton.dataset.view);
        return;
      }

      const viewLink = event.target.closest("[data-view-link]");
      if (viewLink) {
        event.preventDefault();
        setView(viewLink.dataset.viewLink);
        return;
      }

      const taskButton = event.target.closest("[data-action]");
      if (taskButton) {
        const item = taskButton.closest(".task-item");
        const action = taskButton.dataset.action;
        if (action === "toggle-task" && item) {
          toggleTask(item.dataset.taskType, item.dataset.taskId, item.dataset.taskDay);
        } else if (action === "delete-extra" && item) {
          deleteExtraTask(item.dataset.taskId, item.dataset.taskDay);
        } else if (action === "open-task-log" && item) {
          openTaskLogModal(item.dataset.taskType, item.dataset.taskId, item.dataset.taskDay);
        } else if (action === "edit-habit") {
          openHabitModal(taskButton.dataset.id);
        } else if (action === "delete-habit") {
          archiveHabit(taskButton.dataset.id);
        }
        return;
      }

      const taskMain = event.target.closest(".task-main");
      if (taskMain) {
        const item = taskMain.closest(".task-item");
        if (item) toggleTask(item.dataset.taskType, item.dataset.taskId, item.dataset.taskDay);
        return;
      }

      const emojiButton = event.target.closest("[data-emoji]");
      if (emojiButton) {
        ui.selectedEmoji = emojiButton.dataset.emoji;
        renderEmojiPicker();
        return;
      }

      const colorButton = event.target.closest("[data-color]");
      if (colorButton) {
        ui.selectedColor = colorButton.dataset.color;
        renderColorPicker();
        return;
      }

      const planDayButton = event.target.closest("[data-plan-date]");
      if (planDayButton) {
        ui.activePlanDate = planDayButton.dataset.planDate;
        renderToday();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      const weekOpenButton = event.target.closest("[data-open-week-view]");
      if (weekOpenButton) {
        $("#week-overview-modal").showModal();
        return;
      }

      const dayButton = event.target.closest("[data-date]");
      if (dayButton) {
        ui.selectedDate = dayButton.dataset.date;
        ui.calendarDate = startOfMonth(parseKey(ui.selectedDate));
        if (ui.period !== "day") {
          ui.period = "day";
          $$(".period-button").forEach((button) => {
            button.classList.toggle("is-active", button.dataset.period === "day");
            button.setAttribute("aria-selected", String(button.dataset.period === "day"));
          });
        }
        renderReview();
        return;
      }

      const addTypeButton = event.target.closest("[data-add-type]");
      if (addTypeButton) {
        openQuickModal(addTypeButton.dataset.addType, ui.activePlanDate);
      }
    });

    $$(".period-button").forEach((button) => {
      button.addEventListener("click", () => {
        ui.period = button.dataset.period;
        $$(".period-button").forEach((item) => {
          item.classList.toggle("is-active", item === button);
          item.setAttribute("aria-selected", String(item === button));
        });
        renderReview();
      });
    });

    $("#quick-task-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("#quick-task-input");
      const taskType = $("#quick-task-type-inline").value;
      addExtraTask(input.value, "其他", taskType, ui.activePlanDate);
      input.value = "";
      input.focus();
    });

    $("#quick-add-button").addEventListener("click", openQuickModal);

    $("#open-week-view").addEventListener("click", openWeekOverview);
    $("#nav-week-view").addEventListener("click", openWeekOverview);
    $("#mobile-week-view").addEventListener("click", openWeekOverview);
    $("#close-week-view").addEventListener("click", () => {
      $("#week-overview-modal").close();
    });

    $("#import-schedule-button").addEventListener("click", () => {
      $("#schedule-import-text").value = "";
      $("#schedule-import-file").value = "";
      releaseOcrPreview();
      $("#schedule-import-modal").showModal();
      window.setTimeout(() => $("#schedule-import-text").focus(), 50);
    });

    $("#schedule-import-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        $("#schedule-import-text").value = String(reader.result || "");
      };
      reader.readAsText(file, "utf-8");
    });

    $("#schedule-image-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) recognizeTimetableImage(file);
    });

    $("#schedule-import-text").addEventListener("input", updateTimetableImportButton);

    $("#schedule-import-form").addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault();
      importTimetable($("#schedule-import-text").value);
    });

    $("#schedule-import-modal").addEventListener("close", releaseOcrPreview);

    $("#toast-action").addEventListener("click", () => {
      const action = toastActionHandler;
      toastActionHandler = null;
      $("#toast").classList.remove("is-visible");
      if (action) action();
    });

    $("#quick-modal-form").addEventListener("submit", (event) => {
      if (event.submitter?.value === "cancel") return;
      event.preventDefault();
      const input = $("#quick-modal-input");
      if (!input.value.trim()) {
        input.focus();
        return;
      }
      addExtraTask(
        input.value,
        $("#quick-modal-category").value,
        $("#quick-modal-type").value,
        $("#quick-modal-date").value || ui.quickTaskDate,
        $("#quick-modal-start-time").value,
        $("#quick-modal-end-time").value
      );
      $("#quick-modal").close();
    });

    $("#add-habit-button").addEventListener("click", () => openHabitModal());
    $("#save-habit-button").addEventListener("click", (event) => {
      event.preventDefault();
      if (!$("#habit-title").reportValidity()) return;
      saveHabit();
      $("#habit-modal").close();
    });

    $("#save-task-log").addEventListener("click", (event) => {
      event.preventDefault();
      saveTaskLog();
      $("#task-log-modal").close();
    });

    $("#habit-form").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.tagName === "INPUT") {
        event.preventDefault();
        if (!$("#habit-title").reportValidity()) return;
        saveHabit();
        $("#habit-modal").close();
      }
    });

    $("#daily-note").addEventListener("input", (event) => {
      const day = ensureDay(ui.activePlanDate);
      day.note = event.target.value.slice(0, 500);
      $("#note-count").textContent = `${day.note.length} / 500`;
      $("#note-status").textContent = "正在输入…";
      clearTimeout(noteTimer);
      noteTimer = window.setTimeout(() => {
        persist();
        $("#note-status").textContent = "已自动保存";
        renderChrome();
      }, 450);
    });

    $("#period-prev").addEventListener("click", () => {
      const date = parseKey(ui.selectedDate);
      if (ui.period === "day") {
        ui.selectedDate = dateKey(addDays(date, -1));
      } else if (ui.period === "month") {
        const next = addMonths(startOfMonth(date), -1);
        ui.selectedDate = dateKey(next);
        ui.calendarDate = next;
      } else {
        ui.selectedDate = dateKey(new Date(date.getFullYear() - 1, 0, 1));
      }
      renderReview();
    });

    $("#period-next").addEventListener("click", () => {
      const date = parseKey(ui.selectedDate);
      if (ui.period === "day") {
        ui.selectedDate = dateKey(addDays(date, 1));
      } else if (ui.period === "month") {
        const next = addMonths(startOfMonth(date), 1);
        ui.selectedDate = dateKey(next);
        ui.calendarDate = next;
      } else {
        ui.selectedDate = dateKey(new Date(date.getFullYear() + 1, 0, 1));
      }
      renderReview();
    });

    $("#period-today").addEventListener("click", () => {
      ui.selectedDate = todayKey();
      ui.calendarDate = startOfMonth(new Date());
      renderReview();
    });

    $("#calendar-prev").addEventListener("click", () => {
      ui.calendarDate = addMonths(ui.calendarDate, -1);
      renderCalendar();
    });

    $("#calendar-next").addEventListener("click", () => {
      ui.calendarDate = addMonths(ui.calendarDate, 1);
      renderCalendar();
    });

    $("#export-data").addEventListener("click", exportData);
    $("#import-data").addEventListener("change", (event) => {
      importData(event.target.files?.[0]);
      event.target.value = "";
    });
    $("#clear-data").addEventListener("click", () => {
      openConfirm(
        "清空全部数据？",
        "所有固定事项、完成记录和每日笔记都会被删除；如果已登录，云端同步副本也会更新为空状态。建议先导出一份备份。",
        "确认清空",
        () => {
          localStorage.removeItem(STORAGE_KEY);
          state = createSeedState();
          persist();
          ui.activePlanDate = todayKey();
          ui.selectedDate = todayKey();
          ui.calendarDate = startOfMonth(new Date());
          renderAll();
          showToast("数据已清空");
        }
      );
    });

    $("#confirm-modal").addEventListener("close", () => {
      if ($("#confirm-modal").returnValue === "default" && pendingConfirmAction) {
        pendingConfirmAction();
      }
      pendingConfirmAction = null;
    });

    document.addEventListener("keydown", (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "1") {
        event.preventDefault();
        setView("today");
      } else if (event.key === "2") {
        event.preventDefault();
        setView("review");
      } else if (event.key === "3") {
        event.preventDefault();
        setView("habits");
      } else if (event.key === "4") {
        event.preventDefault();
        openWeekOverview();
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        openQuickModal();
      }
    });
  }

  function init() {
    if (!localStorage.getItem(STORAGE_KEY)) persist({ touch: false, schedule: false });
    bindEvents();
    initMusic();
    initAuthUi();
    registerOfflineSupport();
    initIosInstallTip();
    if (readStoredFlag(WELCOME_SEEN_KEY) === "true") requestPersistentStorage();
    renderAll();
    setView("today", { keepScroll: true });
    if (authSession) {
      setSyncStatus("syncing", "正在同步");
      window.setTimeout(() => syncWorkbench({ quiet: true }), 250);
    }
  }

  init();
})();
