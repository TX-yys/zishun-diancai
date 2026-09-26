# 一键部署到 Cloudflare（永久免费公网链接）
#
# 用法（在 D:\KAKAKAKAKA 目录下执行）：
#   powershell -ExecutionPolicy Bypass -File cloud-deploy\deploy.ps1
#
# 需要你先准备一个 Cloudflare API Token（脚本会提示怎么获取）

param(
  [string]$Token = $env:CF_API_TOKEN,
  [string]$AdminToken = $env:ADMIN_TOKEN
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$deployDir = Join-Path $root 'cloud-deploy'

function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Die($m)  { Write-Host $m -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host '  志顺小馆（小仝宝店）· 部署到 Cloudflare 公网' -ForegroundColor Yellow
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host ''

# ---------- 0. 找 node ----------
$node = $null
foreach ($c in @('node', 'D:\DSnode\node.exe', "$env:ProgramFiles\nodejs\node.exe")) {
  try { & $c --version > $null 2>&1; $node = $c; break } catch {}
}
if (-not $node) { Die '[错误] 找不到 node.exe' }
Ok "使用 node: $node"

# ---------- 1. 取 Token ----------
if (-not $Token) {
  Write-Host ''
  Warn '需要 Cloudflare API Token。获取步骤（约 2 分钟，免费、不需要信用卡）：'
  Write-Host '  1) 打开 https://dash.cloudflare.com/sign-up 注册（邮箱即可，免费）'
  Write-Host '  2) 登录后打开 https://dash.cloudflare.com/profile/api-tokens'
  Write-Host '  3) 点「Create Token」→ 选模板「Edit Cloudflare Workers」→ Continue'
  Write-Host '  4) 权限确认里有这几项即可：Workers Scripts: Edit、Workers KV Storage: Edit、Account Settings: Read'
  Write-Host '  5) 点 Continue → Create Token → 复制那串 Token（只显示一次）'
  Write-Host ''
  $Token = Read-Host '请粘贴 API Token 后回车'
}
$Token = $Token.Trim()
if (-not $Token) { Die '[错误] 没有拿到 Token' }

if (-not $AdminToken) {
  Write-Host ''
  Info '设置「接单台口令」（防止别人看到你的订单，随便设一个，例如 zishun2024）'
  $AdminToken = Read-Host '请输入接单台口令（直接回车 = 不设口令）'
}

# ---------- 2. 校验 Token ----------
Info ''
Info '[1/5] 校验 Token ...'
$verify = & $node (Join-Path $deployDir 'cf-api.mjs') verify $Token
if ($LASTEXITCODE -ne 0) { Die "[错误] Token 校验失败：$verify" }
Ok "  Token 有效（$verify）"

# ---------- 3. 准备部署文件 ----------
Info '[2/5] 同步最新代码到部署目录 ...'
& $node (Join-Path $root 'build-cloud.js') | Out-Null
Copy-Item (Join-Path $root 'cloud\worker.js') (Join-Path $deployDir 'worker.js') -Force
$size = (Get-Item (Join-Path $deployDir 'worker.js')).Length
Ok "  worker.js 已就绪（$size bytes）"

# ---------- 4. 创建 KV 并部署 ----------
Info '[3/5] 创建订单存储（KV）并部署 ...'
$result = & $node (Join-Path $deployDir 'cf-api.mjs') deploy $Token $AdminToken
if ($LASTEXITCODE -ne 0) { Die "[错误] 部署失败：`n$result" }

$lines = $result -split "`n" | Where-Object { $_.Trim() }
$url = ($lines | Where-Object { $_ -like 'URL=*' }) -replace '^URL=', ''
$adminUrl = ($lines | Where-Object { $_ -like 'ADMIN=*' }) -replace '^ADMIN=', ''
$kvId = ($lines | Where-Object { $_ -like 'KV=*' }) -replace '^KV=', ''

if (-not $url) { Die "[错误] 部署未返回地址：`n$result" }
Ok '  部署完成'

# ---------- 5. 存活检测 ----------
Info '[4/5] 等待生效并检测 ...'
$ok = $false
for ($i = 1; $i -le 12; $i++) {
  Start-Sleep -Seconds 5
  try {
    $r = Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}
if ($ok) { Ok '  公网地址已可访问' } else { Warn '  暂时还没响应（Cloudflare 首次部署有时要 1-2 分钟）' }

# ---------- 6. 输出结果 ----------
$qrFile = Join-Path $root '你的点菜链接.txt'
$content = @"
志顺小馆（小仝宝店）· 在线点菜
部署时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

【顾客点菜链接】（永久公网，任何网络任何设备都能打开）
$url

【接单台链接】（仅店员使用，请勿外发）
$adminUrl

【扫码桌贴页】（打开后点「打印桌贴」）
$($url)qr

订单存储：Cloudflare KV（命名空间 $kvId）
口令：$AdminToken
"@
$content | Out-File -FilePath $qrFile -Encoding UTF8

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '  部署成功！' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  【顾客点菜链接】  ' -NoNewline; Write-Host $url -ForegroundColor Yellow
Write-Host '  【接单台链接】    ' -NoNewline; Write-Host $adminUrl -ForegroundColor Yellow
Write-Host '  【扫码桌贴页】    ' -NoNewline; Write-Host "$($url)qr" -ForegroundColor Yellow
Write-Host ''
Ok '  以上信息已保存到：你的点菜链接.txt'
Write-Host ''
Write-Host '  下一步：'
Write-Host '    1. 用手机（可关 WiFi 用流量）打开上面的顾客链接，试着点一单'
Write-Host '    2. 打开接单台链接，确认能看到这单'
Write-Host '    3. 打开扫码桌贴页，点「打印桌贴」打印二维码贴桌上'
Write-Host ''
