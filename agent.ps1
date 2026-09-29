param(
    [string]$Workspace,
    [string]$Prompt,
    [ValidateSet('auto','bonsai','huihui')][string]$Model='auto',
    [switch]$Cpu,
    [switch]$TrustCommands,
    [ValidateRange(2048,262144)][int]$Context=16384,
    [ValidateRange(1,100)][int]$MaxSteps=24
)
. (Join-Path $PSScriptRoot 'common.ps1')
$server=$null
try {
    [Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
    [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
    $node=Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw 'コード作業モードにはNode.js 22以上が必要です。' }
    $nodeVersion=& $node.Source -p 'process.versions.node'
    if ([int]($nodeVersion.Split('.')[0]) -lt 22) { throw 'Node.js 22以上が必要です。' }
    if (-not $Workspace) { $Workspace=Read-Host '作業するプロジェクトのフォルダを入力' }
    $Workspace=(Resolve-Path -LiteralPath $Workspace -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) { throw '作業フォルダがありません。先にフォルダを作成してください。' }
    $spec=Select-BonsaiModels -Purpose chat -Choice $Model
    if (-not $spec) { exit 0 }
    $hardware=Get-BonsaiHardware
    $backend=$hardware.Backend
    if ($Cpu -or $hardware.VramMiB -lt $spec.MinVramMiB) { $backend='cpu' }
    $binary=Join-Path $PSScriptRoot "runtime\$backend\llama-server.exe"
    if (-not (Test-Path -LiteralPath $binary)) { throw '00-install.batで実行環境を導入してください。' }
    $modelPath=Join-Path $PSScriptRoot "models\$($spec.File)"
    $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
    $listener.Start()
    $port=$listener.LocalEndpoint.Port
    $listener.Stop()
    $key=[guid]::NewGuid().ToString('N')
    $env:BONSAI_AGENT_KEY=$key
    $ngl=if ($backend -eq 'cuda') {99} else {0}
    $logDir=Join-Path $PSScriptRoot 'logs'
    [IO.Directory]::CreateDirectory($logDir) | Out-Null
    $logStem=Join-Path $logDir ('server-'+[guid]::NewGuid().ToString('N'))
    $runArgs=@('-m',('"' + $modelPath + '"'),'-ngl',"$ngl",'-c',"$Context",'-np','1','-fa','on','--jinja','--skip-chat-parsing','--host','127.0.0.1','--port',"$port",'--api-key',$key,'--reasoning','off','--reasoning-budget','0')
    $server=Start-Process -FilePath $binary -ArgumentList $runArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput ($logStem+'.out.log') -RedirectStandardError ($logStem+'.err.log')
    $url="http://127.0.0.1:$port"
    Write-Host "$($spec.Label) / $backend 読み込み中..."
    $ready=$false
    for ($i=0; $i -lt 300; $i++) {
        if ($server.HasExited) { throw "モデルの起動に失敗しました。ログ: $logStem.err.log。GPUメモリ不足なら -Cpu または -Context 8192 を試してください。" }
        try {
            $null=Invoke-RestMethod -Uri "$url/health" -Headers @{Authorization="Bearer $key"} -TimeoutSec 2
            $ready=$true; break
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw 'モデルの起動がタイムアウトしました。' }
    $trust=if ($TrustCommands) {'true'} else {'false'}
    $env:BONSAI_AGENT_PROMPT=$Prompt
    & $node.Source (Join-Path $PSScriptRoot 'agent.cjs') $Workspace $url $trust "$MaxSteps"
    if ($LASTEXITCODE -ne 0) { throw "コード作業モードが異常終了しました ($LASTEXITCODE)。" }
} catch { Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
    Remove-Item Env:\BONSAI_AGENT_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:\BONSAI_AGENT_PROMPT -ErrorAction SilentlyContinue
}
