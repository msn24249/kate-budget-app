"""Monthly report generation."""

from __future__ import annotations

from collections import defaultdict

from budget import format_money, get_budgets
from category import LIVING_CATEGORIES, SAVINGS_GOAL_CATEGORY, WORK_CATEGORY
from sheets import SheetsStore, month_key, to_int


def _expense_rows_for_month(store: SheetsStore, month: str) -> list[dict]:
    return [row for row in store.records("expenses") if str(row.get("日期", "")).startswith(month)]


def _income_rows_for_month(store: SheetsStore, month: str) -> list[dict]:
    return [row for row in store.records("income") if str(row.get("日期", "")).startswith(month)]


def _repayment_rows_for_month(store: SheetsStore, month: str) -> list[dict]:
    return [row for row in store.records("repayments") if str(row.get("日期", "")).startswith(month)]


def _category_totals(rows: list[dict]) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for row in rows:
        totals[str(row.get("分類", "") or "其他")] += to_int(row.get("金額"))
    return dict(totals)


def _top_expenses(rows: list[dict], limit: int = 3) -> list[dict]:
    return sorted(rows, key=lambda row: to_int(row.get("金額")), reverse=True)[:limit]


def _summary_text(saved: int, goal: int, work_total: int, living_total: int) -> str:
    parts = []
    if work_total > living_total:
        parts.append("本月工作投入較高，記得把它視為成本追蹤，不需要和生活預算混在一起焦慮。")
    elif living_total:
        parts.append("本月生活支出有穩定留下紀錄，接下來會更容易看出錢花在哪裡。")
    else:
        parts.append("本月生活支出資料不多，可以先維持想到就記的節奏。")

    if goal:
        gap = goal - saved
        if gap > 0:
            parts.append(f"距離存錢目標還差 {format_money(gap)}，下個月可優先觀察餐飲與交通這類高頻支出。")
        else:
            parts.append(f"本月已超過存錢目標 {format_money(abs(gap))}，這個現金流狀態很健康。")
    return "\n".join(parts)


def monthly_report(store: SheetsStore, month: str | None = None) -> str:
    target_month = month or month_key()
    expense_rows = _expense_rows_for_month(store, target_month)
    income_rows = _income_rows_for_month(store, target_month)
    repayment_rows = _repayment_rows_for_month(store, target_month)
    budgets = get_budgets(store, target_month)

    income_total = sum(to_int(row.get("金額")) for row in income_rows)
    expense_total = sum(to_int(row.get("金額")) for row in expense_rows)
    repayment_total = sum(to_int(row.get("金額")) for row in repayment_rows)
    saved = income_total - expense_total - repayment_total
    goal = budgets.get(SAVINGS_GOAL_CATEGORY, 0)
    goal_rate = round(saved / goal * 100) if goal else 0
    gap = goal - saved

    totals = _category_totals(expense_rows)
    living_total = sum(amount for category, amount in totals.items() if category in LIVING_CATEGORIES)
    work_total = totals.get(WORK_CATEGORY, 0)

    lines = [
        f"📊 {target_month} 月回顧",
        "",
        "收入",
        f"總收入：{format_money(income_total)}",
        "",
        "支出",
        f"總支出：{format_money(expense_total)}",
        f"還款：{format_money(repayment_total)}",
        "",
        "存錢成果",
        f"本月存下：{format_money(saved)}",
    ]

    if goal:
        lines.extend(
            [
                f"存錢目標：{format_money(goal)}",
                f"達成率：{goal_rate}%",
                f"{'還差' if gap > 0 else '超過目標'}：{format_money(abs(gap))}",
            ]
        )
    else:
        lines.append("尚未設定存錢目標。")

    lines.extend(["", "生活支出統計"])
    living_lines = []
    for category in sorted(LIVING_CATEGORIES):
        amount = totals.get(category, 0)
        if amount:
            ratio = round(amount / expense_total * 100) if expense_total else 0
            living_lines.append(f"{category}：{format_money(amount)}，占 {ratio}%")
    lines.extend(living_lines or ["本月尚無生活支出。"])

    lines.extend(["", "工作支出統計"])
    if work_total:
        ratio = round(work_total / expense_total * 100) if expense_total else 0
        lines.append(f"{WORK_CATEGORY}：{format_money(work_total)}，占 {ratio}%")
    else:
        lines.append("本月尚無工作支出。")

    lines.extend(["", "最大支出 Top 3"])
    top_rows = _top_expenses(expense_rows)
    if top_rows:
        for index, row in enumerate(top_rows, start=1):
            lines.append(f"{index}. {row.get('項目')}：{format_money(to_int(row.get('金額')))}")
    else:
        lines.append("本月尚無支出紀錄。")

    debt_remaining = sum(to_int(row.get("剩餘金額")) for row in store.records("debts"))
    bill_unpaid = sum(to_int(row.get("未繳金額")) for row in store.records("bills") if str(row.get("月份", "")) == target_month)
    lines.extend(["", "還款進度", f"債務與本月帳單剩餘：{format_money(debt_remaining + bill_unpaid)}"])

    lines.extend(["", "AI 小結", _summary_text(saved, goal, work_total, living_total)])
    return "\n".join(lines).strip()
