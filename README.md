# 🧱 沒人在乎牆軟體（No1Care Wall）

> **把沒人在乎的想法，好好貼在牆上。**  
> 依據 **Padlet** 完整軟體規格打造、**支援無限制牆面（∞）**的開源數位協作佈告牆。

---

## ✨ 為什麼做「沒人在乎牆軟體」？

**Padlet** 是全球極受歡迎的數位協作佈告牆工具，但免費帳號僅限建立 **3 面牆**。  
**沒人在乎牆軟體（No1Care）**完整對齊 Padlet 的核心功能與規格，並**移除牆面數量限制**，同時提供「免後端靜態離線模式」與「零依賴 Node.js 多人即時協作模式」雙架構。

---

## 📋 完整功能規格對照（對齊 Padlet）

| 規格分類 | 功能項目 | 沒人在乎牆軟體（No1Care）實作 |
| :--- | :--- | :--- |
| **牆面管理** | 牆面建立上限 | **無限制（∞）**，含搜尋、星號收藏、封存、6 套快速範本與 **Remake 複製重製** |
| **7 大佈局格式** | 即時無損切換 | 🧱 **磚牆（Wall）**、📚 **欄位書架（Shelf / Columns，支援跨欄拖曳）**、▦ **格狀（Grid）**、📜 **串流（Stream）**、🕸️ **自由畫布（Canvas + 智慧連線與標籤）**、⏳ **時間軸（Timeline）**、🗺️ **互動世界地圖（Map 點擊釘選）** |
| **多媒體貼文** | 內容與附件類型 | 純文字（支援 `**粗體**`、`*斜體*`、`` `程式碼` `` 與自動網址）、本地圖片上傳（自動壓縮）與圖片網址、**內建手繪塗鴉板**、**內建瀏覽器錄音**、網頁連結與 **YouTube 自動嵌入**、檔案附件、**內建互動投票（Poll）**、卡片底色分類與置頂 |
| **互動與審核** | 協作與控制 | 5 種反應模式（關閉 / 按讚 ♥ / 投票 ▲▼ / 星級評分 ★ / 分數 0–100）、留言討論串、**發文審核機制（Moderation）**、**敏感詞過濾**、訪客唯讀/可寫權限、**密碼上鎖保護** |
| **外觀客製化** | 視覺風格 | 8 款精選質感桌布 + 自訂圖片網址桌布、4 種字體（黑體 / 明體 / 圓體 / 等寬）、明暗卡片主題、自訂 Emoji 圖示 |
| **簡報與匯出** | 分享與備份 | **全螢幕簡報放映模式（Slideshow）**、**離線 QR Code 產生器**、匯出 **JSON / CSV / Markdown / 列印 PDF**、整站備份與匯入 |
| **雙模式架構** | 儲存與同步 | 靜態頁面自動使用 **IndexedDB + BroadcastChannel（跨分頁即時同步）**；啟動 `server.js` 自動升級為 **REST API + SSE 多人跨裝置即時協作** |

---

## 🚀 快速開始

### 方式一：多人即時協作模式（推薦，零 npm 依賴）

只需安裝 Node.js 18+，無需 `npm install` 任何第三方套件：

```bash
git clone https://github.com/childkuo/no1care.git
cd no1care
npm start
```

啟動後開啟瀏覽器前往 `http://localhost:3000`，所有牆面資料會自動持久保存在 `data/db.json`，並透過 Server-Sent Events（SSE）實現多人即時同步！

可透過環境變數自訂埠號：

```bash
PORT=8080 npm start
```

### 方式二：GitHub Pages 靜態部署 / 本機直接使用

本專案已內建 `.github/workflows/pages.yml`。只需在 GitHub Repo 的 **Settings → Pages → Source** 選擇 **GitHub Actions**，即可自動免費部署！  
靜態模式下會自動使用瀏覽器 **IndexedDB** 儲存無限制牆面與多媒體檔案，並可隨時透過 JSON 匯出/匯入搬移資料。

---

## 🗂️ 專案架構

```text
no1care/
├── index.html                   # 語意化 HTML5 入口
├── server.js                    # 選用：零依賴 Node.js 即時協作伺服器 (REST + SSE)
├── package.json                 # npm start / dev 腳本
├── css/
│   ├── tokens.css               # 設計系統變數、字體、卡片色票、8 款桌布
│   ├── layout.css               # 頂部導覽、無限制牆面工作區、Modal 與設定抽屜
│   └── boards.css               # 7 種 Padlet 版面、貼文卡片、簡報模式與列印樣式
└── js/
    ├── constants.js             # 佈局規格、範本、桌布、內建地點與示範牆
    ├── storage.js               # 雙模式儲存與即時同步引擎 (IndexedDB/BC + REST/SSE)
    ├── utils.js                 # 安全富文字、圖片壓縮、CSV/MD/JSON 匯出、離線 QR 產生器
    ├── app.js                   # 主控制器（儀表板、牆面、拖曳與連線引擎、設定抽屜）
    └── components/
        ├── draw-pad.js          # HTML5 Canvas 手繪塗鴉板
        ├── audio-recorder.js    # MediaRecorder 瀏覽器錄音元件
        ├── world-map.js         # 離線向量世界地圖與釘選互動元件
        └── slideshow.js         # 全螢幕簡報放映模式
```

---

## ⌨️ 快捷鍵

- 在牆面視圖按下 **`N`**：快速開啟新增貼文視窗
- 在簡報放映模式按下 **`←`** / **`→`** / **`空白鍵`**：切換上一張／下一張投影片
- 在簡報放映模式按下 **`Esc`**：離開簡報模式

---

## 📄 License

MIT