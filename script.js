const STORAGE_KEY = "my-expense-tracker-v1";
const CATEGORIES = [
  "Food and Drinks",
  "Groceries",
  "Transportation",
  "Shopping",
  "Healthcare",
  "Bills and Utilities",
  "Entertainment"
];
const CATEGORY_ICONS = {
  "Food and Drinks": "🍽️",
  Groceries: "🛒",
  Transportation: "🚌",
  Shopping: "🛍️",
  Healthcare: "💊",
  "Bills and Utilities": "💡",
  Entertainment: "🎬"
};
const CATEGORY_CHART_COLORS = [
  "#c45127",
  "#39784f",
  "#26779a",
  "#8b55a2",
  "#b5414b",
  "#a87808",
  "#514c9c",
  "#667788"
];
function createDefaultState() {
  return {
    expenses: [],
    preferences: {
      allowanceType: null,
      allowance: null,
      budgetAlerts: {},
      largeText: false
    }
  };
}

let storageReady = true;
let storageError = null;
let state = loadState();
let editingExpenseId = null;
let pendingReceiptFingerprint = null;
let messageTimer = null;
let selectedChartCategory = null;

const appMessage = document.querySelector("#app-message");
const storageWarning = document.querySelector("#storage-warning");
const expenseForm = document.querySelector("#expense-form");
const descriptionInput = document.querySelector("#expense-description");
const amountInput = document.querySelector("#expense-amount");
const dateInput = document.querySelector("#expense-date");
const categoryInput = document.querySelector("#expense-category");
const budgetForm = document.querySelector("#budget-form");

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createDefaultState();

    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.expenses) || !parsed.preferences) {
      throw new Error("The saved data does not have the expected format.");
    }

    const expenses = parsed.expenses.map((expense) => {
      const category = CATEGORIES.includes(expense.category)
        ? expense.category
        : "Shopping";
      if (
        !expense ||
        typeof expense.id !== "string" ||
        typeof expense.description !== "string" ||
        typeof expense.amount !== "number" ||
        !Number.isFinite(expense.amount) ||
        expense.amount <= 0 ||
        !isValidDateString(expense.date) ||
        !CATEGORIES.includes(category)
      ) {
        throw new Error("A saved expense is incomplete or invalid.");
      }
      return { ...expense, category };
    });

    const savedPreferences = { ...parsed.preferences };
    delete savedPreferences.reminderEnabled;
    delete savedPreferences.reminderTime;
    delete savedPreferences.lastReminderDate;
    delete savedPreferences.simpleMode;
    const allowanceType = ["daily", "weekly"].includes(savedPreferences.allowanceType)
      ? savedPreferences.allowanceType
      : null;
    const allowance = Number.isFinite(savedPreferences.allowance) && savedPreferences.allowance > 0
      ? savedPreferences.allowance
      : null;

    return {
      expenses,
      preferences: {
        ...createDefaultState().preferences,
        ...savedPreferences,
        allowanceType,
        allowance,
        largeText: savedPreferences.largeText === true,
        budgetAlerts: savedPreferences.budgetAlerts && typeof savedPreferences.budgetAlerts === "object"
          ? savedPreferences.budgetAlerts
          : {}
      }
    };
  } catch (error) {
    storageReady = false;
    storageError = error;
    console.error("Could not read saved expense data:", error);
    return createDefaultState();
  }
}

function saveState() {
  if (!storageReady) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    storageReady = false;
    storageError = error;
    console.error("Could not save expense data:", error);
    storageWarning.textContent = "Your browser could not save this change. Check that device storage is available and try again. This change may not remain after you close the page.";
    storageWarning.hidden = false;
    return false;
  }
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && localDateString(date) === value;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(amount);
}

function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(year, month - 1, day));
}

function showMessage(message, type = "success") {
  window.clearTimeout(messageTimer);
  appMessage.textContent = message;
  appMessage.className = `app-message${type === "warning" ? " warning" : type === "error" ? " error" : type === "urgent" ? " urgent" : ""}`;
  appMessage.hidden = false;
  messageTimer = window.setTimeout(() => {
    appMessage.hidden = true;
  }, 9000);
}

function setView(viewName) {
  document.querySelectorAll(".view").forEach((view) => {
    view.hidden = view.id !== `view-${viewName}`;
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    const active = button.dataset.view === viewName;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (viewName === "history") renderHistory();
  window.scrollTo(0, 0);
}

function startOfWeek(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function sumExpenses(expenses) {
  return expenses.reduce((sum, expense) => sum + expense.amount, 0);
}

function expensesBetween(start, end) {
  const startString = localDateString(start);
  const endString = localDateString(end);
  return state.expenses.filter((expense) => expense.date >= startString && expense.date <= endString);
}

function getBudgetPeriod() {
  const today = new Date();
  if (state.preferences.allowanceType === "daily") {
    const date = localDateString(today);
    return {
      key: `daily-${date}`,
      label: "today",
      expenses: state.expenses.filter((expense) => expense.date === date)
    };
  }
  const start = startOfWeek(today);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return {
    key: `weekly-${localDateString(start)}`,
    label: "this week",
    expenses: expensesBetween(start, end)
  };
}

function renderDashboard() {
  const today = new Date();
  const hour = today.getHours();
  document.querySelector("#greeting-heading").textContent =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const todayString = localDateString(today);
  const weekStart = startOfWeek(today);
  const weekExpenses = expensesBetween(weekStart, today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthExpenses = expensesBetween(monthStart, today);

  document.querySelector("#today-total").textContent = formatCurrency(
    sumExpenses(state.expenses.filter((expense) => expense.date === todayString))
  );
  document.querySelector("#week-total").textContent = formatCurrency(sumExpenses(weekExpenses));
  document.querySelector("#month-total").textContent = formatCurrency(sumExpenses(monthExpenses));

  const allowanceAmount = document.querySelector("#allowance-heading");
  const allowanceDetail = document.querySelector("#allowance-detail");
  const allowanceCard = document.querySelector("#allowance-card");
  const progress = document.querySelector("#home-budget-progress");
  const progressFill = document.querySelector("#home-budget-progress-fill");
  const progressLabel = document.querySelector("#home-budget-progress-label");
  if (state.preferences.allowanceType && state.preferences.allowance) {
    const period = getBudgetPeriod();
    const spent = sumExpenses(period.expenses);
    const remaining = state.preferences.allowance - spent;
    const ratio = spent / state.preferences.allowance;
    const percentage = Math.min(100, ratio * 100);
    const status = ratio >= 1 ? "over" : ratio >= 0.7 ? "warning" : "";
    allowanceAmount.textContent = formatCurrency(remaining);
    allowanceAmount.classList.toggle("over-budget", remaining < 0);
    allowanceDetail.textContent = remaining >= 0
      ? `You have ${formatCurrency(remaining)} left for ${period.label}.`
      : `You are ${formatCurrency(Math.abs(remaining))} over your ${period.label} allowance.`;
    progress.hidden = false;
    progress.setAttribute("aria-valuenow", String(Math.round(percentage)));
    progress.setAttribute("aria-valuetext", `${Math.round(percentage)} percent used`);
    progressFill.style.width = `${percentage}%`;
    progressFill.className = `home-budget-progress-fill${status ? ` ${status}` : ""}`;
    progressLabel.hidden = false;
    progressLabel.textContent = `${formatCurrency(spent)} of ${formatCurrency(state.preferences.allowance)} used`;
    allowanceCard.querySelector(".button").textContent = "Change budget";
  } else {
    allowanceAmount.textContent = "Set up your allowance";
    allowanceAmount.classList.remove("over-budget");
    allowanceDetail.textContent = "Choose a daily or weekly allowance to see how much you have left.";
    progress.hidden = true;
    progressLabel.hidden = true;
    allowanceCard.querySelector(".button").textContent = "Set up budget";
  }

  renderWeeklyChart();
  renderExpenseList(document.querySelector("#recent-list"), [...state.expenses]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 5), "No expenses recorded yet. Add your first expense when you are ready.");
}

function renderWeeklyChart() {
  const chart = document.querySelector("#weekly-chart");
  chart.replaceChildren();
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    const date = localDateString(day);
    days.push({
      date,
      day,
      amount: sumExpenses(state.expenses.filter((expense) => expense.date === date))
    });
  }
  const maximum = Math.max(0, ...days.map((day) => day.amount));
  const labels = days.map((item) => `${item.day.toLocaleDateString(undefined, { weekday: "long" })}: ${formatCurrency(item.amount)}`);
  chart.setAttribute("aria-label", `Spending for the last seven days. ${labels.join(". ")}`);

  days.forEach(({ day, amount }) => {
    const column = document.createElement("div");
    column.className = "chart-day";
    column.setAttribute("aria-hidden", "true");

    const value = document.createElement("span");
    value.className = "chart-value";
    value.textContent = formatCurrency(amount);

    const track = document.createElement("span");
    track.className = "chart-bar-track";
    const bar = document.createElement("span");
    bar.className = "chart-bar";
    bar.style.height = maximum > 0 ? `${Math.max(4, amount / maximum * 100)}%` : "3px";
    track.append(bar);

    const label = document.createElement("span");
    label.textContent = day.toLocaleDateString(undefined, { weekday: "short" });
    column.append(value, track, label);
    chart.append(column);
  });
}

function createExpenseItem(expense, showActions) {
  const item = document.createElement("article");
  item.className = "expense-item";

  const details = document.createElement("div");
  const description = document.createElement("p");
  description.className = "expense-description";
  description.textContent = expense.description;
  const meta = document.createElement("div");
  meta.className = "expense-meta";
  const category = document.createElement("span");
  category.className = "category-label";
  const icon = document.createElement("span");
  icon.className = `category-icon category-${CATEGORIES.indexOf(expense.category)}`;
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = CATEGORY_ICONS[expense.category] || CATEGORY_ICONS.Shopping;
  category.textContent = expense.category;
  category.prepend(icon);
  const date = document.createElement("span");
  date.textContent = formatDate(expense.date);
  meta.append(category, date);
  details.append(description, meta);

  const side = document.createElement("div");
  side.className = "expense-side";
  const amount = document.createElement("p");
  amount.className = "expense-amount";
  amount.textContent = formatCurrency(expense.amount);
  side.append(amount);

  if (showActions) {
    const actions = document.createElement("div");
    actions.className = "expense-actions";
    const editButton = document.createElement("button");
    editButton.className = "button button-secondary";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.setAttribute("aria-label", `Edit ${expense.description}`);
    editButton.addEventListener("click", () => editExpense(expense.id));
    const deleteButton = document.createElement("button");
    deleteButton.className = "button button-secondary";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${expense.description}`);
    deleteButton.addEventListener("click", () => deleteExpense(expense.id));
    actions.append(editButton, deleteButton);
    side.append(actions);
  }
  item.append(details, side);
  return item;
}

function renderExpenseList(container, expenses, emptyMessage, showActions = false) {
  container.replaceChildren();
  if (expenses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }
  expenses.forEach((expense) => container.append(createExpenseItem(expense, showActions)));
}

function renderHistory() {
  const search = document.querySelector("#search-expenses").value.trim().toLocaleLowerCase();
  const category = document.querySelector("#filter-category").value;
  const from = document.querySelector("#filter-from").value;
  const to = document.querySelector("#filter-to").value;
  const error = document.querySelector("#filter-error");
  error.hidden = true;
  if (from && to && from > to) {
    error.textContent = "The start date must be the same as or earlier than the end date.";
    error.hidden = false;
  }

  const expenses = [...state.expenses]
    .filter((expense) => !search || expense.description.toLocaleLowerCase().includes(search))
    .filter((expense) => !category || expense.category === category)
    .filter((expense) => !from || expense.date >= from)
    .filter((expense) => !to || expense.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  document.querySelector("#history-total").textContent =
    `${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"} shown - ${formatCurrency(sumExpenses(expenses))} total`;
  const today = localDateString();
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartString = localDateString(monthStart);
  document.querySelector("#history-today-total").textContent = formatCurrency(
    sumExpenses(state.expenses.filter((expense) => expense.date === today))
  );
  document.querySelector("#history-month-total").textContent = formatCurrency(
    sumExpenses(state.expenses.filter((expense) => expense.date >= monthStartString && expense.date <= today))
  );
  const historyList = document.querySelector("#history-list");
  historyList.replaceChildren();
  if (expenses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = state.expenses.length === 0
      ? "Your recorded expenses will appear here."
      : "No expenses match these filters.";
    historyList.append(empty);
    return;
  }
  const todayDate = new Date();
  const todayString = localDateString(todayDate);
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayString = localDateString(yesterdayDate);
  const groups = new Map();
  expenses.forEach((expense) => {
    const label = expense.date === todayString
      ? "Today"
      : expense.date === yesterdayString
        ? "Yesterday"
        : "Previous Days";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(expense);
  });
  groups.forEach((items, label) => {
    const group = document.createElement("section");
    group.className = "history-group";
    const heading = document.createElement("h3");
    heading.textContent = label;
    const list = document.createElement("div");
    list.className = "expense-list";
    renderExpenseList(list, items, "", true);
    group.append(heading, list);
    historyList.append(group);
  });
}

function renderBudget() {
  const typeInput = document.querySelector("#allowance-type");
  const allowanceInput = document.querySelector("#allowance-amount");
  if (state.preferences.allowanceType) typeInput.value = state.preferences.allowanceType;
  if (state.preferences.allowance) allowanceInput.value = state.preferences.allowance.toFixed(2);

  const summary = document.querySelector("#budget-summary-card");
  summary.replaceChildren();
  if (!state.preferences.allowanceType || !state.preferences.allowance) {
    const heading = document.createElement("h2");
    heading.textContent = "Your budget summary";
    const text = document.createElement("p");
    text.className = "muted";
    text.textContent = "Set a daily or weekly allowance above to start tracking your budget.";
    summary.append(heading, text);
    return;
  }

  const period = getBudgetPeriod();
  const spent = sumExpenses(period.expenses);
  const allowance = state.preferences.allowance;
  const remaining = allowance - spent;
  const ratio = spent / allowance;
  const percentage = Math.min(100, ratio * 100);
  const status = ratio >= 1 ? "over" : ratio >= 0.7 ? "warning" : "";
  const heading = document.createElement("h2");
  heading.textContent = `${state.preferences.allowanceType === "daily" ? "Daily" : "Weekly"} allowance`;
  const ring = document.createElement("div");
  ring.className = `budget-ring${status ? ` ${status}` : ""}`;
  ring.style.setProperty("--progress", `${percentage}%`);
  ring.setAttribute("role", "progressbar");
  ring.setAttribute("aria-label", "Allowance used");
  ring.setAttribute("aria-valuemin", "0");
  ring.setAttribute("aria-valuemax", "100");
  ring.setAttribute("aria-valuenow", String(Math.min(100, Math.round(percentage))));
  const ringCenter = document.createElement("div");
  ringCenter.className = "budget-ring-center";
  const ringValue = document.createElement("strong");
  ringValue.textContent = `${Math.round(percentage)}%`;
  const ringCaption = document.createElement("span");
  ringCaption.textContent = "used";
  ringCenter.append(ringValue, ringCaption);
  ring.append(ringCenter);
  const numbers = document.createElement("div");
  numbers.className = `budget-numbers${status ? ` ${status}` : ""}`;
  const spentText = document.createElement("span");
  spentText.textContent = `${formatCurrency(spent)} spent out of ${formatCurrency(allowance)}`;
  const leftText = document.createElement("span");
  leftText.textContent = remaining >= 0
    ? `${formatCurrency(remaining)} left ${period.label}`
    : `${formatCurrency(Math.abs(remaining))} over your allowance`;
  const statusText = document.createElement("p");
  statusText.className = `budget-status${status ? ` ${status}` : ""}`;
  statusText.textContent = ratio >= 1
    ? "Your allowance has been reached."
    : ratio >= 0.7
      ? "You are getting close to your allowance."
      : "You are within your allowance.";
  summary.append(heading, ring, numbers);
  numbers.append(spentText, leftText);
  summary.append(statusText);
}

function renderCategoryChart() {
  const periodInput = document.querySelector("#category-chart-period");
  const chart = document.querySelector("#category-pie-chart");
  const legend = document.querySelector("#category-chart-legend");
  const period = periodInput.value;
  const today = new Date();
  const todayString = localDateString(today);
  let periodLabel;
  let expenses;

  if (period === "daily") {
    periodLabel = "today";
    expenses = state.expenses.filter((expense) => expense.date === todayString);
  } else if (period === "monthly") {
    periodLabel = "this month";
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    expenses = expensesBetween(monthStart, today);
  } else {
    periodLabel = "this week";
    expenses = expensesBetween(startOfWeek(today), today);
  }

  const allCategoryTotals = CATEGORIES.map((category, index) => ({
    category,
    amount: sumExpenses(expenses.filter((expense) => expense.category === category)),
    color: CATEGORY_CHART_COLORS[index]
  }));
  const categoryTotals = allCategoryTotals.filter((item) => item.amount > 0);
  const total = sumExpenses(expenses);
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 240 240");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", `Total spent ${formatCurrency(total)} ${periodLabel}`);
  const centerX = 120;
  const centerY = 120;
  const outerRadius = 100;
  const innerRadius = 56;
  let startAngle = -90;

  function selectCategory(category) {
    selectedChartCategory = category;
    svg.querySelectorAll("[data-chart-category]").forEach((slice) => {
      slice.setAttribute("aria-pressed", String(slice.dataset.chartCategory === category));
      slice.classList.toggle("selected", slice.dataset.chartCategory === category);
    });
    legend.querySelectorAll("[data-chart-category]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.chartCategory === category));
    });
  }

  function addSliceInteraction(slice, category) {
    slice.dataset.chartCategory = category;
    slice.setAttribute("role", "button");
    slice.setAttribute("tabindex", "0");
    slice.setAttribute("aria-pressed", String(selectedChartCategory === category));
    const categoryAmount = categoryTotals.find((item) => item.category === category).amount;
    slice.setAttribute("aria-label", `${category}: ${formatCurrency(categoryAmount)} (${(categoryAmount / total * 100).toFixed(1)}%). Highlight this category.`);
    slice.classList.toggle("selected", selectedChartCategory === category);
    slice.addEventListener("click", () => selectCategory(category));
    slice.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCategory(category);
      }
    });
  }

  categoryTotals.forEach((item) => {
    const slice = document.createElementNS(svgNamespace, categoryTotals.length === 1 ? "circle" : "path");
    slice.setAttribute("fill", item.color);
    if (categoryTotals.length === 1) {
      slice.setAttribute("cx", String(centerX));
      slice.setAttribute("cy", String(centerY));
      slice.setAttribute("r", String(outerRadius));
    } else {
      const endAngle = startAngle + item.amount / total * 360;
      const toPoint = (radius, angle) => {
        const radians = angle * Math.PI / 180;
        return {
          x: centerX + radius * Math.cos(radians),
          y: centerY + radius * Math.sin(radians)
        };
      };
      const outerStart = toPoint(outerRadius, startAngle);
      const outerEnd = toPoint(outerRadius, endAngle);
      const innerEnd = toPoint(innerRadius, endAngle);
      const innerStart = toPoint(innerRadius, startAngle);
      const largeArc = endAngle - startAngle > 180 ? 1 : 0;
      slice.setAttribute("d", [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
        "Z"
      ].join(" "));
      startAngle = endAngle;
    }
    addSliceInteraction(slice, item.category);
    svg.append(slice);
  });

  if (categoryTotals.length === 0) {
    const emptyCircle = document.createElementNS(svgNamespace, "circle");
    emptyCircle.setAttribute("cx", String(centerX));
    emptyCircle.setAttribute("cy", String(centerY));
    emptyCircle.setAttribute("r", String(outerRadius));
    emptyCircle.setAttribute("fill", "#e5ebf1");
    svg.append(emptyCircle);
  }

  const centerCircle = document.createElementNS(svgNamespace, "circle");
  centerCircle.setAttribute("cx", String(centerX));
  centerCircle.setAttribute("cy", String(centerY));
  centerCircle.setAttribute("r", String(innerRadius));
  centerCircle.setAttribute("fill", "#fff");
  centerCircle.setAttribute("pointer-events", "none");
  svg.append(centerCircle);

  const centerAmount = document.createElementNS(svgNamespace, "text");
  centerAmount.setAttribute("x", String(centerX));
  centerAmount.setAttribute("y", "115");
  centerAmount.setAttribute("text-anchor", "middle");
  centerAmount.setAttribute("textLength", "100");
  centerAmount.setAttribute("lengthAdjust", "spacingAndGlyphs");
  centerAmount.setAttribute("class", "category-chart-center-amount");
  centerAmount.setAttribute("pointer-events", "none");
  centerAmount.textContent = formatCurrency(total);
  const centerLabel = document.createElementNS(svgNamespace, "text");
  centerLabel.setAttribute("x", String(centerX));
  centerLabel.setAttribute("y", "138");
  centerLabel.setAttribute("text-anchor", "middle");
  centerLabel.setAttribute("class", "category-chart-center-label");
  centerLabel.setAttribute("pointer-events", "none");
  centerLabel.textContent = "total spent";
  svg.append(centerAmount, centerLabel);
  chart.replaceChildren(svg);

  legend.replaceChildren();
  allCategoryTotals.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-chart-legend-item";
    button.dataset.chartCategory = item.category;
    button.disabled = item.amount === 0;
    button.setAttribute("aria-pressed", String(selectedChartCategory === item.category));
    const swatch = document.createElement("span");
    swatch.className = "category-chart-swatch";
    swatch.style.backgroundColor = item.color;
    swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    const percentage = total > 0 ? (item.amount / total * 100).toFixed(1) : "0.0";
    label.textContent = `${item.category} - ${formatCurrency(item.amount)} (${percentage}%)`;
    button.append(swatch, label);
    if (item.amount > 0) button.addEventListener("click", () => selectCategory(item.category));
    legend.append(button);
  });

  if (categoryTotals.length === 0) {
    selectedChartCategory = null;
    return;
  }

  if (!categoryTotals.some((item) => item.category === selectedChartCategory)) {
    selectedChartCategory = null;
  } else {
    selectCategory(selectedChartCategory);
  }
}

function suggestCategory(description) {
  const text = description.toLocaleLowerCase();
  const rules = [
    ["Food and Drinks", ["mcdonald", "burger", "lunch", "breakfast", "dinner", "coffee", "restaurant", "cafe", "café", "pizza", "takeaway", "sandwich", "snack", "drink", "bakery"]],
    ["Groceries", ["grocer", "supermarket", "food shop", "produce", "walmart", "costco", "aldi", "tesco", "market"]],
    ["Transportation", ["bus", "train", "taxi", "uber", "lyft", "fuel", "gas station", "parking", "subway", "fare"]],
    ["Healthcare", ["doctor", "dentist", "pharmacy", "medicine", "hospital", "clinic", "prescription", "health"]],
    ["Bills and Utilities", ["electric", "electricity", "water bill", "gas bill", "internet", "phone bill", "utility", "rent", "insurance"]],
    ["Entertainment", ["movie", "cinema", "concert", "theatre", "theater", "game", "museum", "streaming"]],
    ["Shopping", ["clothes", "clothing", "shoes", "book", "store", "shop", "purchase", "amazon"]]
  ];
  for (const [category, keywords] of rules) {
    if (keywords.some((keyword) => text.includes(keyword))) return category;
  }
  return "Shopping";
}

function validateExpense(description, amount, date) {
  if (!description) return "Please enter a description.";
  if (description.length > 120) return "Keep the description to 120 characters or fewer.";
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) return "Enter an amount greater than $0 and no more than $99,999,999.99.";
  if (!isValidDateString(date)) return "Choose a valid date for this expense.";
  if (date > localDateString()) return "The expense date cannot be in the future.";
  if (!CATEGORIES.includes(categoryInput.value)) return "Choose a category from the list.";
  return "";
}

function resetExpenseForm() {
  editingExpenseId = null;
  pendingReceiptFingerprint = null;
  expenseForm.reset();
  clearReceiptSelection();
  dateInput.value = localDateString();
  document.querySelector("#expense-form-heading").textContent = "Add an expense";
  document.querySelector("#save-expense-button").textContent = "Save expense";
  document.querySelector("#cancel-edit-button").hidden = true;
}

function editExpense(id) {
  const expense = state.expenses.find((item) => item.id === id);
  if (!expense) {
    showMessage("That expense could not be found. Refresh the history and try again.", "error");
    return;
  }
  editingExpenseId = id;
  descriptionInput.value = expense.description;
  amountInput.value = expense.amount.toFixed(2);
  dateInput.value = expense.date;
  categoryInput.value = expense.category;
  document.querySelector("#expense-form-heading").textContent = "Edit this expense";
  document.querySelector("#save-expense-button").textContent = "Save changes";
  document.querySelector("#cancel-edit-button").hidden = false;
  setView("add");
  descriptionInput.focus();
}

function deleteExpense(id) {
  const expense = state.expenses.find((item) => item.id === id);
  if (!expense) {
    showMessage("That expense could not be found. Refresh the history and try again.", "error");
    return;
  }
  if (!window.confirm(`Delete "${expense.description}" (${formatCurrency(expense.amount)})?`)) return;
  state.expenses = state.expenses.filter((item) => item.id !== id);
  const saved = saveState();
  renderAll();
  showMessage(saved ? "Expense deleted." : "Expense deleted for this session, but it could not be saved on this device.", saved ? "success" : "error");
}

expenseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const description = descriptionInput.value.trim();
  const amount = Number(amountInput.value);
  const date = dateInput.value;
  const category = categoryInput.value;
  const validationMessage = validateExpense(description, amount, date);
  if (validationMessage) {
    showMessage(validationMessage, "error");
    return;
  }

  if (editingExpenseId) {
    const expense = state.expenses.find((item) => item.id === editingExpenseId);
    if (!expense) {
      showMessage("That expense could not be found. Your changes were not saved.", "error");
      resetExpenseForm();
      return;
    }
    Object.assign(expense, { description, amount, date, category });
  } else {
    if (
      pendingReceiptFingerprint &&
      state.expenses.some(
        (expense) => expense.receiptFingerprint === pendingReceiptFingerprint
      )
    ) {
      showMessage("This receipt has already been saved. It was not added again.", "warning");
      receiptStatus.textContent = "This receipt has already been saved.";
      return;
    }

    const expense = {
      id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      description,
      amount,
      date,
      category
    };
    if (pendingReceiptFingerprint) {
      expense.receiptFingerprint = pendingReceiptFingerprint;
    }
    state.expenses.push(expense);
  }
  const wasEditing = Boolean(editingExpenseId);
  const saved = saveState();
  resetExpenseForm();
  renderAll();
  setView("home");
  checkBudgetThresholds();
  showMessage(
    saved
      ? wasEditing ? "Your expense was updated." : "Expense saved. Your spending summary has been updated."
      : "This change is available for this session, but could not be saved on this device.",
    saved ? "success" : "error"
  );
});

document.querySelector("#cancel-edit-button").addEventListener("click", () => {
  resetExpenseForm();
  setView("history");
});

document.querySelector("#category-chart-period").addEventListener("change", () => {
  selectedChartCategory = null;
  renderCategoryChart();
});

descriptionInput.addEventListener("input", () => {
  categoryInput.value = suggestCategory(descriptionInput.value);
});

budgetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const allowanceType = document.querySelector("#allowance-type").value;
  const allowance = Number(document.querySelector("#allowance-amount").value);
  if (!["daily", "weekly"].includes(allowanceType)) {
    showMessage("Choose a daily or weekly allowance.", "error");
    return;
  }
  if (!Number.isFinite(allowance) || allowance <= 0 || allowance > 99999999.99) {
    showMessage("Enter an allowance greater than $0 and no more than $99,999,999.99.", "error");
    return;
  }
  state.preferences.allowanceType = allowanceType;
  state.preferences.allowance = allowance;
  const saved = saveState();
  renderAll();
  showMessage(saved ? "Your allowance has been saved. We will calculate what is left for you." : "Your allowance is set for this session, but could not be saved on this device.", saved ? "success" : "error");
  checkBudgetThresholds();
});

function checkBudgetThresholds() {
  if (!state.preferences.allowanceType || !state.preferences.allowance) return;
  const period = getBudgetPeriod();
  const spent = sumExpenses(period.expenses);
  const ratio = spent / state.preferences.allowance;
  const thresholds = [
    { percent: 70, type: "warning" },
    { percent: 90, type: "urgent" },
    { percent: 100, type: "full" }
  ];
  let changed = false;
  thresholds.forEach(({ percent, type }) => {
    const alertKey = `${period.key}-${state.preferences.allowance}-${percent}`;
    if (ratio < percent / 100 || state.preferences.budgetAlerts[alertKey]) return;
    state.preferences.budgetAlerts[alertKey] = true;
    changed = true;
    const remaining = state.preferences.allowance - spent;
    const alertHeading = type === "urgent" ? "Urgent: " : type === "warning" ? "Warning: " : "";
    let message = `${alertHeading}You have spent ${formatCurrency(spent)} out of your ${formatCurrency(state.preferences.allowance)} ${state.preferences.allowanceType} allowance. `;
    if (type === "full") {
      message += `Your allowance has been fully used${remaining < 0 ? ` and you are ${formatCurrency(Math.abs(remaining))} over` : ""}.`;
    } else {
      message += remaining >= 0
        ? `You have ${formatCurrency(remaining)} remaining.`
        : `You are ${formatCurrency(Math.abs(remaining))} over your allowance.`;
    }
    showMessage(message, type === "warning" ? "warning" : type === "urgent" ? "urgent" : "error", true);
  });
  if (changed) saveState();
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.go));
});

["#search-expenses", "#filter-category", "#filter-from", "#filter-to"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", renderHistory);
  document.querySelector(selector).addEventListener("change", renderHistory);
});

document.querySelector("#clear-filters").addEventListener("click", () => {
  document.querySelector("#search-expenses").value = "";
  document.querySelector("#filter-category").value = "";
  document.querySelector("#filter-from").value = "";
  document.querySelector("#filter-to").value = "";
  renderHistory();
});

document.querySelector("#clear-all-data").addEventListener("click", () => {
  const confirmed = window.confirm("Clear all saved expenses, your budget, and settings from this browser? This cannot be undone.");
  if (!confirmed) return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Could not clear saved expense data:", error);
    showMessage("Your saved data could not be cleared. Check this browser's storage settings and try again.", "error");
    return;
  }

  storageReady = true;
  storageError = null;
  state = createDefaultState();
  resetExpenseForm();
  budgetForm.reset();
  document.querySelector("#search-expenses").value = "";
  document.querySelector("#filter-category").value = "";
  document.querySelector("#filter-from").value = "";
  document.querySelector("#filter-to").value = "";
  storageWarning.hidden = true;
  renderAll();
  showMessage("All saved expense data has been cleared.");
});

function applyDisplaySettings() {
  document.body.classList.toggle("large-text", state.preferences.largeText);
  document.querySelector("#large-text-toggle").checked = state.preferences.largeText;
}

document.querySelector("#large-text-toggle").addEventListener("change", (event) => {
  state.preferences.largeText = event.target.checked;
  applyDisplaySettings();
  const saved = saveState();
  showMessage(saved ? "Your text size has been updated." : "Your text size changed for this session, but could not be saved on this device.", saved ? "success" : "error");
});

function renderAll() {
  renderDashboard();
  renderHistory();
  renderBudget();
  renderCategoryChart();
  applyDisplaySettings();
}

dateInput.value = localDateString();
renderAll();
if (storageError) {
  storageWarning.textContent = "We could not read saved expenses on this device. Your existing records have not been changed. Please reload the page or check this browser's storage settings.";
  storageWarning.hidden = false;
}

/*
  RECEIPT PROCESSOR
  Supports:
  1. JPG, JPEG and PNG receipts using Tesseract.js OCR
  2. Text-based and scanned PDF receipts using PDF.js
*/

const ReceiptProcessor = (() => {
  let tesseractPromise;
  let pdfjsPromise;

  // Load OCR library only when needed
  async function loadTesseract() {
    if (!tesseractPromise) {
      tesseractPromise = import(
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js"
      ).then((module) => {
        const tesseract = module.default;
        if (!tesseract || typeof tesseract.createWorker !== "function") {
          throw new Error("The OCR library did not provide its worker function.");
        }
        return tesseract;
      }).catch((error) => {
        tesseractPromise = null;
        throw error;
      });
    }
    return tesseractPromise;
  }

  // Load PDF.js only when needed
  async function loadPDFJS() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"
      ).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc =
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
        return pdfjs;
      });
    }
    return pdfjsPromise;
  }

  async function prepareImageForOCR(file) {
    const imageURL = URL.createObjectURL(file);
    const image = new Image();

    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error(
          "This photo format could not be opened. Try choosing a JPG or PNG photo."
        ));
        image.src = imageURL;
      });

      const maxDimension = 2200;
      const scale = Math.min(
        1,
        maxDimension / Math.max(image.naturalWidth, image.naturalHeight)
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("This photo could not be prepared for scanning.");
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      URL.revokeObjectURL(imageURL);
    }
  }

  // Extract text from an image using OCR
  async function extractImageText(file, onProgress = () => {}) {
    const Tesseract = await loadTesseract();
    const image = await prepareImageForOCR(file);

    const worker = await Tesseract.createWorker("eng", 1, {
      logger: (message) => {
        if (message.status === "recognizing text") {
          onProgress(Math.round(message.progress * 100));
        }
      }
    });

    try {
      const result = await worker.recognize(image);
      return {
        text: result.data.text,
        confidence: result.data.confidence
      };
    } finally {
      await worker.terminate();
    }
  }

  // Extract text from a PDF
  async function extractPDFText(file, onProgress = () => {}) {
    const pdfjs = await loadPDFJS();
    const buffer = await file.arrayBuffer();

    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer)
    }).promise;

    let fullText = "";
    let totalConfidence = 0;
    let scannedPages = 0;

    if (pdf.numPages > 20) {
      throw new Error("Please upload a PDF containing no more than 20 pages.");
    }

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      const pageText = content.items
        .filter((item) => typeof item.str === "string")
        .map((item) => item.str)
        .join(" ");

      if (pageText.trim().length > 30) {
        fullText += "\n" + pageText;
      } else {
        // If the PDF is scanned, render the page and use OCR
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        await page.render({
          canvasContext: context,
          viewport
        }).promise;

        const Tesseract = await loadTesseract();
        const worker = await Tesseract.createWorker("eng");

        try {
          const result = await worker.recognize(canvas);
          fullText += "\n" + result.data.text;
          totalConfidence += result.data.confidence;
          scannedPages++;
        } finally {
          await worker.terminate();
        }
      }

      onProgress(Math.round((pageNumber / pdf.numPages) * 100));
    }

    return {
      text: fullText,
      confidence: scannedPages
        ? totalConfidence / scannedPages
        : null
    };
  }

  // Identify merchant, date and total amount
  function parseReceipt(text) {
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    // Find merchant name from the first useful lines
    const ignored = /receipt|invoice|tax invoice|cashier|thank you|tel:|phone|address|gst|u?nregistered/i;

    const merchant = lines.find(line =>
      line.length >= 2 &&
      line.length <= 65 &&
      !ignored.test(line) &&
      !/^\d+$/.test(line)
    ) || "Unknown merchant";

    // Detect dates in common receipt formats
    const datePatterns = [
      /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/,
      /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/
    ];

    let date = null;

    for (const line of lines) {
      for (let i = 0; i < datePatterns.length; i++) {
        const match = line.match(datePatterns[i]);
        if (!match) continue;

        let year, month, day;

        if (i === 0) {
          [, year, month, day] = match;
        } else {
          [, day, month, year] = match;
        }

        const candidate = new Date(
          Number(year),
          Number(month) - 1,
          Number(day)
        );

        if (
          candidate.getFullYear() === Number(year) &&
          candidate.getMonth() === Number(month) - 1 &&
          candidate.getDate() === Number(day) &&
          candidate <= new Date()
        ) {
          date = [
            year,
            String(month).padStart(2, "0"),
            String(day).padStart(2, "0")
          ].join("-");
          break;
        }
      }

      if (date) break;
    }

    // Find likely total amount
    const amountPattern =
      /(?:S\$|SGD|USD|\$)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})\b/g;

    const amounts = [];

    lines.forEach((line, index) => {
      let match;

      while ((match = amountPattern.exec(line)) !== null) {
        const amount = Number(match[1].replace(/,/g, ""));

        if (Number.isFinite(amount) && amount > 0) {
          amounts.push({
            amount,
            line,
            index
          });
        }
      }
    });

    // Prefer amounts appearing beside total-related keywords
    const totalKeywords = /grand total|total due|amount due|total|net total/i;

    const totalCandidates = amounts.filter(item =>
      totalKeywords.test(item.line)
    );

    // Otherwise use the largest detected amount as a suggestion
    const candidates = totalCandidates.length
      ? totalCandidates
      : amounts;

    const totalAmount = candidates.length
      ? candidates.reduce((largest, item) =>
          item.amount > largest.amount ? item : largest
        ).amount
      : null;

    return {
      merchant,
      date,
      amount: totalAmount,
      description: merchant,
      category: typeof suggestCategory === "function"
        ? suggestCategory(merchant + " " + text)
        : "Shopping",
      rawText: text
    };
  }

  function createReceiptFingerprint(text, receipt) {
    const normalizedText = [
      text,
      receipt.merchant,
      receipt.date || "",
      receipt.amount.toFixed(2)
    ].join(" ").toLocaleLowerCase().replace(/\s+/g, " ").trim();

    let firstHash = 2166136261;
    let secondHash = 2166136261 ^ 0x9e3779b9;

    for (let index = 0; index < normalizedText.length; index++) {
      const character = normalizedText.charCodeAt(index);
      firstHash = Math.imul(firstHash ^ character, 16777619);
      secondHash = Math.imul(secondHash ^ character, 2246822519);
    }

    return `receipt-${(firstHash >>> 0).toString(16)}-${(secondHash >>> 0).toString(16)}`;
  }

  // Main function: accepts an uploaded image or PDF
  async function processFile(file, onProgress = () => {}) {
    if (!file) {
      throw new Error("Please select a receipt first.");
    }

    const maxSize = 10 * 1024 * 1024;

    if (file.size > maxSize) {
      throw new Error("Please upload a file smaller than 10 MB.");
    }

    const fileName = file.name.toLowerCase();
    const isPDF =
      file.type === "application/pdf" || fileName.endsWith(".pdf");
    const isImage =
      file.type.startsWith("image/") ||
      /\.(jpe?g|png|heic|heif|webp)$/.test(fileName);

    if (!isPDF && !isImage) {
      throw new Error("Please upload a JPG, PNG or PDF receipt.");
    }

    onProgress(0);

    const result = isPDF
      ? await extractPDFText(file, onProgress)
      : await extractImageText(file, onProgress);

    if (!result.text.trim()) {
      throw new Error("No readable text was found in this receipt.");
    }

    const extracted = parseReceipt(result.text);

    if (!extracted.amount) {
      throw new Error(
        "We could not identify the total amount. Please enter it manually."
      );
    }

    return {
      ...extracted,
      receiptFingerprint: createReceiptFingerprint(result.text, extracted),
      confidence: result.confidence,
      fileName: file.name
    };
  }

  return {
    processFile,
    parseReceipt
  };
})();

window.ReceiptProcessor = ReceiptProcessor;

function applyReceiptToExpenseForm(receipt) {
  if (!receipt || !receipt.amount) {
    showMessage("Receipt information is incomplete.", "error");
    return;
  }

  editingExpenseId = null;
  pendingReceiptFingerprint = receipt.receiptFingerprint || null;

  descriptionInput.value = receipt.description || receipt.merchant;
  amountInput.value = receipt.amount.toFixed(2);
  dateInput.value = receipt.date || localDateString();
  categoryInput.value = CATEGORIES.includes(receipt.category)
    ? receipt.category
    : "Shopping";

  document.querySelector("#expense-form-heading").textContent =
    "Review scanned expense";
  document.querySelector("#save-expense-button").textContent =
    "Confirm and Save Expense";
  document.querySelector("#cancel-edit-button").hidden = false;

  setView("add");
  showMessage("Receipt scanned. Check the details before saving.");
  descriptionInput.focus();
}

const receiptFileInput = document.querySelector("#receipt-file");
const receiptCameraInput = document.querySelector("#receipt-camera-input");
const receiptPreview = document.querySelector("#receipt-preview");
const receiptFileName = document.querySelector("#receipt-file-name");
const removeReceiptButton = document.querySelector("#remove-receipt");
const takeReceiptPhotoButton = document.querySelector("#take-receipt-photo");
const receiptStatus = document.querySelector("#receipt-status");
let selectedReceiptFile = null;
let receiptScanVersion = 0;

function clearReceiptSelection() {
  receiptScanVersion++;
  selectedReceiptFile = null;
  receiptFileInput.value = "";
  receiptCameraInput.value = "";
  receiptPreview.hidden = true;
  receiptFileName.textContent = "";
  receiptStatus.textContent = "";
}

async function scanReceiptFile(file) {
  const scanVersion = ++receiptScanVersion;
  receiptStatus.textContent = "Scanning receipt...";

  try {
    const receipt = await window.ReceiptProcessor.processFile(file, (progress) => {
      if (scanVersion === receiptScanVersion) {
        receiptStatus.textContent = `Scanning receipt... ${progress}%`;
      }
    });

    if (scanVersion !== receiptScanVersion) return;
    receiptStatus.textContent = "Receipt scanned. Check the details below.";
    applyReceiptToExpenseForm(receipt);
  } catch (error) {
    if (scanVersion !== receiptScanVersion) return;
    console.error("Receipt scan failed:", error);
    receiptStatus.textContent =
      error instanceof Error ? error.message : "The receipt could not be scanned.";
  }
}

function selectReceiptFile(file) {
  if (!file) return;

  selectedReceiptFile = file;
  receiptFileName.textContent = file.name || "Photo from camera";
  receiptPreview.hidden = false;
  scanReceiptFile(file);
}

receiptFileInput.addEventListener("change", () => {
  selectReceiptFile(receiptFileInput.files[0]);
});

receiptCameraInput.addEventListener("change", () => {
  selectReceiptFile(receiptCameraInput.files[0]);
});

takeReceiptPhotoButton.addEventListener("click", () => {
  receiptCameraInput.click();
});

removeReceiptButton.addEventListener("click", clearReceiptSelection);
