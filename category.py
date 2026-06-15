"""Category and message parsing helpers for the LINE bookkeeping bot."""

from __future__ import annotations

import re
from dataclasses import dataclass


LIVING_CATEGORIES = {"餐飲", "交通", "購物", "生活"}
WORK_CATEGORY = "工作支出"
SAVINGS_GOAL_CATEGORY = "存錢目標"

EXPENSE_KEYWORDS = {
    "餐飲": ["早餐", "午餐", "晚餐", "宵夜", "飲料", "咖啡", "星巴克"],
    "交通": ["油錢", "停車", "停車費", "捷運", "uber", "計程車"],
    "購物": ["蝦皮", "衣服", "鞋子"],
    "生活": ["生活用品", "訂閱", "房租", "水電", "電信", "網路"],
    WORK_CATEGORY: ["拍攝", "道具", "廣告", "印刷", "設計", "素材"],
}

INCOME_KEYWORDS = {
    "固定收入": ["薪水", "獎金"],
    "額外收入": ["接案收入", "接案", "外快", "兼職"],
    "退款": ["退款", "退稅"],
}


@dataclass(frozen=True)
class ParsedAmountMessage:
    item: str
    amount: int


def parse_item_amount(text: str) -> ParsedAmountMessage | None:
    """Parse `[item] [positive integer]`, using the last number as amount."""
    value = (text or "").strip()
    matches = list(re.finditer(r"\d+", value))
    if not matches:
        return None

    amount_match = matches[-1]
    amount = int(amount_match.group(0))
    item = (value[: amount_match.start()] + value[amount_match.end() :]).strip()
    item = re.sub(r"\s+", " ", item)
    if not item or amount <= 0:
        return None
    return ParsedAmountMessage(item=item, amount=amount)


def classify_expense(item: str) -> str:
    normalized = (item or "").lower()
    for category, keywords in EXPENSE_KEYWORDS.items():
        if any(keyword.lower() in normalized for keyword in keywords):
            return category
    return "其他"


def classify_income(item: str) -> str:
    normalized = (item or "").lower()
    for category, keywords in INCOME_KEYWORDS.items():
        if any(keyword.lower() in normalized for keyword in keywords):
            return category
    return "其他收入"


def is_income_item(item: str) -> bool:
    normalized = (item or "").lower()
    return any(
        keyword.lower() in normalized
        for keywords in INCOME_KEYWORDS.values()
        for keyword in keywords
    )


def is_living_category(category: str) -> bool:
    return category in LIVING_CATEGORIES
