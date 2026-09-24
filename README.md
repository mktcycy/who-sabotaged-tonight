# 今晚誰搞事？MVP

4–10 人即時多人 Web 派對遊戲。大螢幕建立房間，每位玩家使用手機加入。

## 啟動

在 Windows PowerShell 執行：

```powershell
.\啟動遊戲.ps1
```

接著在大螢幕開啟 `http://localhost:3000`。手機與主機需在同一網路；請讓大螢幕以主機區網 IP 開啟，例如 `http://192.168.1.20:3000`，如此 QR Code 才能由手機連入。

若 Windows 防火牆詢問，需允許私人網路存取。

## 測試

需要 Node.js 20 以上：

```powershell
node --test tests/*.test.js
```

## Docker 部署

```powershell
docker build -t who-sabotaged-tonight .
docker run --rm -p 3000:3000 -v game-data:/app/data who-sabotaged-tonight
```

正式環境必須把 `/app/data` 掛載至持久化磁碟，否則平台重新建立容器時，進行中的房間會消失。健康檢查端點為 `/health`。

推送至 GitHub `main` 分支後，GitHub Actions 會先執行全部測試，再發布 `ghcr.io/<owner>/who-sabotaged-tonight:latest` 容器映像。

## 架構

- `server.js`：HTTP API、SSE 即時同步、權限隔離與自動階段計時。
- `src/game-engine.js`：可獨立測試的遊戲規則與狀態機。
- `src/content.js`：18 個事件與 20 個秘密任務。
- `src/store.js`：JSON 原子持久化。
- `public/`：Host 大螢幕與玩家手機介面。
- `data/rooms.json`：執行時建立的房間狀態，不納入版本控制。

## 已採用的 V1.1 決策

- Conditional Effect 一律依事件開始時的 `statsBefore` 判斷。
- 遊戲開始後禁止新玩家加入，只允許原 Token 恢復。
- 投票倒數結束前，斷線後恢復的玩家仍可投票。
- 在線玩家全數投票後保留 3 秒寬限期。
- 投票完成數分母固定為本局總人數。
- 情報優先不重複；候選情報不足時才重複。
- 區間任務包含上下界。
- 少數選項排除 0 票與棄權；全同票時沒有少數選項。
- 搞事仔不抽普通秘密任務，只顯示固定破壞目標。
- 玩家退出／移除只允許發生在 Lobby；遊戲中以離線處理。
- 同時符合多個死亡條件時全部列出。
- 投票預設 45 秒，Host 可強制結束。
