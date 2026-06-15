"""Budget calculations and reply formatting."""

from __future__ import annotations

from collections import defaultdict

from category import LIVING_CATEGORIES, SAVINGS_GOAL_CATEGORY, is_living_category
from sheets import SheetsStore, month_key, to_int


def format_money(amount: int) -> str:
    return f"{amount:,} 元"


def set_budget(store: SheetsStore, category: str, amount: int, month: str | None = None) -> str:
    target_month = month or month_key()
    store.upsert_budget(target_month, category, amount)
    return f"已設定 ✅\n\n月份：{target_month}\n分類：{category}\n預算：{format_money(amount)}"


def set_savings_goal(store: SheetsStore, amount: int, month: str | None = None) -> str:
    target_month = month or month_key()
    store.upsert_budget(target_month, SAVINGS_GOAL_CATEGORY, amount)
    return f"已設定本月存錢目標 ✅\n\n月份：{target_month}\n目標：{format_money(amount)}"


def get_budgets(store: SheetsStore, month: str | None = None) -> dict[str, int]:
    target_month = month or month_key()
    budgets: dict[str, int] = {}
    for row in store.records("budgets"):
        if str(row.get("月份", "")).strip() == target_month:
            budgets[str(row.get("分類", "")).strip()] = to_int(row.get("預算"))
    return budgets


def month_expense_totals(store: SheetsStore, month: str | None = None) -> dict[str, int]:
    target_month = month or month_key()
    totals: dict[str, int] = defaultdict(int)
    for row in store.records("expenses"):
        if str(row.get("日期", "")).startswith(target_month):
            totals[str(row.get("分類", "") or "其他")] += to_int(row.get("金額"))
    return dict(totals)


def month_income_total(store: SheetsStore, month: str | None = None) -> int:
    target_month = month or month_key()
    return sum(to_int(row.get("金額")) for row in store.records("income") if str(row.get("日期", "")).startswith(target_month))


def month_repayment_total(store: SheetsStore, month: str | None = None) -> int:
    target_month = month or month_key()
    return sum(
        to_int(row.get("金額")) for row in store.records("repayments") if str(row.get("日期", "")).startswith(target_month)
    )


def budget_warning(store: SheetsStore, category: str, month: str | None = None) -> str:
    if not is_living_category(category):
        return ""
    target_month = month or month_key()
    budgets = get_budgets(store, target_month)
    budget_amount = budgets.get(category, 0)
    if budget_amount <= 0:
        return ""

    spent = month_expense_totals(store, target_month).get(category, 0)
    usage = round(spent / budget_amount * 100)
    if usage >= 100:
        return f"\n\n提醒：\n{category}預算已超支。"
    if usage >= 80:
        return f"\n\n提醒：\n{category}預算已使用 {usage}%"
    return ""


def budget_status(store: SheetsStore, month: str | None = None) -> str:
    target_month = month or month_key()
    budgets = get_budgets(store, target_month)
    expense_totals = month_expense_totals(store, target_month)
    income_total = month_income_total(store, target_month)
    expense_total = sum(expense_totals.values())
    repayment_total = month_repayment_total(store, target_month)
    saved = income_total - expense_total - repayment_total
    savings_goal = budgets.get(SAVINGS_GOAL_CATEGORY, 0)

    lines = ["本月預算狀況", ""]
    categories = [cat for cat in budgets if cat in LIVING_CATEGORIES]
    if not categories:
        lines.append("尚未設定生活預算。")
    else:
        for category in categories:
            spent = expense_totals.get(category, 0)
            budget_amount = budgets[category]
            usage = round(spent / budget_amount * 100) if budget_amount else 0
            lines.extend(
                [
                    f"{category}：",
                    f"已花 {format_money(spent)}",
                    f"預算 {format_money(budget_amount)}",
                    f"使用率 {usage}%",
                    "",
                ]
            )

    lines.extend(["距離存錢目標：", ""])
    if savings_goal:
        gap = savings_goal - saved
        lines.extend(
            [
                f"已存 {format_money(saved)}",
                f"目標 {format_money(savings_goal)}",
                f"{'還差' if gap > 0 else '超過目標'} {format_money(abs(gap))}",
            ]
        )
    else:
        lines.append("尚未設定本月存錢目標。")

    if repayment_total:
        lines.extend(["", f"本月還款：{format_money(repayment_total)}"])
    return "\n".join(lines).strip()
