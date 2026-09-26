<#
    ThinkBook 16p G5 IRX (21N5) 卡顿优化脚本
    目标：削减开机常驻进程 / 内存占用，恢复「最佳性能」电源策略

    用法：
      1) 右键本文件 -> 「使用 PowerShell 运行」，或在管理员 PowerShell 里执行：
         powershell -ExecutionPolicy Bypass -File "D:\KAKAKAKAKA\dsh-optimize.ps1"
      2) 想同时关闭「内存完整性(VBS)」以换取更多内存和 CPU（降低安全性）：
         powershell -ExecutionPolicy Bypass -File "D:\KAKAKAKAKA\dsh-optimize.ps1" -DisableVBS

    所有改动都可回滚，回滚脚本会生成到桌面：dsh-rollback.ps1
    未做任何卸载，改的都是「启动方式」。
#>

[CmdletBinding()]
param(
    [switch]$DisableVBS
)

$ErrorActionPreference = 'Continue'

# ---------- 0. 权限检查 ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "× 需要管理员权限。请右键以管理员身份运行 PowerShell 后重试。" -ForegroundColor Red
    exit 1
}

$rollback = @()
$rollback += '# 自动生成的回滚脚本 —— 以管理员身份运行即可还原'
$rollback += '$ErrorActionPreference = "Continue"'

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

Say "`n===== ThinkBook 16p 优化开始 =====`n" 'Cyan'

$memBefore = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2)
$procBefore = (Get-Process).Count
Say "优化前：可用内存 ${memBefore} GB / 进程数 $procBefore`n"

# ---------- 1. 计划任务 ----------
Say "[1/5] 禁用更新器类计划任务" 'Yellow'

$taskNames = @(
    'WpsUpdateLogonTask_*'
    'WpsUpdateTask_*'
    'WpsWakeWnsLogonTask'
    'NVIDIA App SelfUpdate_*'
    'Launch Adobe CCXProcess'
    'QuarkUpdaterTaskUser*'
    'SoftLandingCreativeManagementTask'
    'Lenovo UDC Diagnostic Scan'
)

foreach ($pat in $taskNames) {
    Get-ScheduledTask -ErrorAction SilentlyContinue |
        Where-Object { $_.TaskName -like $pat -and $_.State -ne 'Disabled' } |
        ForEach-Object {
            try {
                Disable-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction Stop | Out-Null
                Say ("   已禁用  " + $_.TaskPath + $_.TaskName) 'Green'
                $rollback += "Enable-ScheduledTask -TaskName '$($_.TaskName)' -TaskPath '$($_.TaskPath)' -ErrorAction SilentlyContinue | Out-Null"
            } catch {
                Say ("   跳过    " + $_.TaskName + "  (" + $_.Exception.Message + ")") 'DarkGray'
            }
        }
}

# ---------- 2. 联想 / 第三方常驻服务 ----------
Say "`n[2/5] 将非必要常驻服务改为「手动启动」（不卸载，可回滚）" 'Yellow'

# 安全保留（不动）：LenovoFnAndFunctionKeys 是 Fn 快捷键，必须保留
$keep = @('LenovoFnAndFunctionKeys', 'ImControllerService', 'LnvSvcFdn', 'HRWSCCtrl')

# 判定为「AI 助手 / 电脑管家 / 诊断上传 / 虚拟形象」类，属于纯臃肿
$bloat = @(
    'XLSmartService'                    # 联想小天服务程序
    'LeMCPManagerService'
    'LenovoPcManagerService'            # 联想电脑管家
    'LenovoSmartFusionService'
    'LenovoServiceAS'
    'LISFService'                       # Lenovo Internet Software Framework
    'UDCService'                        # Universal Device Client 诊断上传
    'WinSpace'
    'LnvVCamDataCenter'                 # 虚拟摄像头
    'LnvVirtCameraInstaller'
    'LRAvatarService'                   # 虚拟形象
    'SmartAppearanceAISVC'              # AI 美颜
    'Lenovo Smart Communication Intelligent Sensing Service'
)

foreach ($svc in $bloat) {
    if ($keep -contains $svc) { continue }
    $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if (-not $s) { continue }
    $wmi = Get-CimInstance Win32_Service -Filter "Name='$svc'" -ErrorAction SilentlyContinue
    $old = if ($wmi) { $wmi.StartMode } else { 'Auto' }
    try {
        Set-Service -Name $svc -StartupType Manual -ErrorAction Stop
        Say "   $svc : $old -> Manual" 'Green'
        $rollback += "Set-Service -Name '$svc' -StartupType $old -ErrorAction SilentlyContinue"
    } catch {
        Say "   $svc : 失败 ($($_.Exception.Message))" 'DarkGray'
    }
}

Say "`n   （以下服务已保留，关闭会影响功能，故不动）" 'DarkGray'
foreach ($k in $keep) { Say "     $k" 'DarkGray' }

# ---------- 3. 关闭不必要的开机自启注册表项 ----------
Say "`n[3/5] 关闭不必要的开机自启项" 'Yellow'

$runKeys = @(
    @{ Path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'; Name = 'MicrosoftEdgeAutoLaunch_D33965F90FBE7F865D2DD3C5D48D835F'; Desc = 'Edge 开机预启动' }
    @{ Path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'; Name = 'Microsoft.Lists'; Desc = 'OneDrive Lists 组件' }
)

foreach ($item in $runKeys) {
    $val = (Get-ItemProperty -Path $item.Path -Name $item.Name -ErrorAction SilentlyContinue).($item.Name)
    if ($val) {
        try {
            Remove-ItemProperty -Path $item.Path -Name $item.Name -ErrorAction Stop
            Say "   已移除  $($item.Name)  ($($item.Desc))" 'Green'
            $esc = $val -replace "'", "''"
            $rollback += "Set-ItemProperty -Path '$($item.Path)' -Name '$($item.Name)' -Value '$esc' -ErrorAction SilentlyContinue"
        } catch {
            Say "   失败    $($item.Name)" 'DarkGray'
        }
    }
}

# ---------- 4. 电源策略：恢复到性能优先 ----------
Say "`n[4/5] 电源策略：性能优先" 'Yellow'

powercfg /overlaysetactive ded574b5-45a0-4f42-8737-46345c09c238 2>$null   # 最佳性能
powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 5 2>$null
powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100 2>$null
powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR be337238-0d82-4146-a960-4f3749d470c7 2 2>$null  # 睿频=Aggressive
powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR 36687f9e-e3a5-4dbf-b1dc-15eb381c6863 0 2>$null  # EPP=性能
powercfg /setactive SCHEME_CURRENT 2>$null

$overlay = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes' -ErrorAction SilentlyContinue).ActiveOverlayAcPowerScheme
Say "   交流电源模式 GUID = $overlay" 'Green'
Say "   (ded574b5-... = 最佳性能；961cc777-... = 最佳能效)" 'DarkGray'

$rollback += "powercfg /overlaysetactive 961cc777-2547-4f9d-8174-7d86181b8a7a"
$rollback += "powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 5; powercfg /setactive SCHEME_CURRENT"

# ---------- 5. 可选：关闭内存完整性 (VBS/HVCI) ----------
Say "`n[5/5] 内存完整性 (VBS/HVCI)" 'Yellow'
if ($DisableVBS) {
    try {
        # 关闭 HVCI
        New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' `
            -Name 'Enabled' -Value 0 -PropertyType DWord -Force -ErrorAction Stop | Out-Null
        # 关闭 VBS
        New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard' `
            -Name 'EnableVirtualizationBasedSecurity' -Value 0 -PropertyType DWord -Force -ErrorAction Stop | Out-Null
        Say "   已关闭 VBS/HVCI（需重启生效，可释放约 200-500MB 内存及部分 CPU 开销）" 'Green'
        Say "   ⚠ 这会降低对内核级攻击的防护，请自行权衡" 'Red'
        $rollback += "New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' -Name 'Enabled' -Value 1 -PropertyType DWord -Force"
        $rollback += "New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard' -Name 'EnableVirtualizationBasedSecurity' -Value 1 -PropertyType DWord -Force"
    } catch {
        Say "   失败：$($_.Exception.Message)" 'DarkGray'
    }
} else {
    Say "   跳过（未指定 -DisableVBS）。如需可用 -DisableVBS 参数重新运行。" 'DarkGray'
}

# ---------- 6. 清理临时文件 ----------
Say "`n[6/6] 清理临时文件" 'Yellow'
$freed = 0
foreach ($d in @($env:TEMP, "$env:LOCALAPPDATA\Microsoft\Windows\INetCache", 'C:\Windows\SoftwareDistribution\Download')) {
    if (Test-Path $d) {
        $sz = (Get-ChildItem $d -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
        Get-ChildItem $d -Recurse -Force -ErrorAction SilentlyContinue |
            Where-Object { -not $_.PSIsContainer } |
            Remove-Item -Force -ErrorAction SilentlyContinue
        $freed += [math]::Round($sz / 1MB, 0)
    }
}
Say "   清理约 ${freed} MB（正在占用的文件会自动跳过）" 'Green'

# ---------- 汇总 ----------
Start-Sleep -Seconds 2
$memAfter = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 2)
$procAfter = (Get-Process).Count
$os = Get-CimInstance Win32_OperatingSystem
$commit = [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB, 2)

Say "`n===== 完成 =====" 'Cyan'
Say "可用内存：${memBefore} GB -> ${memAfter} GB"
Say "进程数：  $procBefore -> $procAfter"
Say "提交内存：$commit GB / 物理 15.71 GB"
Say "`n下一步：重启一次让服务改动完全生效。" 'Yellow'

# 写回滚脚本
$rollbackFile = "$env:USERPROFILE\Desktop\dsh-rollback.ps1"
$rollback | Set-Content -Path $rollbackFile -Encoding UTF8
Say "回滚脚本已生成：$rollbackFile" 'Cyan'
Say "（以管理员身份运行该脚本即可还原本次所有改动）`n" 'Cyan'
