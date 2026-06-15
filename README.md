# LINE AI 記帳助理

這是一個極簡 LINE 記帳機器人。使用者只要在 LINE 傳 `午餐 120`、`薪水 42000`、`還款 學貸 6000`，系統會自動分類、寫入 Google Sheets，並回覆預算、還款進度、月回顧與每週一週報。

## 功能

- LINE 聊天記帳：`項目 金額`
- 自動分類支出與收入
- Google Sheets 儲存資料
- 生活預算與存錢目標
- 固定債務與信用卡帳單還款進度
- 月回顧
- 每週一 12:00 自動推送上週一到週日的花費統計

## Google Sheets 結構

請用你的私人 Google 帳號建立一份 Google Sheet。不要用 `kate1015@2motor.tw` 建立或持有這份資料表。

程式會在既有 Sheet 裡檢查並補齊以下工作表與表頭：

| 工作表 | 欄位 |
|---|---|
| `dashboard` | 可自行放公式、樞紐分析表與圖表 |
| `expenses` | 日期、時間、項目、金額、分類 |
| `income` | 日期、時間、項目、金額、分類 |
| `budgets` | 月份、分類、預算 |
| `debts` | 名稱、原始金額、已還金額、剩餘金額、狀態 |
| `bills` | 月份、名稱、應繳金額、已繳金額、未繳金額、狀態 |
| `repayments` | 日期、時間、類型、名稱、金額、備註 |
| `settings` | 設定項、設定值 |

`dashboard` 可以用 Google Sheets 內建圖表做儀表板，例如：

- 本月總收入
- 本月總支出
- 本月已存金額
- 存錢目標達成率
- 生活支出分類圓餅圖
- 每日支出折線圖
- 工作支出統計
- 還款進度
- 最大支出 Top 10

## Google Cloud 與 Service Account

1. 到 Google Cloud Console 建立一個 Project。
2. 啟用 Google Sheets API。
3. 建立 Service Account。
4. 下載 JSON key。
5. 將 JSON key 另存為 `service_account.json`，不要 commit。
6. 複製 JSON 裡的 `client_email`。
7. 回到你的私人 Google Sheet，按分享，將這個 service account email 加為編輯者。

重點：Sheet 由私人帳號擁有，service account 只負責程式讀寫。

## LINE Developers 設定

1. 進入 LINE Developers。
2. 建立 Provider。
3. 建立 Messaging API Channel。
4. 到 Messaging API 分頁取得：
   - Channel secret
   - Channel access token
5. 開啟 Use webhook。
6. Auto-reply messages 建議關閉，避免和機器人回覆重複。
7. Webhook URL 部署後設定為：

```text
https://你的-render-app.onrender.com/callback
```

## 本地安裝

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

編輯 `.env`：

```text
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
GOOGLE_SHEET_ID=...
GOOGLE_SERVICE_ACCOUNT_FILE=service_account.json
LINE_PUSH_USER_ID=
CRON_SECRET=...
TIMEZONE=Asia/Taipei
```

啟動：

```bash
python app.py
```

健康檢查：

```text
http://localhost:5000/
```

## ngrok 本地測試

```bash
ngrok http 5000
```

將 ngrok 產生的 HTTPS URL 加上 `/callback`，填入 LINE Developers 的 Webhook URL：

```text
https://xxxx.ngrok-free.app/callback
```

在 LINE Developers 按 Verify，成功後就可以從 LINE 傳訊測試。

第一次從 LINE 傳訊時，程式會把你的 LINE userId 寫入 `settings` 的 `LINE_PUSH_USER_ID`。之後每週週報可以用這個 userId 推播。

## Render 免費部署

1. 將專案推到 GitHub。
2. Render 建立 Web Service。
3. Runtime 選 Python。
4. Build Command：

```bash
pip install -r requirements.txt
```

5. Start Command：

```bash
gunicorn app:app
```

6. 設定環境變數：

```text
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
GOOGLE_SHEET_ID
GOOGLE_SERVICE_ACCOUNT_JSON
LINE_PUSH_USER_ID
CRON_SECRET
TIMEZONE=Asia/Taipei
```

Render 上建議使用 `GOOGLE_SERVICE_ACCOUNT_JSON`，把完整 JSON 放進環境變數，不要上傳真實 key 檔。

## 每週一 12:00 週報

週報 endpoint：

```text
POST /weekly-report
```

需要帶 secret：

```text
X-Cron-Secret: 你的 CRON_SECRET
```

也可以用 query string 測試：

```text
https://你的-render-app.onrender.com/weekly-report?secret=你的CRON_SECRET
```

建議用 Render Cron Job 或 GitHub Actions 每週一 12:00 Asia/Taipei 呼叫。若使用 UTC，台灣週一 12:00 等於 UTC 週一 04:00。

週報內容會統計上週一到上週日：

- 總收入
- 生活支出
- 工作支出
- 還款金額
- 分類統計
- 最大支出 Top 5
- 規則式小結

## LINE 指令

### 記支出

```text
午餐 120
停車費 30
拍攝道具 890
```

成功回覆：

```text
已記錄 ✅

項目：午餐
金額：120 元
分類：餐飲
```

### 記收入

```text
薪水 42000
接案收入 8000
退稅 1200
```

### 設定預算

```text
設定預算 餐飲 12000
設定預算 交通 4000
設定存錢目標 30000
```

### 查預算

```text
預算
```

### 固定債務

```text
新增債務 學貸 120000
還款 學貸 6000
```

### 信用卡帳單

```text
新增帳單 LINE Bank信用卡 11623
繳卡費 LINE Bank信用卡 5000
```

### 查還款

```text
還款進度
```

### 月回顧

```text
月回顧
本月回顧
```

## 分類規則

分類規則在 `category.py`。

支出分類：

- 餐飲：早餐、午餐、晚餐、宵夜、飲料、咖啡、星巴克
- 交通：油錢、停車、停車費、捷運、Uber、計程車
- 購物：蝦皮、衣服、鞋子
- 生活：生活用品、訂閱、房租、水電、電信、網路
- 工作支出：拍攝、道具、廣告、印刷、設計、素材
- 其他：未符合規則者

收入分類：

- 固定收入：薪水、獎金
- 額外收入：接案收入、接案、外快、兼職
- 退款：退款、退稅
- 其他收入：未符合規則者

要修改分類，只要編輯 `EXPENSE_KEYWORDS` 或 `INCOME_KEYWORDS`。

## 預算規則

預算邏輯在 `budget.py`。

- 生活預算只針對餐飲、交通、購物、生活提醒。
- 工作支出只追蹤，不提醒超支。
- 生活分類達 80% 會提醒使用率。
- 生活分類達 100% 會提醒已超支。
- 還款會影響本月現金流，但獨立顯示，不混入生活支出。

## 常見錯誤

### LINE Verify 失敗

- 確認 Webhook URL 是 HTTPS。
- 確認 URL 結尾是 `/callback`。
- 確認 `LINE_CHANNEL_SECRET` 正確。
- 確認 Render app 已啟動。

### LINE 回 401 或 403

- 確認 `LINE_CHANNEL_ACCESS_TOKEN` 沒有貼錯。
- 重新 issue token 後要更新 Render 環境變數。

### Google Sheets permission denied

- 確認私人 Google Sheet 已分享給 service account 的 `client_email`。
- 權限要是編輯者。
- 確認 `GOOGLE_SHEET_ID` 是正確 Sheet ID。

### 找不到 service account 憑證

- 本地請放 `service_account.json`。
- Render 請設定 `GOOGLE_SERVICE_ACCOUNT_JSON`。

### 週報沒有送出

- 確認 `CRON_SECRET` 一致。
- 確認 `LINE_PUSH_USER_ID` 已設定。
- 可以先從 LINE 傳一則訊息，讓系統把 userId 寫入 `settings`。

### Render cold start

免費方案可能會休眠，第一次呼叫較慢。若週報很重要，可以用 Render Cron Job 先喚醒或考慮付費方案。
