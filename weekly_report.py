"""Weekly report generation and LINE push helper."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from budget import format_money
from category import LIVING_CATEGORIES, WORK_CATEGORY
from sheets import SheetsStore, now_tw, to_int


def previous_week_range(reference: datetime | None = None) -> tuple[str, str]:
    today = (reference or now_tw()).date()
    this_monday = today - timedelta(days=today.weekday())
    last_monday = this_monday - timedelta(days=7)
    last_sunday = this_monday - timedelta(days=1)
    return last_monday.isoformat(), last_sunday.isoformat()


def _rows_between(rows: list[dict], start_date: str, end_date: str) -> list[dict]:
    return [row for row in rows if start_date <= str(row.get("日期", "")) <= end_date]


def _totals_by_category(rows: list[dict]) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for row in rows:
        totals[str(row.get("分類", "") or "其他")] += to_int(row.get("金額"))
    return dict(totals)


def weekly_report(store: SheetsStore, start_date: str | None = None, end_date: str | None = None) -> str:
    if not start_date or not end_date:
        start_date, end_date = previous_week_range()

    expenses = _rows_between(store.records("expenses"), start_date, end_date)
    incomes = _rows_between(store.records("income"), start_date, end_date)
    repayments = _rows_between(store.records("repayments"), start_date, end_date)

    income_total = sum(to_int(row.get("金額")) for row in incomes)
    repayment_total = sum(to_int(row.get("金額")) for row in repayments)
    totals = _totals_by_category(expenses)
    living_total = sum(amount for category, amount in totals.items() if category in LIVING_CATEGORIES)
    work_total = totals.get(WORK_CATEGORY, 0)
    top_expenses = sorted(expenses, key=lambda row: to_int(row.get("金額")), reverse=True)[:5]

    lines = [
        f"上週花費統計",
        f"{start_date} ~ {end_date}",
        "",
        f"總收入：{format_money(income_total)}",
        f"生活支出：{format_money(living_total)}",
        f"工作支出：{format_money(work_total)}",
        f"還款金額：{format_money(repayment_total)}",
        "",
        "分類統計",
    ]

    category_lines = []
    for category, amount in sorted(totals.items(), key=lambda item: item[1], reverse=True):
        category_lines.append(f"{category}：{format_money(amount)}")
    lines.extend(category_lines or ["上週尚無支出紀錄。"])

    lines.extend(["", "最大支出 Top 5"])
    if top_expenses:
        for index, row in enumerate(top_expenses, start=1):
            lines.append(f"{index}. {row.get('項目')}：{format_money(to_int(row.get('金額')))}")
    else:
        lines.append("上週尚無支出紀錄。")

    lines.extend(["", "小結"])
    if not expenses and not incomes and not repayments:
        lines.append("上週沒有資料，這週可以先從每一筆小支出開始記。")
    elif work_total > living_total:
        lines.append("上週工作投入高於生活支出，月底回顧時可以再看這些投入帶來的產出。")
    elif living_total:
        lines.append("上週生活支出已有清楚輪廓，接下來優先留意高頻分類即可。")
    else:
        lines.append("上週現金流相對單純，維持想到就記的節奏。")

    return "\n".join(lines).strip()
