"""Google Sheets storage layer for the LINE bookkeeping bot."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import gspread
from google.oauth2.service_account import Credentials
from zoneinfo import ZoneInfo


TIMEZONE = os.getenv("TIMEZONE", "Asia/Taipei")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

SHEET_HEADERS = {
    "dashboard": ["指標", "數值", "說明"],
    "expenses": ["日期", "時間", "項目", "金額", "分類"],
    "income": ["日期", "時間", "項目", "金額", "分類"],
    "budgets": ["月份", "分類", "預算"],
    "debts": ["名稱", "原始金額", "已還金額", "剩餘金額", "狀態"],
    "bills": ["月份", "名稱", "應繳金額", "已繳金額", "未繳金額", "狀態"],
    "repayments": ["日期", "時間", "類型", "名稱", "金額", "備註"],
    "settings": ["設定項", "設定值"],
}


def now_tw() -> datetime:
    return datetime.now(ZoneInfo(TIMEZONE))


def month_key(dt: datetime | None = None) -> str:
    return (dt or now_tw()).strftime("%Y-%m")


def date_key(dt: datetime | None = None) -> str:
    return (dt or now_tw()).strftime("%Y-%m-%d")


def time_key(dt: datetime | None = None) -> str:
    return (dt or now_tw()).strftime("%H:%M")


def _load_credentials() -> Credentials:
    raw_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    json_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json").strip()

    if raw_json:
        info = json.loads(raw_json)
        return Credentials.from_service_account_info(info, scopes=SCOPES)

    path = Path(json_path)
    if not path.exists():
        raise RuntimeError(
            "找不到 Google service account 憑證。請設定 GOOGLE_SERVICE_ACCOUNT_JSON "
            "或放置 service_account.json。"
        )
    return Credentials.from_service_account_file(path, scopes=SCOPES)


class SheetsStore:
    def __init__(self, spreadsheet_id: str | None = None):
        self.spreadsheet_id = spreadsheet_id or os.getenv("GOOGLE_SHEET_ID", "").strip()
        if not self.spreadsheet_id:
            raise RuntimeError("缺少 GOOGLE_SHEET_ID。")
        self.client = gspread.authorize(_load_credentials())
        self.spreadsheet = self.client.open_by_key(self.spreadsheet_id)
        self.ensure_schema()

    def ensure_schema(self) -> None:
        existing = {worksheet.title: worksheet for worksheet in self.spreadsheet.worksheets()}
        for title, headers in SHEET_HEADERS.items():
            if title not in existing:
                worksheet = self.spreadsheet.add_worksheet(title=title, rows=200, cols=max(len(headers), 8))
                worksheet.append_row(headers)
                continue

            worksheet = existing[title]
            first_row = worksheet.row_values(1)
            if first_row != headers:
                worksheet.resize(rows=max(worksheet.row_count, 2), cols=max(len(headers), worksheet.col_count))
                worksheet.update(range_name="A1", values=[headers])

    def worksheet(self, title: str):
        return self.spreadsheet.worksheet(title)

    def records(self, title: str) -> list[dict[str, Any]]:
        return self.worksheet(title).get_all_records()

    def append_record(self, title: str, values: list[Any]) -> None:
        self.worksheet(title).append_row(values, value_input_option="USER_ENTERED")

    def append_expense(self, item: str, amount: int, category: str, dt: datetime | None = None) -> None:
        dt = dt or now_tw()
        self.append_record("expenses", [date_key(dt), time_key(dt), item, amount, category])

    def append_income(self, item: str, amount: int, category: str, dt: datetime | None = None) -> None:
        dt = dt or now_tw()
        self.append_record("income", [date_key(dt), time_key(dt), item, amount, category])

    def append_repayment(self, kind: str, name: str, amount: int, note: str = "", dt: datetime | None = None) -> None:
        dt = dt or now_tw()
        self.append_record("repayments", [date_key(dt), time_key(dt), kind, name, amount, note])

    def upsert_budget(self, month: str, category: str, amount: int) -> None:
        worksheet = self.worksheet("budgets")
        rows = worksheet.get_all_values()
        for index, row in enumerate(rows[1:], start=2):
            if len(row) >= 2 and row[0] == month and row[1] == category:
                worksheet.update(range_name=f"C{index}", values=[[amount]], value_input_option="USER_ENTERED")
                return
        worksheet.append_row([month, category, amount], value_input_option="USER_ENTERED")

    def get_setting(self, key: str, default: str = "") -> str:
        for row in self.records("settings"):
            if str(row.get("設定項", "")).strip() == key:
                return str(row.get("設定值", "")).strip()
        return default

    def set_setting(self, key: str, value: str) -> None:
        worksheet = self.worksheet("settings")
        rows = worksheet.get_all_values()
        for index, row in enumerate(rows[1:], start=2):
            if row and row[0] == key:
                worksheet.update(range_name=f"B{index}", values=[[value]], value_input_option="USER_ENTERED")
                return
        worksheet.append_row([key, value], value_input_option="USER_ENTERED")


def to_int(value: Any) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    cleaned = str(value or "").replace(",", "").replace("元", "").strip()
    return int(float(cleaned)) if cleaned else 0
