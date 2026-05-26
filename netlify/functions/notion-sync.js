"use strict";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// 機密改用 Netlify 環境變數，請到 Netlify Dashboard → Site settings → Environment variables 設定：
//   NOTION_TOKEN
//   NOTION_DB_TRANSACTIONS
//   NOTION_DB_ACCOUNTS
//   NOTION_DB_FIXED_EXPENSES

const headers = () => ({
  Authorization: `Bearer ${process.env.NOTION_TOKEN || ""}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json",
});

const textProp = (value) => ({
  rich_text: [{ type: "text", text: { content: String(value ?? "") } }],
});

const titleProp = (value) => ({
  title: [{ type: "text", text: { content: String(value ?? "") } }],
});

const numberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeTxType = (type) => {
  if (type === "creditPayment") return "credit_payment";
  if (type === "income") return "income";
  if (type === "transfer") return "transfer";
  return "expense";
};

const txTitleFromRow = (tx) => {
  const t = String(tx?.type || "expense");
  if (t === "expense") return tx?.category || "未分類";
  if (t === "income") return tx?.category || "收入";
  if (t === "transfer") return "轉帳";
  if (t === "creditPayment") return "信用卡繳款";
  return tx?.category || "交易";
};

const normalizeAccountType = (type) => {
  if (type === "wallet") return "ewallet";
  if (type === "debit") return "bank";
  if (["cash", "bank", "ewallet", "credit", "loan"].includes(type)) return type;
  return "bank";
};

const normalizeUsage = (usage) => {
  if (usage === "spend") return "daily";
  if (usage === "debt") return "loan";
  if (usage === "holding") return "save";
  if (["daily", "save", "emergency", "credit", "loan"].includes(usage)) return usage;
  return "daily";
};

async function notionFetch(path, init = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Notion API error (${res.status})`);
  }
  return data;
}

async function findPageByAppId(databaseId, appIdField, appIdValue) {
  if (!appIdValue) return null;
  const body = {
    filter: {
      property: appIdField,
      rich_text: { equals: String(appIdValue) },
    },
    page_size: 1,
  };
  const data = await notionFetch(`/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.results?.[0] || null;
}

async function upsertPage(databaseId, appIdField, appIdValue, properties) {
  const existing = await findPageByAppId(databaseId, appIdField, appIdValue);
  if (existing) {
    await notionFetch(`/pages/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return "updated";
  }
  await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
  });
  return "created";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method Not Allowed" }) };
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const txDb = process.env.NOTION_DB_TRANSACTIONS;
    const accDb = process.env.NOTION_DB_ACCOUNTS;
    const billDb = process.env.NOTION_DB_FIXED_EXPENSES;

    if (!notionToken || !txDb || !accDb || !billDb) {
      throw new Error("缺少 Notion 環境變數（NOTION_TOKEN / NOTION_DB_*）");
    }

    const payload = JSON.parse(event.body || "{}");
    const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
    const fixedExpenses = Array.isArray(payload.fixedExpenses) ? payload.fixedExpenses : [];

    let accountCreated = 0;
    let accountUpdated = 0;
    for (const a of accounts) {
      const result = await upsertPage(accDb, "AppAccountId", a.id, {
        Name: titleProp(a.name || "未命名帳戶"),
        AppAccountId: textProp(a.id || ""),
        Type: { select: { name: normalizeAccountType(String(a.type || "bank")) } },
        Usage: { select: { name: normalizeUsage(String(a.usage || "daily")) } },
        Balance: { number: numberOrNull(a.balance) },
        IncludeInDaily: { checkbox: !!a.includeInDaily },
        IsArchived: { checkbox: false },
      });
      if (result === "created") accountCreated += 1;
      else accountUpdated += 1;
    }

    let txCreated = 0;
    let txUpdated = 0;
    for (const t of transactions) {
      const result = await upsertPage(txDb, "AppTxId", t.id, {
        Name: titleProp(txTitleFromRow(t)),
        Date: t.date ? { date: { start: String(t.date) } } : { date: null },
        Amount: { number: numberOrNull(t.amount) },
        Type: { select: { name: normalizeTxType(String(t.type || "expense")) } },
        Category: textProp(t.category || ""),
        FromAccountId: textProp(t.fromId || ""),
        ToAccountId: textProp(t.toId || ""),
        Note: textProp(t.note || ""),
        AppTxId: textProp(t.id || ""),
        Reconciled: { checkbox: false },
      });
      if (result === "created") txCreated += 1;
      else txUpdated += 1;
    }

    let billCreated = 0;
    let billUpdated = 0;
    for (const b of fixedExpenses) {
      const result = await upsertPage(billDb, "AppBillId", b.id, {
        Name: titleProp(b.name || "未命名固定支出"),
        AppBillId: textProp(b.id || ""),
        Amount: { number: numberOrNull(b.amount) },
        DueDay: { number: numberOrNull(b.day) },
        PayAccountId: textProp(b.accountId || ""),
        PayAccountName: textProp(b.accountName || ""),
        Paid: { checkbox: !!b.paid },
        Month: textProp(""),
      });
      if (result === "created") billCreated += 1;
      else billUpdated += 1;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        summary: {
          accounts: { created: accountCreated, updated: accountUpdated, total: accounts.length },
          transactions: { created: txCreated, updated: txUpdated, total: transactions.length },
          fixedExpenses: { created: billCreated, updated: billUpdated, total: fixedExpenses.length },
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message || "Sync failed" }),
    };
  }
};
