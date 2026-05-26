const STORAGE_KEY = "kate-budget-app-v1";

const defaultState = {
  settings: {
    monthlyGoalRemaining: 0,
    streakBest: 0,
    achievementsUnlocked: [],
    lastBackupAt: 0,
  },
  categories: ["餐飲", "交通", "生活用品", "美妝保養", "娛樂", "網路", "其他"].map((name) => ({
    id: crypto.randomUUID(),
    name,
    active: true,
  })),
  accounts: [
    { id: crypto.randomUUID(), name: "LINE Bank", type: "bank", usage: "spend", balance: 4338, includeInDaily: true },
    { id: crypto.randomUUID(), name: "永豐銀行", type: "bank", usage: "save", balance: 218, includeInDaily: false },
    { id: crypto.randomUUID(), name: "LINE Pay Money", type: "wallet", usage: "spend", balance: 849, includeInDaily: true },
    { id: crypto.randomUUID(), name: "現金", type: "cash", usage: "spend", balance: 1500, includeInDaily: true },
    { id: crypto.randomUUID(), name: "信用卡", type: "credit", usage: "credit", balance: 11623, includeInDaily: false },
  ],
  fixedExpenses: [
    { id: crypto.randomUUID(), name: "房租", amount: 6000, day: 31, accountName: "LINE Bank", paid: false, active: true, applied: false, accountId: "" },
    { id: crypto.randomUUID(), name: "ChatGPT", amount: 690, day: 20, accountName: "信用卡", paid: true, active: true, applied: true, accountId: "" },
    { id: crypto.randomUUID(), name: "Adobe Firefly", amount: 357, day: 18, accountName: "信用卡", paid: true, active: true, applied: true, accountId: "" },
    { id: crypto.randomUUID(), name: "Gemini Pro", amount: 650, day: 31, accountName: "信用卡", paid: false, active: true, applied: false, accountId: "" },
    { id: crypto.randomUUID(), name: "Manus", amount: 656, day: 31, accountName: "信用卡", paid: false, active: false, applied: false, accountId: "" },
    { id: crypto.randomUUID(), name: "學貸", amount: 6000, day: 15, accountName: "LINE Bank", paid: true, active: true, applied: true, accountId: "" },
  ],
  transactions: [],
};

const ICON_ASSETS = {
  "餐飲": "assets/icons/餐飲.png",
  "交通": "assets/icons/交通.png",
  "生活用品": "assets/icons/生活用品.png",
  "美妝保養": "assets/icons/美妝保養.png",
  "娛樂": "assets/icons/娛樂.png",
  "其他": "assets/icons/其他.png",
  "網路": "assets/icons/網路.png",
};

function applyIconMigration() {
  let changed = false;

  // 1. 「醫療保養」→「美妝保養」
  const renameMap = { "醫療保養": "美妝保養" };
  state.categories.forEach((category) => {
    if (renameMap[category.name]) {
      const newName = renameMap[category.name];
      // 如果已經有同名分類，跳過 rename，避免重複
      if (state.categories.some((c) => c.name === newName)) return;
      const oldName = category.name;
      category.name = newName;
      // 同步歷史交易紀錄
      state.transactions.forEach((tx) => {
        if (tx.category === oldName) tx.category = newName;
      });
      changed = true;
    }
  });

  // 2. 強制覆蓋 icon
  state.categories.forEach((category) => {
    if (ICON_ASSETS[category.name] && category.icon !== ICON_ASSETS[category.name]) {
      category.icon = ICON_ASSETS[category.name];
      changed = true;
    }
  });

  if (changed) saveState();
}

let state = loadState();
applyIconMigration();
let currentType = "expense";
let currentReportMonth = monthKey(new Date());

const money = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0,
});

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return normalizeState(structuredClone(defaultState));
  try {
    const parsed = JSON.parse(raw);
    return normalizeState({
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...parsed.settings },
    });
  } catch {
    return normalizeState(structuredClone(defaultState));
  }
}

function normalizeState(nextState) {
  nextState.categories = (nextState.categories || []).map((category) => {
    if (typeof category === "string") {
      return { id: crypto.randomUUID(), name: category, active: true, icon: "" };
    }
    return {
      id: category.id || crypto.randomUUID(),
      name: category.name || "未命名分類",
      active: category.active !== false,
      icon: typeof category.icon === "string" ? category.icon : "",
    };
  });
  nextState.settings.streakBest = Number(nextState.settings.streakBest || 0);
  nextState.settings.achievementsUnlocked = Array.isArray(nextState.settings.achievementsUnlocked)
    ? nextState.settings.achievementsUnlocked
    : [];
  nextState.settings.lastBackupAt = Number(nextState.settings.lastBackupAt || 0);
  nextState.accounts = (nextState.accounts || []).map((account) => ({
    ...account,
    initialDebt: ["credit", "loan"].includes(account.type) ? Number(account.initialDebt || 0) : 0,
  }));
  return nextState;
}

const SNAPSHOT_PREFIX = `${STORAGE_KEY}__snap__`;
const SNAPSHOT_DAYS_TO_KEEP = 14;

function saveState() {
  const json = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, json);
  // 自動 snapshot：每天最多存一份，最多保留 14 天
  try {
    const today = todayKey();
    const todayKeyName = `${SNAPSHOT_PREFIX}${today}`;
    localStorage.setItem(todayKeyName, json);
    // 清掉超過 14 天的舊快照
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - SNAPSHOT_DAYS_TO_KEEP);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(SNAPSHOT_PREFIX)) {
        const date = k.slice(SNAPSHOT_PREFIX.length);
        if (date < cutoffKey) localStorage.removeItem(k);
      }
    });
  } catch (err) {
    // localStorage 滿了就算了，主資料已經存好
  }
}

function listSnapshots() {
  const list = [];
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith(SNAPSHOT_PREFIX)) {
      list.push(k.slice(SNAPSHOT_PREFIX.length));
    }
  });
  return list.sort().reverse();
}

function restoreSnapshot(date) {
  const raw = localStorage.getItem(`${SNAPSHOT_PREFIX}${date}`);
  if (!raw) return false;
  try {
    state = normalizeState(JSON.parse(raw));
    saveState();
    renderAll();
    return true;
  } catch {
    return false;
  }
}

function formatMoney(value) {
  return money.format(Math.round(Number(value) || 0));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key, delta) {
  const [year, month] = key.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  return monthKey(next);
}

function monthRange(key) {
  const [year, month] = key.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start, end, days: end.getDate(), year, month };
}

function monthLabel(key) {
  const { year, month } = monthRange(key);
  const now = new Date();
  if (year === now.getFullYear() && month === now.getMonth() + 1) return "本月";
  if (key === shiftMonth(monthKey(now), -1)) return "上月";
  return `${year} 年 ${month} 月`;
}

function daysLeftInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, lastDay - now.getDate() + 1);
}

function accountById(id) {
  return state.accounts.find((account) => account.id === id);
}

function accountForBill(bill) {
  return accountById(bill.accountId) || state.accounts.find((account) => account.name === bill.accountName);
}

function creditAccount() {
  return state.accounts.find((account) => account.type === "credit");
}

function selectableAccounts({ includeCredit = true } = {}) {
  return state.accounts.filter((account) => {
    if (account.type === "loan") return false;
    if (!includeCredit && account.type === "credit") return false;
    return true;
  });
}

function availableCash() {
  return state.accounts
    .filter((account) => account.includeInDaily && !isDebtAccount(account))
    .reduce((sum, account) => sum + Number(account.balance || 0), 0);
}

function unpaidFixedTotal() {
  return state.fixedExpenses
    .filter((item) => item.active && !item.paid)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function dailyBudget() {
  const base = availableCash() - Number(state.settings.monthlyGoalRemaining || 0);
  return Math.floor(base / daysLeftInMonth());
}

function showView(name) {
  qsa(".view").forEach((view) => view.classList.toggle("is-active", view.id === `view-${name}`));
  qsa(".tab").forEach((button) => button.classList.toggle("is-active", button.dataset.viewTarget === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSelect(select, accounts, selectedId) {
  select.innerHTML = "";
  accounts.forEach((account) => {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = `${account.name} (${formatMoney(account.balance)})`;
    if (account.id === selectedId) option.selected = true;
    select.append(option);
  });
}

function renderCategorySelect() {
  const select = qs("#tx-category");
  select.innerHTML = "";
  state.categories.filter((category) => category.active).forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    select.append(option);
  });
}

function typeLabel(type) {
  return {
    expense: "支出",
    income: "收入",
    transfer: "轉帳",
    creditPayment: "繳款",
  }[type] || type;
}

function usageLabel(usage) {
  return {
    spend: "花費帳戶",
    save: "儲蓄帳戶",
    emergency: "緊急預備金",
    credit: "信用卡帳戶",
    debt: "貸款 / 負債",
    holding: "暫存帳戶",
  }[usage] || usage;
}

function typeName(type) {
  return {
    bank: "銀行戶頭",
    debit: "簽帳金融卡",
    wallet: "電子支付",
    cash: "現金",
    credit: "信用卡",
    loan: "貸款 / 分期",
  }[type] || type;
}

function isDebtAccount(account) {
  return account.type === "credit" || account.type === "loan";
}

function renderHome() {
  renderBackupBanner();
  const today = new Date();
  qs("#today-label").textContent = today.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  const daily = dailyBudget();
  qs("#home-title").textContent = formatMoney(Math.max(0, daily));
  qs("#daily-status").textContent = daily >= 0 ? "安全" : "需收斂";
  qs("#daily-status").className = `status-pill ${daily >= 0 ? "status-pill--safe" : "status-pill--danger"}`;
  qs("#daily-note").textContent = `以 ${formatMoney(availableCash())} 可用現金，扣掉儲蓄目標後，平均分配到本月剩餘 ${daysLeftInMonth()} 天。固定支出只提醒，不預扣。`;
  qs("#available-cash").textContent = formatMoney(availableCash());
  qs("#unpaid-fixed").textContent = formatMoney(unpaidFixedTotal());
  const debtAccs = state.accounts.filter(isDebtAccount);
  const debtBalance = debtAccs.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  qs("#credit-balance").textContent = formatMoney(debtBalance);
  const hasLoan = debtAccs.some((a) => a.type === "loan");
  qs("#debt-card-label").textContent = hasLoan ? "負債合計" : "信用卡未繳";
  qs("#debt-card-meta").textContent = hasLoan ? "信用卡 + 貸款餘額" : "繳款不重複算支出";

  const monthStatus = qs("#month-status");
  monthStatus.innerHTML = "";
  [
    ["可用現金", `${formatMoney(availableCash())} 列入今日可花`, "safe"],
    ["儲蓄目標剩餘", `${formatMoney(state.settings.monthlyGoalRemaining)} 先保留不花`, "warning"],
  ].forEach(([title, body, status]) => {
    const row = document.createElement("div");
    row.className = "timeline-item";
    row.innerHTML = `<span class="dot dot--${status}"></span><div><strong>${title}</strong><p>${body}</p></div><span class="date-chip">本月</span>`;
    monthStatus.append(row);
  });

  const streakValue = streakCurrent();
  const bestValue = streakBest();
  const streakWrap = qs("#streak-card");
  if (streakWrap) {
    const flame = streakValue >= 7 ? "🔥🔥🔥" : streakValue >= 3 ? "🔥🔥" : streakValue >= 1 ? "🔥" : "💤";
    const tone = streakValue >= 7 ? "streak-card--hot" : streakValue >= 1 ? "streak-card--warm" : "streak-card--cold";
    streakWrap.className = `streak-card ${tone}`;
    streakWrap.innerHTML = `
      <span class="streak-flame">${flame}</span>
      <div class="streak-text">
        <strong>${streakValue === 0 ? "今天還沒記" : `連續 ${streakValue} 天`}</strong>
        <small>最佳紀錄 ${bestValue} 天 · 自動扣款不算</small>
      </div>
    `;
  }

  const achWrap = qs("#achievement-strip");
  if (achWrap) {
    const unlockedSet = new Set(state.settings.achievementsUnlocked || []);
    qs("#achievement-count").textContent = `${unlockedSet.size} / ${ACHIEVEMENTS.length} 解鎖`;
    achWrap.innerHTML = "";
    ACHIEVEMENTS.forEach((a) => {
      const unlocked = unlockedSet.has(a.id);
      const badge = document.createElement("div");
      badge.className = `badge ${unlocked ? "is-unlocked" : "is-locked"}`;
      badge.innerHTML = `
        <span class="badge-emoji">${unlocked ? a.emoji : "🔒"}</span>
        <strong>${a.title}</strong>
        <small>${a.desc}</small>
      `;
      achWrap.append(badge);
    });
  }

  const recent = qs("#recent-transactions");
  recent.innerHTML = "";
  const rows = state.transactions.slice(-8).reverse();
  if (!rows.length) {
    recent.innerHTML = `<p class="empty-text">還沒有紀錄，先按「記一筆」開始。</p>`;
    return;
  }

  rows.forEach((tx) => recent.append(buildTransactionRow(tx)));
}

function renderAccounts() {
  const list = qs("#account-list");
  list.innerHTML = "";
  const spendTotal = state.accounts
    .filter((account) => account.includeInDaily && !isDebtAccount(account))
    .reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const saveTotal = state.accounts
    .filter((account) => !account.includeInDaily && !isDebtAccount(account))
    .reduce((sum, account) => sum + Number(account.balance || 0), 0);
  qs("#spend-account-total").textContent = formatMoney(spendTotal);
  qs("#save-account-total").textContent = formatMoney(saveTotal);

  const debtAccounts = state.accounts.filter(isDebtAccount);
  const debtOverview = qs("#debt-overview");
  if (debtAccounts.length === 0) {
    debtOverview.classList.add("is-hidden");
  } else {
    debtOverview.classList.remove("is-hidden");
    const balanceTotal = debtAccounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
    const initialTotal = debtAccounts.reduce((sum, a) => sum + Number(a.initialDebt || 0), 0);
    const paidTotal = Math.max(0, initialTotal - balanceTotal);
    const overallPct = initialTotal > 0 ? Math.min(100, Math.round((paidTotal / initialTotal) * 100)) : 0;
    qs("#debt-total-balance").textContent = formatMoney(balanceTotal);
    qs("#debt-total-meta").textContent = initialTotal > 0
      ? `已還 ${formatMoney(paidTotal)} / 起始 ${formatMoney(initialTotal)}`
      : "點各筆債務「設起始」開始追蹤進度";
    qs("#debt-total-pct").textContent = `${overallPct}%`;
    qs("#debt-total-fill").style.setProperty("--bar-width", `${overallPct}%`);
  }

  // 先排花費 / 儲蓄帳戶，再排負債類
  const sorted = [...state.accounts].sort((a, b) => {
    const order = (acc) => acc.type === "loan" ? 3 : acc.type === "credit" ? 2 : 1;
    return order(a) - order(b);
  });

  sorted.forEach((account) => {
    const card = document.createElement("article");
    const isDebt = isDebtAccount(account);
    card.className = `account-card ${isDebt ? "account-card--debt" : ""}`;
    const statusClass = isDebt ? "status-pill--danger" : account.includeInDaily ? "status-pill--safe" : "status-pill--quiet";
    const status = account.type === "credit" ? "待繳" : account.type === "loan" ? "貸款中" : account.includeInDaily ? "可花" : "保留";
    const progress = isDebt ? debtProgress(account) : null;
    const progressHTML = progress
      ? `
        <div class="debt-progress">
          <div class="debt-progress__head">
            <span>已還 ${progress.pct}%</span>
            <small>${formatMoney(progress.paid)} / ${formatMoney(progress.init)}</small>
          </div>
          <div class="debt-progress__track"><div class="debt-progress__fill" style="--bar-width: ${progress.pct}%"></div></div>
        </div>
      `
      : "";
    const debtAction = isDebt
      ? `<button class="mini-button" type="button" data-set-debt="${account.id}">${progress ? "改起始" : "設起始"}</button>`
      : "";
    card.innerHTML = `
      <div class="account-card__main">
        <p>${account.name}</p>
        <strong>${formatMoney(account.balance)}</strong>
        <small>${usageLabel(account.usage)} · ${typeName(account.type)} · ${account.includeInDaily ? "列入今日可花" : "不列入今日可花"}</small>
        ${progressHTML}
      </div>
      <div class="card-actions">
        <span class="status-pill ${statusClass}">${status}</span>
        <button class="mini-button" type="button" data-edit-account="${account.id}">調整</button>
        ${debtAction}
        <button class="mini-button mini-button--danger" type="button" data-long-delete-account="${account.id}">長按刪除</button>
      </div>
    `;
    list.append(card);
  });
}

function renderBills() {
  renderSelect(qs("#bill-account"), selectableAccounts(), qs("#bill-account").value);
  const list = qs("#bill-list");
  list.innerHTML = "";
  state.fixedExpenses.forEach((bill) => {
    const card = document.createElement("article");
    card.className = `bill-card ${bill.active ? "" : "is-disabled"}`;
    const statusClass = bill.paid ? "status-pill--safe" : bill.active ? "status-pill--warning" : "";
    const status = bill.paid ? "已繳" : bill.active ? "待繳" : "停用";
    card.innerHTML = `
      <div>
        <span class="status-pill ${statusClass}">${status}</span>
        <h3>${bill.name}</h3>
        <p>${bill.day} 日 · ${accountForBill(bill)?.name || bill.accountName || "未指定"}</p>
      </div>
      <div class="bill-actions">
        <strong>${formatMoney(bill.amount)}</strong>
        <button class="mini-button" type="button" data-toggle-bill-paid="${bill.id}">${bill.paid ? "改未繳" : "標已繳"}</button>
        <button class="mini-button mini-button--danger" type="button" data-long-delete-bill="${bill.id}">長按刪除</button>
      </div>
    `;
    list.append(card);
  });
}

function renderTransactionForm() {
  renderCategorySelect();
  const withCredit = selectableAccounts({ includeCredit: true });
  const withoutCredit = selectableAccounts({ includeCredit: false });
  const from = qs("#tx-from");
  const to = qs("#tx-to");

  let fromAccounts;
  let toAccounts = [];
  if (currentType === "income") {
    fromAccounts = state.accounts.filter((account) => !isDebtAccount(account));
  } else if (currentType === "transfer") {
    fromAccounts = withoutCredit;
    toAccounts = withoutCredit;
  } else if (currentType === "creditPayment") {
    fromAccounts = withoutCredit;
    toAccounts = state.accounts.filter((account) => isDebtAccount(account));
  } else {
    fromAccounts = withCredit;
  }

  renderSelect(from, fromAccounts, from.value);
  if (toAccounts.length) renderSelect(to, toAccounts, to.value);
  else to.innerHTML = "";

  renderAccountChips(qs("#tx-from-chips"), fromAccounts, "tx-from");
  if (toAccounts.length) renderAccountChips(qs("#tx-to-chips"), toAccounts, "tx-to");
  else qs("#tx-to-chips").innerHTML = "";

  renderCategoryGrid();

  qs("[data-expense-field]").classList.toggle("is-hidden", currentType !== "expense");
  qs("[data-to-field]").classList.toggle("is-hidden", !["transfer", "creditPayment"].includes(currentType));
  qs("#from-label").textContent = currentType === "income" ? "入帳帳戶" : currentType === "transfer" ? "轉出帳戶" : currentType === "creditPayment" ? "扣款帳戶" : "付款帳戶";
  qs("#to-label").textContent = currentType === "transfer" ? "轉入帳戶" : "繳款目標（信用卡 / 貸款）";
}

function renderAccountChips(host, accounts, selectId) {
  const select = qs(`#${selectId}`);
  host.innerHTML = "";
  if (!accounts.length) return;
  if (!accounts.some((account) => account.id === select.value)) {
    select.value = accounts[0].id;
  }
  accounts.forEach((account) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.chipId = account.id;
    chip.dataset.targetSelect = selectId;
    if (account.id === select.value) chip.classList.add("is-selected");
    chip.innerHTML = `<strong>${account.name}</strong><small>${formatMoney(account.balance)}</small>`;
    host.append(chip);
  });
}

function renderCategoryGrid() {
  const grid = qs("#tx-category-grid");
  if (!grid) return;
  const select = qs("#tx-category");
  grid.innerHTML = "";
  const actives = state.categories.filter((category) => category.active);
  if (!actives.length) {
    grid.innerHTML = `<p class="report-empty">尚無分類，先到設定 → 分類管理新增。</p>`;
    return;
  }
  if (!actives.some((category) => category.name === select.value)) {
    select.value = actives[0].name;
  }
  actives.forEach((category) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "category-card";
    card.dataset.categoryName = category.name;
    if (category.name === select.value) card.classList.add("is-selected");
    const iconHTML = category.icon
      ? renderIcon(category.icon)
      : `<span class="cat-icon-emoji">📌</span>`;
    card.innerHTML = `
      <span class="category-card__icon">${iconHTML}</span>
      <strong>${category.name}</strong>
    `;
    grid.append(card);
  });
}

function setAmountString(value) {
  const hidden = qs("#tx-amount");
  const display = qs("#amount-display");
  if (!hidden || !display) return;
  const next = String(value || "");
  hidden.dataset.amountStr = next;
  const clean = next.replace(/^0+(?=\d)/, "");
  hidden.value = clean || "";
  display.textContent = clean ? Number(clean).toLocaleString("zh-TW") : "0";
}

function setupKeypad() {
  setAmountString("");
  qsa(".keypad [data-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      const cur = qs("#tx-amount").dataset.amountStr || "";
      let next;
      if (key === "AC") next = "";
      else if (key === "back") next = cur.slice(0, -1);
      else next = (cur + key).slice(0, 12);
      setAmountString(next);
    });
  });
}

function renderSettings() {
  qs("#goal-input").value = state.settings.monthlyGoalRemaining || 0;
  renderCategoryManager();
  renderLastBackupInfo();
  renderSnapshotList();
}

function renderLastBackupInfo() {
  const el = qs("#last-backup-info");
  if (!el) return;
  const ts = Number(state.settings.lastBackupAt || 0);
  if (!ts) {
    el.textContent = "尚未匯出過備份";
    return;
  }
  const days = Math.floor((Date.now() - ts) / 86400000);
  const dateStr = new Date(ts).toLocaleDateString("zh-TW");
  el.textContent = `上次匯出：${dateStr}（${days} 天前）`;
}

function renderSnapshotList() {
  const list = qs("#snapshot-list");
  if (!list) return;
  list.innerHTML = "";
  const snaps = listSnapshots();
  if (!snaps.length) {
    list.innerHTML = `<p class="empty-text">還沒有快照。儲存資料就會自動產生。</p>`;
    return;
  }
  snaps.forEach((date) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "snapshot-row";
    row.dataset.snapshotDate = date;
    row.innerHTML = `
      <span>${date}</span>
      <small>還原</small>
    `;
    list.append(row);
  });
}

function renderBackupBanner() {
  const banner = qs("#backup-banner");
  if (!banner) return;
  const ts = Number(state.settings.lastBackupAt || 0);
  const hasData = state.transactions.length > 0;
  if (!hasData) {
    banner.classList.add("is-hidden");
    return;
  }
  const daysSince = ts ? Math.floor((Date.now() - ts) / 86400000) : null;
  if (ts === 0) {
    qs("#backup-banner-title").textContent = "從未匯出備份";
    qs("#backup-banner-sub").textContent = "建議到設定頁匯出 JSON，避免資料遺失";
    banner.classList.remove("is-hidden");
  } else if (daysSince >= 14) {
    qs("#backup-banner-title").textContent = `${daysSince} 天沒匯出備份`;
    qs("#backup-banner-sub").textContent = "iOS 有時會清掉本機資料，匯出 JSON 才安全";
    banner.classList.remove("is-hidden");
  } else {
    banner.classList.add("is-hidden");
  }
}

function renderCategoryManager() {
  const list = qs("#category-list");
  if (!list) return;
  list.innerHTML = "";

  state.categories.forEach((category) => {
    const used = state.transactions.some((tx) => tx.category === category.name);
    const row = document.createElement("article");
    row.className = `category-row ${category.active ? "" : "is-disabled"}`;
    const iconPreview = category.icon
      ? (isImageIcon(category.icon)
        ? `<img src="${category.icon}" alt="">`
        : `<span class="category-row__emoji">${category.icon}</span>`)
      : `<span class="category-row__placeholder">無</span>`;
    const emojiValue = !category.icon || isImageIcon(category.icon) ? "" : category.icon;
    row.innerHTML = `
      <div class="category-row__icon">
        <div class="category-row__preview" data-category-preview="${category.id}">${iconPreview}</div>
        <div class="category-row__icon-actions">
          <label class="mini-button category-row__upload">
            選圖檔
            <input type="file" accept="image/*" data-category-upload="${category.id}" hidden>
          </label>
          ${category.icon ? `<button class="mini-button mini-button--danger" type="button" data-category-clear-icon="${category.id}">清除</button>` : ""}
        </div>
      </div>
      <label class="field category-name-field">
        <span>分類名稱</span>
        <input type="text" value="${category.name}" data-category-name="${category.id}">
      </label>
      <label class="field category-emoji-field">
        <span>或貼一個 emoji</span>
        <input type="text" value="${emojiValue}" placeholder="🛒 🍱 🏍" data-category-emoji="${category.id}" maxlength="4">
      </label>
      <label class="toggle-row category-toggle">
        <input type="checkbox" ${category.active ? "checked" : ""} data-category-active="${category.id}">
        <span>
          <strong>${category.active ? "使用中" : "已停用"}</strong>
          <small>${used ? "已有紀錄，停用後舊資料仍保留。" : "尚未使用，可長按刪除。"}</small>
        </span>
      </label>
      <div class="category-actions">
        <button class="mini-button" type="button" data-save-category="${category.id}">儲存</button>
        ${used ? "" : `<button class="mini-button mini-button--danger" type="button" data-long-delete-category="${category.id}">長按刪除</button>`}
      </div>
    `;
    list.append(row);
  });
}

function isImageIcon(value) {
  if (!value) return false;
  return value.startsWith("data:") || value.startsWith("http") || value.startsWith("assets/") || /\.(svg|png|jpg|jpeg|webp|gif)$/i.test(value);
}

function categoryByName(name) {
  return state.categories.find((c) => c.name === name);
}

function renderIcon(value, fallback = "") {
  if (!value) return fallback ? `<span class="icon-fallback">${fallback}</span>` : "";
  if (isImageIcon(value)) return `<img src="${value}" alt="" class="cat-icon">`;
  return `<span class="cat-icon-emoji">${value}</span>`;
}

async function compressImageToDataURL(file, maxSize = 128) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL("image/png"));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function streakCurrent() {
  const manualDates = new Set(
    state.transactions
      .filter((tx) => !tx.auto && tx.date)
      .map((tx) => tx.date),
  );
  if (!manualDates.size) return 0;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  let cursor;
  if (manualDates.has(todayStr)) cursor = new Date(today);
  else if (manualDates.has(yesterdayStr)) cursor = new Date(yesterday);
  else return 0;
  let count = 0;
  while (manualDates.has(cursor.toISOString().slice(0, 10))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function streakBest() {
  const current = streakCurrent();
  const stored = Number(state.settings.streakBest || 0);
  if (current > stored) {
    state.settings.streakBest = current;
    return current;
  }
  return stored;
}

const ACHIEVEMENTS = [
  { id: "first-step", title: "第一步", emoji: "🌱", desc: "記下第一筆", check: () => state.transactions.length >= 1 },
  { id: "streak-3", title: "三天小火", emoji: "🔥", desc: "連續記帳 3 天", check: () => streakCurrent() >= 3 },
  { id: "streak-7", title: "週習慣", emoji: "📅", desc: "連續記帳 7 天", check: () => streakCurrent() >= 7 },
  { id: "streak-30", title: "月達人", emoji: "💎", desc: "連續記帳 30 天", check: () => streakCurrent() >= 30 },
  { id: "streak-100", title: "百日修煉", emoji: "🏆", desc: "連續記帳 100 天", check: () => streakCurrent() >= 100 },
  { id: "card-paid", title: "卡債清零", emoji: "🎉", desc: "信用卡餘額歸零", check: () => {
      const cards = state.accounts.filter((a) => a.type === "credit");
      return cards.length > 0 && cards.every((a) => Number(a.balance || 0) === 0);
    } },
  { id: "saved-10k", title: "存款破萬", emoji: "🏦", desc: "儲蓄帳戶累積 $10,000", check: () => {
      const total = state.accounts.filter((a) => a.usage === "save" || a.usage === "emergency")
        .reduce((sum, a) => sum + Number(a.balance || 0), 0);
      return total >= 10000;
    } },
  { id: "month-positive", title: "本月不爆", emoji: "⚖️", desc: "當月收入 ≥ 支出", check: () => {
      const key = monthKey(new Date());
      const inMonth = state.transactions.filter((tx) => (tx.date || "").startsWith(key));
      const income = inMonth.filter((tx) => tx.type === "income").reduce((s, tx) => s + Number(tx.amount || 0), 0);
      const expense = inMonth.filter((tx) => tx.type === "expense").reduce((s, tx) => s + Number(tx.amount || 0), 0);
      return income > 0 && income >= expense;
    } },
];

function syncAchievements() {
  const unlocked = new Set(state.settings.achievementsUnlocked || []);
  const newly = [];
  ACHIEVEMENTS.forEach((a) => {
    if (!unlocked.has(a.id) && a.check()) {
      unlocked.add(a.id);
      newly.push(a);
    }
  });
  state.settings.achievementsUnlocked = [...unlocked];
  return newly;
}

function debtProgress(account) {
  const init = Number(account.initialDebt || 0);
  const current = Number(account.balance || 0);
  if (init <= 0) return null;
  const paid = Math.max(0, init - current);
  const pct = Math.min(100, Math.round((paid / init) * 100));
  return { init, current, paid, pct };
}

function expensesInMonth(key) {
  return state.transactions.filter((tx) => tx.type === "expense" && (tx.date || "").startsWith(key));
}

function totalsByCategory(transactions) {
  const totals = new Map();
  transactions.forEach((tx) => {
    const name = tx.category || "未分類";
    const amount = Number(tx.amount || 0);
    totals.set(name, (totals.get(name) || 0) + amount);
  });
  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function renderReports() {
  const monthLabelEl = qs("#report-month-label");
  const monthSubEl = qs("#report-month-sub");
  if (!monthLabelEl) return;

  const { year, month, days, start } = monthRange(currentReportMonth);
  monthLabelEl.textContent = monthLabel(currentReportMonth);
  monthSubEl.textContent = `${year} / ${String(month).padStart(2, "0")}`;

  const current = expensesInMonth(currentReportMonth);
  const previous = expensesInMonth(shiftMonth(currentReportMonth, -1));
  const total = current.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const prevTotal = previous.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  qs("#report-total").textContent = formatMoney(total);
  qs("#report-count").textContent = current.length;
  qs("#report-daily").textContent = formatMoney(total / Math.max(1, days));

  const delta = qs("#report-delta");
  if (prevTotal === 0 && total === 0) {
    delta.textContent = "上月也沒有支出紀錄";
    delta.className = "report-delta";
  } else if (prevTotal === 0) {
    delta.textContent = `上月沒紀錄，本月 ${formatMoney(total)}`;
    delta.className = "report-delta report-delta--up";
  } else {
    const diff = total - prevTotal;
    const pct = Math.round((diff / prevTotal) * 100);
    const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
    delta.textContent = `比上月 ${arrow} ${Math.abs(pct)}%（${formatMoney(Math.abs(diff))}）`;
    delta.className = `report-delta ${diff > 0 ? "report-delta--up" : diff < 0 ? "report-delta--down" : ""}`;
  }

  const chart = qs("#report-category-chart");
  const byCategory = totalsByCategory(current);
  const prevByCategory = new Map(totalsByCategory(previous).map((row) => [row.name, row.amount]));
  chart.innerHTML = "";
  if (!byCategory.length) {
    chart.innerHTML = `<p class="report-empty">這個月還沒有支出紀錄。</p>`;
  } else {
    const max = byCategory[0].amount || 1;
    byCategory.forEach((row) => {
      const pct = Math.round((row.amount / total) * 100);
      const width = Math.round((row.amount / max) * 100);
      const bar = document.createElement("div");
      bar.className = "category-bar";
      const cat = categoryByName(row.name);
      const iconHTML = cat?.icon ? `<span class="category-bar__icon">${renderIcon(cat.icon)}</span>` : "";
      bar.innerHTML = `
        <div class="category-bar__head">
          <span>${iconHTML}${row.name} <small>${pct}%</small></span>
          <span class="category-bar__amount">${formatMoney(row.amount)}</span>
        </div>
        <div class="category-bar__track"><div class="category-bar__fill" style="--bar-width: ${width}%"></div></div>
      `;
      chart.append(bar);
    });
  }

  const top3 = qs("#report-top3");
  top3.innerHTML = "";
  if (!byCategory.length) {
    top3.innerHTML = `<p class="report-empty">沒有紀錄就沒有排行 ✨</p>`;
  } else {
    byCategory.slice(0, 3).forEach((row, index) => {
      const prevAmount = prevByCategory.get(row.name) || 0;
      const diff = row.amount - prevAmount;
      let deltaText = "上月沒紀錄";
      let deltaClass = "";
      if (prevAmount > 0) {
        const pct = Math.round((diff / prevAmount) * 100);
        const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
        deltaText = `${arrow} ${Math.abs(pct)}%`;
        deltaClass = diff > 0 ? "top3-row__delta--up" : diff < 0 ? "top3-row__delta--down" : "";
      }
      const row3 = document.createElement("div");
      row3.className = "top3-row";
      row3.innerHTML = `
        <span class="top3-rank">${index + 1}</span>
        <div>
          <strong>${row.name}</strong>
          <small>${formatMoney(row.amount)} · 上月 ${formatMoney(prevAmount)}</small>
        </div>
        <div class="top3-row__delta ${deltaClass}">
          <strong>${deltaText}</strong>
        </div>
      `;
      top3.append(row3);
    });
  }

  const dailyChart = qs("#report-daily-chart");
  dailyChart.innerHTML = "";
  qs("#report-daily-range").textContent = `1 ─ ${days} 日`;
  const daily = new Array(days).fill(0);
  current.forEach((tx) => {
    const day = Number((tx.date || "").slice(8, 10));
    if (day >= 1 && day <= days) daily[day - 1] += Number(tx.amount || 0);
  });
  const dailyMax = Math.max(...daily, 1);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === start.getFullYear() && today.getMonth() === start.getMonth();
  daily.forEach((amount, index) => {
    const bar = document.createElement("div");
    const height = amount > 0 ? Math.max(6, Math.round((amount / dailyMax) * 110)) : 4;
    bar.className = "daily-bar";
    if (amount === 0) bar.classList.add("is-empty");
    if (isCurrentMonth && index + 1 === today.getDate()) bar.classList.add("is-today");
    bar.style.setProperty("--bar-height", `${height}px`);
    bar.title = `${index + 1} 日 · ${formatMoney(amount)}`;
    dailyChart.append(bar);
  });
}

let historyFilters = {
  search: "",
  month: "all",
  type: "all",
  category: "all",
};

function buildTransactionRow(tx, options = {}) {
  const wrap = document.createElement("div");
  wrap.className = "swipe-row";
  wrap.dataset.txId = tx.id;

  const actions = document.createElement("div");
  actions.className = "swipe-row__actions";
  actions.innerHTML = `
    <button type="button" class="swipe-row__edit" data-edit-tx="${tx.id}">編輯</button>
    <button type="button" class="swipe-row__delete" data-delete-tx="${tx.id}">刪除</button>
  `;

  const content = document.createElement("div");
  content.className = "swipe-row__content transaction-row";

  const fallback = tx.type === "income" ? "收" : tx.type === "transfer" ? "轉" : tx.type === "creditPayment" ? "卡" : "花";
  const category = tx.type === "expense" ? categoryByName(tx.category) : null;
  const badgeContent = category?.icon
    ? renderIcon(category.icon, fallback)
    : `<span class="icon-fallback">${fallback}</span>`;
  const sign = tx.type === "income" ? "+" : tx.type === "transfer" ? "" : "-";
  const subtitle = options.showAccount
    ? `${tx.category || typeLabel(tx.type)} · ${accountById(tx.fromId)?.name || ""}${tx.toId ? ` → ${accountById(tx.toId)?.name || ""}` : ""}`
    : `${tx.category || typeLabel(tx.type)} · ${tx.date}`;

  content.innerHTML = `
    <span class="category-badge">${badgeContent}</span>
    <div>
      <strong>${tx.note || typeLabel(tx.type)}</strong>
      <p>${subtitle}</p>
    </div>
    <div class="tx-row-amount">
      <strong>${sign}${formatMoney(tx.amount)}</strong>
      ${options.showDate ? `<small>${tx.date}</small>` : ""}
    </div>
  `;

  wrap.append(actions, content);
  return wrap;
}

function deleteTransactionById(id) {
  const tx = state.transactions.find((item) => item.id === id);
  if (!tx) return;
  rollbackTransaction(tx);
  state.transactions = state.transactions.filter((item) => item.id !== id);
  saveState();
  renderAll();
}

function buildCSV(transactions) {
  const headers = ["標題", "日期", "類型", "金額", "簽名金額", "分類", "備註", "付款帳戶", "收款帳戶", "是否自動扣款", "月份", "年度"];
  const escape = (value) => {
    const str = String(value ?? "");
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const rows = [headers];
  transactions.forEach((tx) => {
    const amount = Number(tx.amount || 0);
    const signed = tx.type === "expense" ? -amount : amount;
    const fromAcc = accountById(tx.fromId);
    const toAcc = accountById(tx.toId);
    const date = tx.date || "";
    rows.push([
      `${date} ${tx.category || typeLabel(tx.type)} ${signed}`,
      date,
      typeLabel(tx.type),
      amount,
      signed,
      tx.category || "",
      tx.note || "",
      fromAcc?.name || "",
      toAcc?.name || "",
      tx.auto ? "Yes" : "No",
      date.slice(0, 7).replace("-", "/"),
      date.slice(0, 4),
    ]);
  });
  return "﻿" + rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportCSVAll() {
  const sorted = [...state.transactions].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  downloadCSV(`kate-budget-all-${todayKey()}.csv`, buildCSV(sorted));
}

function exportCSVMonth() {
  const month = monthKey(new Date());
  const filtered = state.transactions
    .filter((tx) => (tx.date || "").startsWith(month))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  downloadCSV(`kate-budget-${month}.csv`, buildCSV(filtered));
}

function matchesHistoryFilters(tx) {
  if (historyFilters.type !== "all" && tx.type !== historyFilters.type) return false;
  if (historyFilters.category !== "all" && tx.category !== historyFilters.category) return false;
  if (historyFilters.month === "current" && !(tx.date || "").startsWith(monthKey(new Date()))) return false;
  if (historyFilters.month === "prev" && !(tx.date || "").startsWith(shiftMonth(monthKey(new Date()), -1))) return false;
  if (historyFilters.month !== "all" && historyFilters.month !== "current" && historyFilters.month !== "prev") {
    if (!(tx.date || "").startsWith(historyFilters.month)) return false;
  }
  if (historyFilters.search) {
    const q = historyFilters.search.toLowerCase();
    const haystack = [
      tx.note,
      tx.category,
      accountById(tx.fromId)?.name,
      accountById(tx.toId)?.name,
      String(tx.amount),
    ].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function renderHistoryFilters() {
  // Month chips
  const monthChips = qs("#history-month-chips");
  if (!monthChips) return;
  const nowMonth = monthKey(new Date());
  const allMonths = [...new Set(state.transactions.map((tx) => (tx.date || "").slice(0, 7)))]
    .filter(Boolean)
    .sort()
    .reverse();
  const monthOptions = [
    { value: "all", label: "全部" },
    { value: "current", label: "本月" },
    { value: "prev", label: "上月" },
    ...allMonths
      .filter((m) => m !== nowMonth && m !== shiftMonth(nowMonth, -1))
      .map((m) => ({ value: m, label: m.replace("-", "/") })),
  ];
  monthChips.innerHTML = "";
  monthOptions.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-mini";
    btn.dataset.historyMonth = opt.value;
    btn.textContent = opt.label;
    if (historyFilters.month === opt.value) btn.classList.add("is-selected");
    monthChips.append(btn);
  });

  // Type chips
  const typeChips = qs("#history-type-chips");
  typeChips.innerHTML = "";
  [
    { value: "all", label: "全部" },
    { value: "expense", label: "支出" },
    { value: "income", label: "收入" },
    { value: "transfer", label: "轉帳" },
    { value: "creditPayment", label: "繳款" },
  ].forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-mini";
    btn.dataset.historyType = opt.value;
    btn.textContent = opt.label;
    if (historyFilters.type === opt.value) btn.classList.add("is-selected");
    typeChips.append(btn);
  });

  // Category chips
  const catChips = qs("#history-category-chips");
  catChips.innerHTML = "";
  const usedCats = [...new Set(state.transactions.filter((tx) => tx.type === "expense").map((tx) => tx.category))].filter(Boolean);
  [{ value: "all", label: "全部" }, ...usedCats.map((c) => ({ value: c, label: c }))].forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-mini";
    btn.dataset.historyCategory = opt.value;
    btn.textContent = opt.label;
    if (historyFilters.category === opt.value) btn.classList.add("is-selected");
    catChips.append(btn);
  });
}

function renderHistory() {
  const list = qs("#history-list");
  if (!list) return;
  renderHistoryFilters();

  const filtered = state.transactions
    .filter(matchesHistoryFilters)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  list.innerHTML = "";
  if (!filtered.length) {
    list.innerHTML = `<p class="report-empty">沒有符合篩選條件的紀錄。</p>`;
  } else {
    const groups = new Map();
    filtered.forEach((tx) => {
      const key = tx.date || "未知";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tx);
    });

    groups.forEach((txs, date) => {
      const group = document.createElement("div");
      group.className = "history-group";
      const dayTotal = txs.reduce((sum, tx) => sum + (tx.type === "expense" ? -Number(tx.amount || 0) : Number(tx.amount || 0)), 0);
      const weekday = (() => {
        try {
          return new Date(date).toLocaleDateString("zh-TW", { weekday: "short" });
        } catch {
          return "";
        }
      })();
      group.innerHTML = `<div class="history-group__head"><strong>${date}</strong><small>${weekday}</small><span>${dayTotal >= 0 ? "+" : ""}${formatMoney(dayTotal)}</span></div>`;
      const rows = document.createElement("div");
      rows.className = "transaction-list";
      txs.forEach((tx) => rows.append(buildTransactionRow(tx, { showAccount: true })));
      group.append(rows);
      list.append(group);
    });
  }

  const totalAmount = filtered.reduce((sum, tx) => sum + (tx.type === "expense" ? -Number(tx.amount || 0) : Number(tx.amount || 0)), 0);
  qs("#history-footer").innerHTML = `共 <strong>${filtered.length}</strong> 筆 · 合計 <strong>${totalAmount >= 0 ? "+" : ""}${formatMoney(totalAmount)}</strong>`;
}

function renderAll() {
  const newly = syncAchievements();
  // streakBest 在 renderHome 內會被更新
  renderHome();
  renderAccounts();
  renderBills();
  renderTransactionForm();
  renderSettings();
  renderReports();
  renderHistory();
  if (newly.length) saveState();
  if (newly.length) {
    setTimeout(() => {
      newly.forEach((a) => showToast(`🎉 解鎖成就「${a.title}」`));
    }, 60);
  }
}

function setupSwipeGestures() {
  const ACTION_WIDTH = 156;
  let activeRow = null;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let direction = null; // null | 'horizontal' | 'vertical'

  function closeAllExcept(except) {
    qsa(".swipe-row.is-open").forEach((row) => {
      if (row === except) return;
      row.classList.remove("is-open");
      const c = row.querySelector(".swipe-row__content");
      if (c) {
        c.style.transition = "transform 200ms ease";
        c.style.transform = "";
      }
    });
  }

  document.addEventListener("pointerdown", (event) => {
    const row = event.target.closest(".swipe-row");
    if (!row) {
      closeAllExcept(null);
      return;
    }
    // 點到動作按鈕不啟動 swipe
    if (event.target.closest(".swipe-row__actions")) return;
    closeAllExcept(row);
    activeRow = row;
    startX = event.clientX;
    startY = event.clientY;
    currentX = 0;
    direction = null;
    const content = row.querySelector(".swipe-row__content");
    content.style.transition = "none";
  });

  document.addEventListener("pointermove", (event) => {
    if (!activeRow) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!direction) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      direction = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (direction === "vertical") {
        // Cancel swipe — let page scroll
        const content = activeRow.querySelector(".swipe-row__content");
        content.style.transition = "transform 200ms ease";
        content.style.transform = activeRow.classList.contains("is-open") ? `translateX(-${ACTION_WIDTH}px)` : "";
        activeRow = null;
        return;
      }
    }
    if (direction !== "horizontal") return;
    activeRow.classList.add("is-swiping");
    let next = dx + (activeRow.classList.contains("is-open") ? -ACTION_WIDTH : 0);
    if (next > 0) next = 0;
    if (next < -ACTION_WIDTH) next = -ACTION_WIDTH;
    currentX = next;
    activeRow.querySelector(".swipe-row__content").style.transform = `translateX(${next}px)`;
  });

  function release() {
    if (!activeRow) return;
    const content = activeRow.querySelector(".swipe-row__content");
    content.style.transition = "transform 200ms ease";
    if (currentX < -ACTION_WIDTH / 2) {
      activeRow.classList.add("is-open");
      content.style.transform = `translateX(-${ACTION_WIDTH}px)`;
    } else {
      activeRow.classList.remove("is-open");
      content.style.transform = "";
    }
    activeRow.classList.remove("is-swiping");
    activeRow = null;
    direction = null;
  }

  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
}

function showToast(message) {
  let host = qs("#toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.className = "toast-host";
    document.body.append(host);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  host.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-shown"));
  setTimeout(() => {
    toast.classList.remove("is-shown");
    setTimeout(() => toast.remove(), 400);
  }, 3200);
}

function addTransaction(tx, override = {}) {
  state.transactions.push({
    id: override.id || crypto.randomUUID(),
    date: override.date || todayKey(),
    ...tx,
  });
  saveState();
  renderAll();
}

function rollbackTransaction(tx) {
  const amount = Number(tx.amount || 0);
  const from = accountById(tx.fromId);
  const to = accountById(tx.toId);

  if (tx.type === "expense") {
    if (!from) return;
    if (from.type === "credit") from.balance = Math.max(0, from.balance - amount);
    else from.balance += amount;
  }
  if (tx.type === "income") {
    if (!to) return;
    to.balance -= amount;
  }
  if (tx.type === "transfer") {
    if (!from || !to) return;
    from.balance += amount;
    to.balance -= amount;
  }
  if (tx.type === "creditPayment") {
    if (!from || !to) return;
    from.balance += amount;
    to.balance += amount;
  }
}

function handleTransactionSubmit(event) {
  event.preventDefault();
  const amount = Number(qs("#tx-amount").value);
  if (!amount || amount <= 0) return;

  const from = accountById(qs("#tx-from").value);
  const to = accountById(qs("#tx-to").value);
  const note = qs("#tx-note").value.trim();
  const form = qs("#transaction-form");
  const editingId = form.dataset.editingId || "";
  let override = {};

  if (editingId) {
    const oldTx = state.transactions.find((t) => t.id === editingId);
    if (oldTx) {
      override = { id: oldTx.id, date: oldTx.date };
      rollbackTransaction(oldTx);
      state.transactions = state.transactions.filter((t) => t.id !== editingId);
    }
    delete form.dataset.editingId;
    qs("#entry-title").textContent = "記一筆";
  }

  if (currentType === "expense") {
    if (!from) return;
    if (from.type === "credit") from.balance += amount;
    else from.balance -= amount;
    addTransaction({ type: "expense", amount, fromId: from.id, category: qs("#tx-category").value, note }, override);
  }
  if (currentType === "income") {
    if (!from) return;
    from.balance += amount;
    addTransaction({ type: "income", amount, toId: from.id, note: note || "收入入帳" }, override);
  }
  if (currentType === "transfer") {
    if (!from || !to || from.id === to.id) return;
    from.balance -= amount;
    to.balance += amount;
    addTransaction({ type: "transfer", amount, fromId: from.id, toId: to.id, note: note || "帳戶轉帳" }, override);
  }
  if (currentType === "creditPayment") {
    if (!from || !to) return;
    from.balance -= amount;
    to.balance = Math.max(0, to.balance - amount);
    addTransaction({ type: "creditPayment", amount, fromId: from.id, toId: to.id, note: note || "信用卡繳款" }, override);
  }

  form.reset();
  setAmountString("");
  showView(editingId ? "history" : "home");
}

function startEditTransaction(id) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return;
  currentType = tx.type;
  qsa("[data-type-choice]").forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.typeChoice === tx.type);
  });
  // Set selects first, then re-render form to populate chips/grid
  qs("#tx-from").value = tx.fromId || "";
  qs("#tx-to").value = tx.toId || "";
  qs("#tx-category").value = tx.category || "";
  qs("#tx-note").value = tx.note || "";
  setAmountString(String(tx.amount || ""));
  qs("#transaction-form").dataset.editingId = id;
  qs("#entry-title").textContent = "編輯交易";
  renderTransactionForm();
  showView("entry");
}

function resetEntryFormToNew() {
  const form = qs("#transaction-form");
  if (form.dataset.editingId) {
    delete form.dataset.editingId;
    qs("#entry-title").textContent = "記一筆";
    form.reset();
    setAmountString("");
  }
}

function applyBillPayment(bill, shouldBePaid) {
  const account = accountForBill(bill);
  const amount = Number(bill.amount || 0);

  if (shouldBePaid && !bill.applied && account) {
    if (account.type === "credit") account.balance += amount;
    else account.balance -= amount;
    bill.applied = true;
    state.transactions.push({
      id: crypto.randomUUID(),
      date: todayKey(),
      type: "expense",
      amount,
      fromId: account.id,
      category: "固定支出",
      note: bill.name,
      auto: true,
    });
  }

  if (!shouldBePaid && bill.applied && account) {
    if (account.type === "credit") account.balance = Math.max(0, account.balance - amount);
    else account.balance += amount;
    bill.applied = false;
  }

  bill.paid = shouldBePaid;
}

function setAccountFormMode(mode) {
  qs("#account-form-title").textContent = mode === "edit" ? "調整帳戶" : "新增帳戶";
  qs("#account-submit").textContent = mode === "edit" ? "儲存調整" : "儲存帳戶";
}

function startEditAccount(id) {
  const account = accountById(id);
  if (!account) return;
  const form = qs("#account-form");
  form.dataset.editingId = id;
  qs("#account-name").value = account.name;
  qs("#account-type").value = account.type;
  qs("#account-usage").value = account.usage;
  qs("#account-balance").value = account.balance;
  qs("#account-include").checked = account.includeInDaily;
  setAccountFormMode("edit");
  form.classList.remove("is-hidden");
  qs("[data-toggle-account-form]").textContent = "收起編輯帳戶";
  showView("accounts");
}

function bindLongPressDelete(selector, onDelete) {
  const timers = new Map();

  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(selector);
    if (!button) return;
    button.classList.add("is-arming");
    const timerId = window.setTimeout(() => {
      button.classList.remove("is-arming");
      onDelete(button);
      timers.delete(button);
    }, 1200);
    timers.set(button, timerId);
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      const button = event.target.closest(selector);
      if (!button) return;
      const timerId = timers.get(button);
      if (timerId) window.clearTimeout(timerId);
      timers.delete(button);
      button.classList.remove("is-arming");
    });
  });
}

function bindEvents() {
  qsa("[data-view-target]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.viewTarget)));

  qsa("[data-type-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      currentType = button.dataset.typeChoice;
      qsa("[data-type-choice]").forEach((item) => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
      renderTransactionForm();
    });
  });

  qs("#transaction-form").addEventListener("submit", handleTransactionSubmit);

  qs("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.monthlyGoalRemaining = Math.max(0, Number(qs("#goal-input").value) || 0);
    saveState();
    renderAll();
    showView("home");
  });

  qs("#category-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = qs("#category-new-name");
    const name = input.value.trim();
    if (!name) return;
    if (!state.categories.some((category) => category.name === name)) {
      state.categories.push({ id: crypto.randomUUID(), name, active: true });
      saveState();
      renderAll();
    }
    input.value = "";
  });

  qs("[data-toggle-account-form]").addEventListener("click", () => {
    const form = qs("#account-form");
    if (!form.classList.contains("is-hidden") && form.dataset.editingId) {
      delete form.dataset.editingId;
      form.reset();
      setAccountFormMode("create");
    }
    form.classList.toggle("is-hidden");
    qs("[data-toggle-account-form]").textContent = form.classList.contains("is-hidden") ? "新增帳戶" : "收起新增帳戶";
  });

  qs("#account-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const type = qs("#account-type").value;
    const editingId = qs("#account-form").dataset.editingId;
    const payload = {
      name: qs("#account-name").value.trim(),
      type,
      usage: qs("#account-usage").value,
      balance: Number(qs("#account-balance").value) || 0,
      includeInDaily: !["credit", "loan"].includes(type) && qs("#account-include").checked,
    };

    if (editingId) {
      Object.assign(accountById(editingId), payload);
      delete qs("#account-form").dataset.editingId;
      setAccountFormMode("create");
    } else {
      state.accounts.push({ id: crypto.randomUUID(), ...payload });
    }

    qs("#account-form").reset();
    qs("#account-form").classList.add("is-hidden");
    qs("[data-toggle-account-form]").textContent = "新增帳戶";
    saveState();
    renderAll();
  });

  qs("#bill-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const account = accountById(qs("#bill-account").value);
    state.fixedExpenses.push({
      id: crypto.randomUUID(),
      name: qs("#bill-name").value.trim(),
      amount: Number(qs("#bill-amount").value) || 0,
      day: Math.min(31, Math.max(1, Number(qs("#bill-day").value) || 1)),
      accountId: account?.id || "",
      accountName: account?.name || "未指定",
      paid: false,
      active: true,
      applied: false,
    });
    qs("#bill-form").reset();
    saveState();
    renderAll();
  });

  document.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip[data-target-select]");
    if (chip) {
      const select = qs(`#${chip.dataset.targetSelect}`);
      if (select) {
        select.value = chip.dataset.chipId;
        [...chip.parentElement.children].forEach((el) => el.classList.toggle("is-selected", el === chip));
      }
    }

    const catCard = event.target.closest(".category-card");
    if (catCard) {
      const select = qs("#tx-category");
      if (select) {
        select.value = catCard.dataset.categoryName;
        [...catCard.parentElement.children].forEach((el) => el.classList.toggle("is-selected", el === catCard));
      }
    }

    const editAccount = event.target.closest("[data-edit-account]");
    if (editAccount) startEditAccount(editAccount.dataset.editAccount);

    const setDebt = event.target.closest("[data-set-debt]");
    if (setDebt) {
      const account = accountById(setDebt.dataset.setDebt);
      if (account) {
        const suggested = Number(account.initialDebt || account.balance || 0);
        const answer = window.prompt(`設定「${account.name}」的起始債務金額（用於計算還款進度）`, String(suggested));
        if (answer !== null) {
          const value = Math.max(0, Number(answer) || 0);
          account.initialDebt = value;
          saveState();
          renderAll();
        }
      }
    }

    const saveCategory = event.target.closest("[data-save-category]");
    if (saveCategory) {
      const category = state.categories.find((item) => item.id === saveCategory.dataset.saveCategory);
      if (!category) return;
      const input = qs(`[data-category-name="${category.id}"]`);
      const active = qs(`[data-category-active="${category.id}"]`);
      const emojiInput = qs(`[data-category-emoji="${category.id}"]`);
      const oldName = category.name;
      const nextName = input.value.trim();
      if (!nextName) return;
      category.name = nextName;
      category.active = active.checked;
      // emoji 欄位如果填了，就用 emoji 蓋過去（不影響已上傳的圖檔，需先點清除）
      if (emojiInput && emojiInput.value.trim() && !isImageIcon(category.icon)) {
        category.icon = emojiInput.value.trim();
      } else if (emojiInput && !emojiInput.value.trim() && !isImageIcon(category.icon)) {
        category.icon = "";
      }
      state.transactions.forEach((tx) => {
        if (tx.category === oldName) tx.category = nextName;
      });
      saveState();
      renderAll();
    }

    const clearIcon = event.target.closest("[data-category-clear-icon]");
    if (clearIcon) {
      const category = state.categories.find((item) => item.id === clearIcon.dataset.categoryClearIcon);
      if (category) {
        category.icon = "";
        saveState();
        renderAll();
      }
    }

    const toggleBill = event.target.closest("[data-toggle-bill-paid]");
    if (toggleBill) {
      const bill = state.fixedExpenses.find((item) => item.id === toggleBill.dataset.toggleBillPaid);
      if (bill) {
        applyBillPayment(bill, !bill.paid);
        saveState();
        renderAll();
      }
    }
  });

  bindLongPressDelete("[data-long-delete-account]", (button) => {
    const id = button.dataset.longDeleteAccount;
    if (state.accounts.length <= 1) return;
    state.accounts = state.accounts.filter((account) => account.id !== id);
    saveState();
    renderAll();
  });

  bindLongPressDelete("[data-long-delete-bill]", (button) => {
    state.fixedExpenses = state.fixedExpenses.filter((bill) => bill.id !== button.dataset.longDeleteBill);
    saveState();
    renderAll();
  });

  bindLongPressDelete("[data-long-delete-category]", (button) => {
    const id = button.dataset.longDeleteCategory;
    const category = state.categories.find((item) => item.id === id);
    if (!category) return;
    if (state.transactions.some((tx) => tx.category === category.name)) return;
    state.categories = state.categories.filter((item) => item.id !== id);
    saveState();
    renderAll();
  });

  bindLongPressDelete("[data-long-delete-transaction]", (button) => {
    const id = button.dataset.longDeleteTransaction;
    const tx = state.transactions.find((item) => item.id === id);
    if (!tx) return;
    rollbackTransaction(tx);
    state.transactions = state.transactions.filter((item) => item.id !== id);
    saveState();
    renderAll();
  });

  qs("#export-data").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kate-budget-${todayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    state.settings.lastBackupAt = Date.now();
    saveState();
    renderAll();
    showToast("✅ 備份匯出完成");
  });

  // CSV 匯出按鈕暫時拿掉，JS 函式保留在上方（之後要的話補回 2 行）

  // 快照還原
  document.addEventListener("click", (event) => {
    const snap = event.target.closest("[data-snapshot-date]");
    if (!snap) return;
    const date = snap.dataset.snapshotDate;
    if (window.confirm(`要把資料還原到 ${date} 的快照嗎？\n\n目前的資料會被覆蓋，無法復原。建議先匯出 JSON 備份再執行。`)) {
      if (restoreSnapshot(date)) {
        showToast(`✅ 已還原到 ${date}`);
      } else {
        showToast("❌ 還原失敗");
      }
    }
  });

  // 編輯交易 / 刪除交易（swipe 按鈕）
  document.addEventListener("click", (event) => {
    const editBtn = event.target.closest("[data-edit-tx]");
    if (editBtn) {
      event.stopPropagation();
      startEditTransaction(editBtn.dataset.editTx);
      return;
    }
    const delBtn = event.target.closest("[data-delete-tx]");
    if (delBtn) {
      event.stopPropagation();
      if (window.confirm("確定要刪除這筆交易？帳戶餘額會還原。")) {
        deleteTransactionById(delBtn.dataset.deleteTx);
      }
    }
  });

  // History filter chips
  document.addEventListener("click", (event) => {
    const monthBtn = event.target.closest("[data-history-month]");
    if (monthBtn) {
      historyFilters.month = monthBtn.dataset.historyMonth;
      renderHistory();
      return;
    }
    const typeBtn = event.target.closest("[data-history-type]");
    if (typeBtn) {
      historyFilters.type = typeBtn.dataset.historyType;
      renderHistory();
      return;
    }
    const catBtn = event.target.closest("[data-history-category]");
    if (catBtn) {
      historyFilters.category = catBtn.dataset.historyCategory;
      renderHistory();
    }
  });

  qs("#history-search").addEventListener("input", (event) => {
    historyFilters.search = event.target.value.trim();
    renderHistory();
  });

  // 切換到 entry tab 時，如果處於編輯模式但用戶想新增，要清掉
  qsa('[data-view-target="entry"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      // 只在 bottom tab 按下時重置（不影響由 startEditTransaction 觸發的）
      if (btn.classList.contains("tab")) resetEntryFormToNew();
    });
  });

  setupSwipeGestures();

  qs("#report-prev").addEventListener("click", () => {
    currentReportMonth = shiftMonth(currentReportMonth, -1);
    renderReports();
  });

  qs("#report-next").addEventListener("click", () => {
    const nowKey = monthKey(new Date());
    if (currentReportMonth >= nowKey) return;
    currentReportMonth = shiftMonth(currentReportMonth, 1);
    renderReports();
  });

  document.addEventListener("change", async (event) => {
    const upload = event.target.closest("[data-category-upload]");
    if (!upload) return;
    const file = upload.files?.[0];
    if (!file) return;
    const category = state.categories.find((item) => item.id === upload.dataset.categoryUpload);
    if (!category) return;
    try {
      const dataURL = await compressImageToDataURL(file, 128);
      category.icon = dataURL;
      saveState();
      renderAll();
      showToast(`已更新「${category.name}」圖示`);
    } catch (err) {
      showToast("圖片讀取失敗，換一張試試");
    } finally {
      upload.value = "";
    }
  });

  qs("#import-data").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state = normalizeState(JSON.parse(await file.text()));
    saveState();
    renderAll();
    showView("home");
  });
}

function ensureNotionSyncUI() {
  const setupView = qs("#view-setup");
  if (!setupView || qs("#notion-sync-button")) return;
  const backupPanel = qs("#export-data")?.closest(".panel");
  if (!backupPanel) return;

  const panel = document.createElement("section");
  panel.className = "panel";
  panel.id = "notion-sync-panel";
  panel.innerHTML = `
    <div class="section-heading">
      <h3>Notion 同步</h3>
      <span class="muted">手動同步最穩定</span>
    </div>
    <div class="button-stack">
      <button class="secondary-action" type="button" id="notion-sync-button">同步到 Notion</button>
    </div>
    <p class="muted" id="notion-sync-status" style="margin-top:8px;font-size:12px;"></p>
  `;
  backupPanel.insertAdjacentElement("afterend", panel);
}

async function syncToNotion() {
  const btn = qs("#notion-sync-button");
  const status = qs("#notion-sync-status");
  if (!btn || !status) return;
  btn.disabled = true;
  status.textContent = "同步中...";
  try {
    const payload = {
      accounts: state.accounts || [],
      transactions: state.transactions || [],
      fixedExpenses: state.fixedExpenses || [],
      categories: state.categories || [],
      settings: state.settings || {},
      syncedAt: new Date().toISOString(),
    };

    // 先試 Vercel 的 /api/，失敗再試 Netlify 的 /.netlify/functions/
    let res = await fetch("/api/notion-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!res || res.status === 404) {
      res = await fetch("/.netlify/functions/notion-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "同步失敗");
    }
    status.textContent = `上次同步：${new Date().toLocaleString()}`;
    showToast("✅ Notion 同步完成");
  } catch (err) {
    status.textContent = `同步失敗：${err.message || "請稍後重試"}`;
    showToast("❌ Notion 同步失敗");
  } finally {
    btn.disabled = false;
  }
}

function enhanceHomeLayout() {
  const home = qs("#view-home");
  if (!home) return;

  home.classList.add("home-layout");

  const setText = (selector, text) => {
    const el = qs(selector);
    if (el) el.textContent = text;
  };

  setText("#backup-banner-title", "建議先匯出備份");
  setText("#backup-banner-sub", "iOS 可能清掉本機資料，先備份 JSON 會更安心。");
  setText("#daily-status", "計算中");
  setText("#daily-note", "只算已入帳金額，不先預支 5 號、10 號尚未入帳的收入。");
  setText("#debt-card-label", "信用卡未繳");
  setText("#debt-card-meta", "刷卡會增加未繳，繳款會減少");

  const panels = home.querySelectorAll(".panel");
  const monthStatusPanel = [...panels].find((panel) => panel.querySelector("#month-status"));
  if (monthStatusPanel) {
    const title = monthStatusPanel.querySelector("h3");
    if (title) title.textContent = "今天 / 本週到期";
    const cta = monthStatusPanel.querySelector(".text-button");
    if (cta) cta.textContent = "查看固定支出";
  }

  const recentPanel = [...panels].find((panel) => panel.querySelector("#recent-transactions"));
  if (recentPanel) {
    const title = recentPanel.querySelector("h3");
    if (title) title.textContent = "最近 5 筆記錄";
    const cta = recentPanel.querySelector(".text-button");
    if (cta) cta.textContent = "查看全部 →";
  }

  if (!qs("#home-quick-actions")) {
    const quickPanel = document.createElement("section");
    quickPanel.className = "panel";
    quickPanel.id = "home-quick-actions";
    quickPanel.innerHTML = `
      <div class="section-heading">
        <h3>快速操作</h3>
      </div>
      <div class="quick-actions">
        <button class="secondary-action" type="button" data-view-target="entry">記一筆</button>
        <button class="secondary-action" type="button" data-view-target="accounts">收入入帳</button>
        <button class="secondary-action" type="button" data-view-target="bills">信用卡繳款</button>
      </div>
    `;
    const metricStrip = home.querySelector(".soft-strip");
    if (metricStrip) {
      metricStrip.insertAdjacentElement("afterend", quickPanel);
    }
  }

  const streak = qs("#streak-card");
  if (streak) {
    const title = streak.querySelector("strong");
    const sub = streak.querySelector("small");
    if (title) title.textContent = "今天也有在前進";
    if (sub) sub.textContent = "連續記帳 0 天，先從一筆開始就很棒。";
  }

  const achievementTitle = home.querySelector(".achievement-panel h3");
  if (achievementTitle) achievementTitle.textContent = "小里程碑";
}

enhanceHomeLayout();
ensureNotionSyncUI();
bindEvents();
document.addEventListener("click", (event) => {
  if (event.target?.id === "notion-sync-button") {
    syncToNotion();
  }
});
setupKeypad();
renderAll();
