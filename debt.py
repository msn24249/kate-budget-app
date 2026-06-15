"""Debt and credit-card bill tracking."""

from __future__ import annotations

from budget import format_money
from sheets import SheetsStore, month_key, to_int


def create_debt(store: SheetsStore, name: str, amount: int) -> str:
    worksheet = store.worksheet("debts")
    rows = worksheet.get_all_values()
    for index, row in enumerate(rows[1:], start=2):
        if row and row[0] == name:
            worksheet.update(
                range_name=f"B{index}:E{index}",
                values=[[amount, 0, amount, "進行中"]],
                value_input_option="USER_ENTERED",
            )
            break
    else:
        worksheet.append_row([name, amount, 0, amount, "進行中"], value_input_option="USER_ENTERED")

    return f"已建立債務 ✅\n\n名稱：{name}\n原始金額：{format_money(amount)}\n剩餘金額：{format_money(amount)}"


def repay_debt(store: SheetsStore, name: str, amount: int) -> str:
    worksheet = store.worksheet("debts")
    rows = worksheet.get_all_values()
    for index, row in enumerate(rows[1:], start=2):
        if row and row[0] == name:
            original = to_int(row[1] if len(row) > 1 else 0)
            paid = to_int(row[2] if len(row) > 2 else 0) + amount
            remaining = max(original - paid, 0)
            status = "已還清" if remaining == 0 else "進行中"
            progress = round((paid / original) * 100) if original else 100
            worksheet.update(
                range_name=f"C{index}:E{index}",
                values=[[paid, remaining, status]],
                value_input_option="USER_ENTERED",
            )
            store.append_repayment("固定債務", name, amount)
            return (
                "已記錄還款 ✅\n\n"
                f"債務：{name}\n"
                f"本次還款：{format_money(amount)}\n"
                f"剩餘金額：{format_money(remaining)}\n"
                f"進度：{progress}%"
            )
    return f"找不到債務：{name}\n\n請先輸入：\n新增債務 {name} 120000"


def create_bill(store: SheetsStore, name: str, amount: int, month: str | None = None) -> str:
    target_month = month or month_key()
    worksheet = store.worksheet("bills")
    rows = worksheet.get_all_values()
    for index, row in enumerate(rows[1:], start=2):
        if len(row) >= 2 and row[0] == target_month and row[1] == name:
            worksheet.update(
                range_name=f"C{index}:F{index}",
                values=[[amount, 0, amount, "未繳"]],
                value_input_option="USER_ENTERED",
            )
            break
    else:
        worksheet.append_row([target_month, name, amount, 0, amount, "未繳"], value_input_option="USER_ENTERED")

    return (
        "已建立本月信用卡帳單 ✅\n\n"
        f"帳單：{name}\n"
        f"月份：{target_month}\n"
        f"應繳金額：{format_money(amount)}\n"
        f"已繳：{format_money(0)}\n"
        f"未繳：{format_money(amount)}"
    )


def pay_bill(store: SheetsStore, name: str, amount: int, month: str | None = None) -> str:
    target_month = month or month_key()
    worksheet = store.worksheet("bills")
    rows = worksheet.get_all_values()
    for index, row in enumerate(rows[1:], start=2):
        if len(row) >= 2 and row[0] == target_month and row[1] == name:
            due = to_int(row[2] if len(row) > 2 else 0)
            paid = to_int(row[3] if len(row) > 3 else 0) + amount
            unpaid = max(due - paid, 0)
            status = "已繳清" if unpaid == 0 else "部分繳款"
            worksheet.update(
                range_name=f"D{index}:F{index}",
                values=[[paid, unpaid, status]],
                value_input_option="USER_ENTERED",
            )
            store.append_repayment("信用卡", name, amount, note=target_month)
            return (
                "已記錄卡費 ✅\n\n"
                f"帳單：{name}\n"
                f"本次繳款：{format_money(amount)}\n"
                f"已繳：{format_money(paid)}\n"
                f"未繳：{format_money(unpaid)}"
            )
    return f"找不到本月帳單：{name}\n\n請先輸入：\n新增帳單 {name} 11623"


def repayment_status(store: SheetsStore, month: str | None = None) -> str:
    target_month = month or month_key()
    lines = ["本月還款進度", "", "固定債務"]
    debts = store.records("debts")
    if not debts:
        lines.append("尚未建立固定債務。")
    else:
        for row in debts:
            original = to_int(row.get("原始金額"))
            paid = to_int(row.get("已還金額"))
            remaining = to_int(row.get("剩餘金額"))
            progress = round(paid / original * 100) if original else 100
            lines.extend(
                [
                    f"{row.get('名稱')}：",
                    f"原始金額 {format_money(original)}",
                    f"已還 {format_money(paid)}",
                    f"剩餘 {format_money(remaining)}",
                    f"進度 {progress}%",
                    "",
                ]
            )

    lines.append("信用卡帳單")
    bills = [row for row in store.records("bills") if str(row.get("月份", "")) == target_month]
    if not bills:
        lines.append("本月尚未建立信用卡帳單。")
    else:
        for row in bills:
            lines.extend(
                [
                    f"{row.get('名稱')}：",
                    f"應繳 {format_money(to_int(row.get('應繳金額')))}",
                    f"已繳 {format_money(to_int(row.get('已繳金額')))}",
                    f"未繳 {format_money(to_int(row.get('未繳金額')))}",
                    "",
                ]
            )
    return "\n".join(lines).strip()
