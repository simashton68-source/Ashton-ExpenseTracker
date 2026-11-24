const STORAGE_KEY = "my-expense-tracker-v1";
const CATEGORIES = [
  "Food and Drinks",
  "Groceries",
  "Transportation",
  "Shopping",
  "Healthcare",
  "Bills and Utilities",
  "Entertainment",
  "Other Expenses"
];
function createDefaultState() {
  return {
    expenses: [],
    preferences: {
      allowanceType: null,
      allowance: null,
      budgetAlerts: {}
    }
  };
}

let storageReady = true;
let storageError = null;
let state = loadState();
let editingExpenseId = null;
let messageTimer = null;

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
      if (
        !expense ||
        typeof expense.id !== "string" ||
        typeof expense.description !== "string" ||
        typeof expense.amount !== "number" ||
        !Number.isFinite(expense.amount) ||
        expense.amount <= 0 ||
        !isValidDateString(expense.date) ||
        !CATEGORIES.includes(expense.category)
      ) {
        throw new Error("A saved expense is incomplete or invalid.");
      }
      return expense;
    });

    const savedPreferences = parsed.preferences;
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

function showMessage(message, type = "success", useBrowserNotification = false) {
  window.clearTimeout(messageTimer);
  appMessage.textContent = message;
  appMessage.className = `app-message${type === "warning" ? " warning" : type === "error" ? " error" : type === "urgent" ? " urgent" : ""}`;
  appMessage.hidden = false;
  if (useBrowserNotification && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("My Expense Tracker", { body: message });
    } catch (error) {
      console.error("Could not show a browser notification:", error);
    }
  }
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
  if (state.preferences.allowanceType && state.preferences.allowance) {
    const period = getBudgetPeriod();
    const spent = sumExpenses(period.expenses);
    const remaining = state.preferences.allowance - spent;
    allowanceAmount.textContent = formatCurrency(remaining);
    allowanceDetail.textContent = remaining >= 0
      ? `You have ${formatCurrency(remaining)} left for ${period.label}.`
      : `You are ${formatCurrency(Math.abs(remaining))} over your ${period.label} allowance.`;
    allowanceCard.querySelector(".button").textContent = "Change budget";
  } else {
    allowanceAmount.textContent = "Set up your allowance";
    allowanceDetail.textContent = "Choose a daily or weekly allowance to see how much you have left.";
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
  category.textContent = expense.category;
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
  renderExpenseList(
    document.querySelector("#history-list"),
    expenses,
    state.expenses.length === 0 ? "Your recorded expenses will appear here." : "No expenses match these filters.",
    true
  );
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
  const percentage = Math.min(100, spent / allowance * 100);
  const heading = document.createElement("h2");
  heading.textContent = `${state.preferences.allowanceType === "daily" ? "Daily" : "Weekly"} allowance`;
  const progress = document.createElement("div");
  progress.className = "budget-progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "Allowance used");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  progress.setAttribute("aria-valuenow", String(Math.min(100, Math.round(percentage))));
  const fill = document.createElement("div");
  fill.className = `budget-progress-fill${remaining < 0 ? " over" : ""}`;
  fill.style.width = `${percentage}%`;
  progress.append(fill);
  const numbers = document.createElement("div");
  numbers.className = "budget-numbers";
  const spentText = document.createElement("span");
  spentText.textContent = `${formatCurrency(spent)} spent out of ${formatCurrency(allowance)}`;
  const leftText = document.createElement("span");
  leftText.textContent = remaining >= 0
    ? `${formatCurrency(remaining)} left ${period.label}`
    : `${formatCurrency(Math.abs(remaining))} over your allowance`;
  summary.append(heading, progress, numbers);
  numbers.append(spentText, leftText);
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
  return "Other Expenses";
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
  expenseForm.reset();
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
    Object.assign(expense, { description, amount, date, category: categoryInput.value });
  } else {
    state.expenses.push({
      id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      description,
      amount,
      date,
      category: categoryInput.value
    });
  }
  const wasEditing = Boolean(editingExpenseId);
  const saved = saveState();
  resetExpenseForm();
  renderAll();
  setView("home");
  showMessage(
    saved
      ? wasEditing ? "Your expense was updated." : "Expense saved. Your spending summary has been updated."
      : "This change is available for this session, but could not be saved on this device.",
    saved ? "success" : "error"
  );
  checkBudgetThresholds();
});

document.querySelector("#cancel-edit-button").addEventListener("click", () => {
  resetExpenseForm();
  setView("history");
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

function renderAll() {
  renderDashboard();
  renderHistory();
  renderBudget();
}

dateInput.value = localDateString();
renderAll();
if (storageError) {
  storageWarning.textContent = "We could not read saved expenses on this device. Your existing records have not been changed. Please reload the page or check this browser's storage settings.";
  storageWarning.hidden = false;
}
