$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

if ($nodeCommand) {
    $nodePath = $nodeCommand.Source
} else {
    $candidates = @(
        'C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe',
        'C:\Program Files\Adobe\Adobe Photoshop 2025\node.exe',
        'C:\Program Files\Common Files\Adobe\Creative Cloud Libraries\libs\node.exe'
    )
    $nodePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $nodePath) {
    throw '找不到 Node.js 20 或更新版本。請先安裝 Node.js：https://nodejs.org/'
}

Set-Location -LiteralPath $projectRoot
Write-Host '正在啟動《今晚誰搞事？》…' -ForegroundColor Yellow
Write-Host '大螢幕請開啟：http://localhost:3000' -ForegroundColor Cyan
Write-Host '同一 Wi-Fi 的手機請使用此電腦的區網 IP；Host 頁面的 QR Code 會沿用瀏覽器網址。' -ForegroundColor DarkGray
& $nodePath server.js
