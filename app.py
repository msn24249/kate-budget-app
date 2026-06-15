"""Flask webhook for the LINE AI bookkeeping assistant."""

from __future__ import annotations

import os
import re
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    ApiClient,
    Configuration,
    MessagingApi,
    PushMessageRequest,
    ReplyMessageRequest,
    TextMessage,
)
from linebot.v3.webhook import WebhookHandler
from linebot.v3.webhooks import MessageEvent, TextMessageContent

from budget import budget_status, budget_warning, format_money, set_budget, set_savings_goal
from category import classify_expense, classify_income, is_income_item, parse_item_amount
from debt import create_bill, create_debt, pay_bill, repay_debt, repayment_status
from monthly_report import monthly_report
from sheets import SheetsStore
from weekly_report import weekly_report


load_dotenv()

app = Flask(__name__)

LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
CRON_SECRET = os.getenv("CRON_SECRET", "")
LINE_PUSH_USER_ID = os.getenv("LINE_PUSH_USER_ID", "")

configuration = Configuration(access_token=LINE_CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(LINE_CHANNEL_SECRET)


HELP_TEXT = """請輸入：

項目 金額

例如：
午餐 120

也可以輸入：
設定預算 餐飲 12000
設定存錢目標 30000
新增債務 學貸 120000
還款 學貸 6000
新增帳單 LINE Bank信用卡 11623
繳卡費 LINE Bank信用卡 5000
預算
還款進度
月回顧"""


def _store() -> SheetsStore:
    return SheetsStore()


def _parse_command_amount(text: str, prefix: str):
    rest = text[len(prefix) :].strip()
    parsed = parse_item_amount(rest)
    return parsed


def _parse_positive_amount(text: str) -> int | None:
    match = re.search(r"\d+", text or "")
    if not match:
        return None
    amount = int(match.group(0))
    return amount if amount > 0 else None


def _reply(reply_token: str, text: str) -> None:
    with ApiClient(configuration) as api_client:
        MessagingApi(api_client).reply_message(
            ReplyMessageRequest(reply_token=reply_token, messages=[TextMessage(text=text[:4900])])
        )


def _push(user_id: str, text: str) -> None:
    with ApiClient(configuration) as api_client:
        MessagingApi(api_client).push_message(
            PushMessageRequest(to=user_id, messages=[TextMessage(text=text[:4900])])
        )


def handle_text(text: str, user_id: str | None = None) -> str:
    value = (text or "").strip()
    store = _store()

    if user_id:
        existing = store.get_setting("LINE_PUSH_USER_ID")
        if not existing:
            store.set_setting("LINE_PUSH_USER_ID", user_id)

    if value in {"說明", "help", "Help", "HELP"}:
        return HELP_TEXT

    if value == "預算":
        return budget_status(store)

    if value in {"還款進度", "債務進度"}:
        return repayment_status(store)

    if value in {"月回顧", "本月回顧"}:
        return monthly_report(store)

    if value.startswith("設定存錢目標"):
        amount = _parse_positive_amount(value[len("設定存錢目標") :])
        if not amount:
            return "請輸入：\n設定存錢目標 30000"
        return set_savings_goal(store, amount)

    if value.startswith("設定預算"):
        parsed = _parse_command_amount(value, "設定預算")
        if not parsed:
            return "請輸入：\n設定預算 餐飲 12000"
        return set_budget(store, parsed.item, parsed.amount)

    if value.startswith("新增債務"):
        parsed = _parse_command_amount(value, "新增債務")
        if not parsed:
            return "請輸入：\n新增債務 學貸 120000"
        return create_debt(store, parsed.item, parsed.amount)

    if value.startswith("還款"):
        parsed = _parse_command_amount(value, "還款")
        if not parsed:
            return "請輸入：\n還款 學貸 6000"
        return repay_debt(store, parsed.item, parsed.amount)

    if value.startswith("新增帳單"):
        parsed = _parse_command_amount(value, "新增帳單")
        if not parsed:
            return "請輸入：\n新增帳單 LINE Bank信用卡 11623"
        return create_bill(store, parsed.item, parsed.amount)

    if value.startswith("繳卡費"):
        parsed = _parse_command_amount(value, "繳卡費")
        if not parsed:
            return "請輸入：\n繳卡費 LINE Bank信用卡 5000"
        return pay_bill(store, parsed.item, parsed.amount)

    parsed = parse_item_amount(value)
    if not parsed:
        return HELP_TEXT

    if is_income_item(parsed.item):
        category = classify_income(parsed.item)
        store.append_income(parsed.item, parsed.amount, category)
        return (
            "已記錄 ✅\n\n"
            f"項目：{parsed.item}\n"
            f"金額：{format_money(parsed.amount)}\n"
            f"分類：{category}\n"
            "類型：收入"
        )

    category = classify_expense(parsed.item)
    store.append_expense(parsed.item, parsed.amount, category)
    warning = budget_warning(store, category)
    return (
        "已記錄 ✅\n\n"
        f"項目：{parsed.item}\n"
        f"金額：{format_money(parsed.amount)}\n"
        f"分類：{category}"
        f"{warning}"
    )


@app.get("/")
def health():
    return jsonify({"ok": True, "service": "line-bookkeeping-bot"})


@app.post("/callback")
def callback():
    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data(as_text=True)
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(400)
    return "OK"


@handler.add(MessageEvent, message=TextMessageContent)
def handle_line_message(event: MessageEvent):
    user_id = event.source.user_id if event.source else None
    try:
        response = handle_text(event.message.text, user_id=user_id)
    except Exception as exc:
        app.logger.exception("Failed to handle LINE message")
        response = f"系統設定或資料寫入發生錯誤，請檢查 Render logs。\n\n錯誤：{exc}"
    _reply(event.reply_token, response)


@app.route("/weekly-report", methods=["GET", "POST"])
def weekly_report_endpoint():
    try:
        secret = request.headers.get("X-Cron-Secret") or request.args.get("secret", "")
        if not CRON_SECRET or secret != CRON_SECRET:
            return jsonify({"ok": False, "error": "Unauthorized"}), 401

        store = _store()
        user_id = LINE_PUSH_USER_ID or store.get_setting("LINE_PUSH_USER_ID")
        if not user_id:
            return jsonify({"ok": False, "error": "Missing LINE_PUSH_USER_ID"}), 400

        start_date = request.args.get("start")
        end_date = request.args.get("end")
        message = weekly_report(store, start_date=start_date, end_date=end_date)
        _push(user_id, message)
        return jsonify({"ok": True})
    except Exception as exc:
        app.logger.exception("Weekly report failed")
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/debug/parse")
def debug_parse():
    if os.getenv("ENABLE_DEBUG_ENDPOINTS", "").lower() not in {"1", "true", "yes"}:
        return jsonify({"ok": False, "error": "Disabled"}), 404
    text = request.args.get("text", "")
    parsed = parse_item_amount(text)
    return jsonify({"ok": True, "item": parsed.item if parsed else "", "amount": parsed.amount if parsed else 0})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)
