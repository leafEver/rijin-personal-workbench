(() => {
  "use strict";

  const STORAGE_KEY = "rijin-personal-workbench-v1-release";
  const WELCOME_SEEN_KEY = "rijin-welcome-seen-v2";
  const MUSIC_PREFERENCE_KEY = "rijin-music-enabled-v1";
  const MUSIC_VOLUME_KEY = "rijin-music-volume-v1";
  const IOS_INSTALL_TIP_KEY = "rijin-ios-install-tip-dismissed-v1";
  const COLORS = ["#61715f", "#d86e59", "#c69a42", "#718390", "#9a7b68", "#8b7f9c"];
  const EMOJIS = ["📖", "🏃", "✍️", "🌿", "💧", "🧘", "💼", "🎧", "☀️", "🍵"];
  const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const SHORT_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  const MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  const CATEGORY_COLORS = {
    成长: "#61715f",
    健康: "#d86e59",
    工作: "#718390",
    生活: "#c69a42",
    关系: "#8b7f9c",
    其他: "#9a927f",
  };

  const ui = {
    view: "today",
    period: "day",
    selectedDate: todayKey(),
    calendarDate: startOfMonth(new Date()),
    editingHabitId: null,
    selectedEmoji: "📖",
    selectedColor: COLORS[0],
    modalQuickCategory: "其他",
  };

  let state = loadState();
  let noteTimer = null;
  let toastTimer = null;
  let toastActionHandler = null;
  let lastDeletedExtra = null;
  let pendingConfirmAction = null;

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
      habits: [
        {
          id: uid("habit"),
          title: "阅读 20 分钟",
          emoji: "📖",
          category: "成长",
          color: "#61715f",
          createdAt: created,
          archivedAt: null,
        },
        {
          id: uid("habit"),
          title: "运动 30 分钟",
          emoji: "🏃",
          category: "健康",
          color: "#d86e59",
          createdAt: created,
          archivedAt: null,
        },
        {
          id: uid("habit"),
          title: "写下今日收获",
          emoji: "✍️",
          category: "成长",
          color: "#c69a42",
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
      habits: candidate.habits
        .filter((habit) => habit && habit.id && habit.title)
        .map((habit, index) => ({
          id: String(habit.id),
          title: String(habit.title).slice(0, 30),
          emoji: habit.emoji || "✦",
          category: CATEGORY_COLORS[habit.category] ? habit.category : "其他",
          color: /^#[0-9a-f]{6}$/i.test(habit.color || "") ? habit.color : COLORS[index % COLORS.length],
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
                createdAt: task.createdAt || new Date().toISOString(),
                completedAt: task.completedAt || null,
              }))
          : [],
        note: typeof day.note === "string" ? day.note.slice(0, 500) : "",
      };
    });

    return normalized;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not save data:", error);
      showToast("保存失败，请导出备份");
    }
  }

  function ensureDay(key = todayKey()) {
    if (!state.days[key]) {
      state.days[key] = { habits: {}, extras: [], note: "" };
    }
    return state.days[key];
  }

  function habitsForDate(key, includeArchivedCompletion = false) {
    const day = state.days[key];
    return state.habits.filter(
      (habit) =>
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
        total.planned += stats.planned;
        total.completed += stats.completed;
        total.activeDays += stats.completed > 0 ? 1 : 0;
        if (stats.planned > 0) total.trackedDays += 1;
        return total;
      },
      { planned: 0, completed: 0, activeDays: 0, trackedDays: 0, rate: 0 }
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

  function taskTemplate({ task, completed, completedAt, type, deletable = true }) {
    const color = task.color || categoryColor(task.category);
    const typeMeta =
      type === "habit"
        ? `<span class="task-emoji" aria-hidden="true">${escapeHtml(task.emoji)}</span>`
        : `<span class="task-time">${completedAt ? `${formatTime(completedAt)} 完成` : "临时事项"}</span>`;
    return `
      <article
        class="task-item ${completed ? "is-completed" : ""}"
        style="--task-color: ${escapeHtml(color)}"
        data-task-type="${type}"
        data-task-id="${escapeHtml(task.id)}"
      >
        <button class="task-check" type="button" data-action="toggle-task" aria-label="${completed ? "标记为未完成" : "标记为完成"}">
          <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg>
        </button>
        <div class="task-main">
          <span class="task-title">${escapeHtml(task.title)}</span>
          <div class="task-meta">
            <span class="task-category">${escapeHtml(task.category || "其他")}</span>
            ${typeMeta}
          </div>
        </div>
        ${
          type === "habit"
            ? `<span class="task-emoji" aria-hidden="true">${escapeHtml(task.emoji)}</span>`
            : deletable
              ? `<button class="task-delete" type="button" data-action="delete-extra" aria-label="删除事项">
                   <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
                 </button>`
              : ""
        }
      </article>
    `;
  }

  function renderToday() {
    const key = todayKey();
    const day = state.days[key] || { habits: {}, extras: [], note: "" };
    const stats = getDayStats(key);
    const habits = habitsForDate(key);
    const extras = Array.isArray(day.extras) ? day.extras : [];
    const progress = stats.planned ? Math.round((stats.completed / stats.planned) * 100) : 0;

    $("#today-progress-ring").style.setProperty("--progress", `${progress * 3.6}deg`);
    $("#today-progress-value").textContent = `${progress}%`;
    $("#habit-total-badge").textContent = `${habits.length} 项`;
    $("#extra-total-badge").textContent = `${extras.length} 项`;

    if (progress === 100 && stats.planned > 0) {
      $("#today-progress-title").textContent = "今天的计划都完成了";
      $("#today-progress-copy").textContent = "可以安心收尾，记得留下一句记录";
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

    const habitTaskList = $("#habit-task-list");
    if (habits.length) {
      habitTaskList.innerHTML = habits
        .map((habit) =>
          taskTemplate({
            task: habit,
            completed: Boolean(day.habits?.[habit.id]),
            completedAt: day.habits?.[habit.id],
            type: "habit",
          })
        )
        .join("");
    } else {
      habitTaskList.innerHTML = `
        <div class="empty-state">
          <div>
            <span class="empty-state-icon">✦</span>
            <strong>还没有固定事项</strong>
            <p>设置每天想做的小事，明天开始就不用再手动添加。</p>
          </div>
        </div>`;
    }

    const extraTaskList = $("#extra-task-list");
    if (extras.length) {
      extraTaskList.innerHTML = extras
        .map((task) =>
          taskTemplate({
            task,
            completed: Boolean(task.completedAt),
            completedAt: task.completedAt,
            type: "extra",
          })
        )
        .join("");
    } else {
      extraTaskList.innerHTML = `
        <div class="empty-state">
          <div>
            <span class="empty-state-icon">＋</span>
            <strong>今天还没有临时事项</strong>
            <p>有临时要做的事时，再加到这里就好。</p>
          </div>
        </div>`;
    }

    const note = $("#daily-note");
    if (document.activeElement !== note) {
      note.value = day.note || "";
    }
    const noteLength = note.value.length;
    $("#note-count").textContent = `${noteLength} / 500`;
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
        return `
          <div class="activity-item">
            <span class="activity-icon" style="--task-color-soft: color-mix(in srgb, ${escapeHtml(event.color)} 14%, white)">${escapeHtml(event.emoji)}</span>
            <div class="activity-main">
              <strong>${escapeHtml(event.title)}</strong>
              <span>${escapeHtml(event.category)}${showDate ? ` · ${date.getMonth() + 1}月${date.getDate()}日` : ""}</span>
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
              <p>每天自动出现 · 从 ${escapeHtml(habit.createdAt.replaceAll("-", "."))} 开始</p>
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

  function toggleTask(type, id) {
    const key = todayKey();
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

  function addExtraTask(title, category = "其他") {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const day = ensureDay(todayKey());
    day.extras.push({
      id: uid("extra"),
      title: cleanTitle.slice(0, 80),
      category: CATEGORY_COLORS[category] ? category : "其他",
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    persist();
    renderAll();
    showToast("已加入今天");
  }

  function deleteExtraTask(id) {
    const day = ensureDay(todayKey());
    const index = day.extras.findIndex((task) => task.id === id);
    if (index === -1) return;
    const deleted = day.extras[index];
    day.extras = day.extras.filter((task) => task.id !== id);
    persist();
    renderAll();
    lastDeletedExtra = { task: deleted, index, date: todayKey() };
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
    const existing = ui.editingHabitId
      ? state.habits.find((habit) => habit.id === ui.editingHabitId)
      : null;
    if (existing) {
      existing.title = title.slice(0, 30);
      existing.category = category;
      existing.emoji = ui.selectedEmoji;
      existing.color = ui.selectedColor;
      showToast("固定事项已更新");
    } else {
      state.habits.push({
        id: uid("habit"),
        title: title.slice(0, 30),
        category,
        emoji: ui.selectedEmoji,
        color: ui.selectedColor,
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

  function openQuickModal() {
    $("#quick-modal-input").value = "";
    $("#quick-modal-category").value = "其他";
    const dialog = $("#quick-modal");
    dialog.showModal();
    window.setTimeout(() => $("#quick-modal-input").focus(), 50);
  }

  function openConfirm(title, copy, okLabel, action) {
    $("#confirm-title").textContent = title;
    $("#confirm-copy").textContent = copy;
    $("#confirm-ok").textContent = okLabel || "确认";
    pendingConfirmAction = action;
    $("#confirm-modal").showModal();
  }

  function showToast(message, actionLabel = "", action = null) {
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
    }, 1900);
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
        await navigator.serviceWorker.register("./sw.js");
        await navigator.serviceWorker.ready;
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
          toggleTask(item.dataset.taskType, item.dataset.taskId);
        } else if (action === "delete-extra" && item) {
          deleteExtraTask(item.dataset.taskId);
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
        if (item) toggleTask(item.dataset.taskType, item.dataset.taskId);
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
      addExtraTask(input.value);
      input.value = "";
      input.focus();
    });

    $("#quick-add-button").addEventListener("click", openQuickModal);

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
      addExtraTask(input.value, $("#quick-modal-category").value);
      $("#quick-modal").close();
    });

    $("#add-habit-button").addEventListener("click", () => openHabitModal());
    $("#save-habit-button").addEventListener("click", (event) => {
      event.preventDefault();
      if (!$("#habit-title").reportValidity()) return;
      saveHabit();
      $("#habit-modal").close();
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
      const day = ensureDay(todayKey());
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
        "所有固定事项、完成记录和每日笔记都会被删除。建议先导出一份备份。",
        "确认清空",
        () => {
          localStorage.removeItem(STORAGE_KEY);
          state = createSeedState();
          persist();
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
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        openQuickModal();
      }
    });
  }

  function init() {
    if (!localStorage.getItem(STORAGE_KEY)) persist();
    bindEvents();
    initMusic();
    registerOfflineSupport();
    initIosInstallTip();
    if (readStoredFlag(WELCOME_SEEN_KEY) === "true") requestPersistentStorage();
    renderAll();
    setView("today", { keepScroll: true });
  }

  init();
})();
