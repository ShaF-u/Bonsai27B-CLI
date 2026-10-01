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
    if (-not $Workspace) { $Workspace=$env:BONSAI_DEFAULT_WORKSPACE }
    if (-not $Workspace) { $Workspace=Read-Host '作業するプロジェクトのフォルダを入力' }
    $Workspace=(Resolve-Path -LiteralPath $Workspace -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) { throw '作業フォルダがありません。先にフォルダを作成してください。' }
    $spec=Select-BonsaiModels -Purpose chat -Choice $Model
    if (-not $spec) { exit 0 }
    $hardware=Get-BonsaiHardware
    $backend=$hardware.Backend
    if ($Cpu -or $hardware.VramMiB -lt $spec.MinVramMiB) { $backend='cpu' }
    $binary=Join-Path $BonsaiRoot "runtime\$backend\llama-server.exe"
    if (-not (Test-Path -LiteralPath $binary)) { throw '00-install.batで実行環境を導入してください。' }
    $modelPath=Join-Path $BonsaiRoot "models\$($spec.File)"
    if (-not (Test-Path -LiteralPath $modelPath -PathType Leaf) -or (Get-Item -LiteralPath $modelPath).Length -ne $spec.Size) { throw 'モデルが不完全です。00-install.batを再実行してください。' }
    Select-BonsaiGpu $hardware $backend
    if ($TrustCommands) { Write-Host '警告: -TrustCommands 指定中。AIが生成したPowerShellコマンドを確認なしで実行します（作業フォルダ外にもアクセス可能）。' -ForegroundColor Yellow }
    $key=[guid]::NewGuid().ToString('N')
    $env:BONSAI_AGENT_KEY=$key
    $ngl=if ($backend -eq 'cuda') {99} else {0}
    $logDir=Join-Path $BonsaiRoot 'logs'
    [IO.Directory]::CreateDirectory($logDir) | Out-Null
    # Server logs and agent backups accumulate; keep 30 days.
    Get-ChildItem -LiteralPath $logDir -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(server-|agent-)' -and $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    $timeout=if ($backend -eq 'cpu') {900} else {300}
    $ready=$false
    # The port can be taken between probing and server start, so retry with a fresh port.
    for ($attempt=1; $attempt -le 3 -and -not $ready; $attempt++) {
        $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
        $listener.Start()
        $port=$listener.LocalEndpoint.Port
        $listener.Stop()
        $logStem=Join-Path $logDir ('server-'+[guid]::NewGuid().ToString('N'))
        $runArgs=@('-m',('"' + $modelPath + '"'),'-ngl',"$ngl",'-c',"$Context",'-np','1','-fa','on','--jinja','--skip-chat-parsing','--host','127.0.0.1','--port',"$port",'--api-key',$key,'--reasoning','off','--reasoning-budget','0')
        $server=Start-Process -FilePath $binary -ArgumentList $runArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput ($logStem+'.out.log') -RedirectStandardError ($logStem+'.err.log')
        $url="http://127.0.0.1:$port"
        Write-Host "$($spec.Label) / $backend 読み込み中..."
        for ($i=0; $i -lt $timeout; $i++) {
            if ($server.HasExited) { break }
            try {
                $null=Invoke-RestMethod -Uri "$url/health" -Headers @{Authorization="Bearer $key"} -TimeoutSec 2
                $ready=$true; break
            } catch { Start-Sleep -Seconds 1 }
        }
        if ($ready) { break }
        if (-not $server.HasExited) { throw 'モデルの起動がタイムアウトしました。' }
        $err=Get-Content -LiteralPath ($logStem+'.err.log') -Raw -ErrorAction SilentlyContinue
        if ($err -notmatch 'bind|address already in use') { throw "モデルの起動に失敗しました。ログ: $logStem.err.log。GPUメモリ不足なら -Cpu または -Context 8192 を試してください。" }
    }
    if (-not $ready) { throw 'サーバーの起動に失敗しました（ポート確保に3回失敗）。' }
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
