param([switch]$Cpu,[string]$Prompt,[string]$PromptFile,[switch]$NoThinking,[int]$Context=0,[int]$MaxTokens=4096,[switch]$SimpleIO)
. (Join-Path $PSScriptRoot 'common.ps1')
try {
    [Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
    [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
    $OutputEncoding=[Console]::OutputEncoding
    $hardware=Get-BonsaiHardware
    $backend=$hardware.Backend
    if ($Cpu) { $backend='cpu' }
    $binary=Join-Path $PSScriptRoot "runtime\$backend\llama-cli.exe"
    $model=Join-Path $PSScriptRoot "models\$ModelName"
    if (-not (Test-Path -LiteralPath $binary) -or -not (Test-Path -LiteralPath $model)) { throw 'Not installed for this PC. Run 00-install.bat first.' }
    if ((Get-Item -LiteralPath $model).Length -ne $ModelSize) { throw 'Model is incomplete. Run 00-install.bat.' }
    if ($Context -eq 0) { $Context=if ($backend -eq 'cpu') {8192} else {$hardware.Context} }
    if ($Context -lt 1024 -or $Context -gt 262144) { throw 'Context must be between 1024 and 262144.' }
    if ($Prompt -and $PromptFile) { throw 'Use either -Prompt or -PromptFile.' }
    $ngl=if ($backend -eq 'cuda') {99} else {0}
    $runArgs=@('-m',$model,'-ngl',"$ngl",'-c',"$Context",'-n',"$MaxTokens",'-fa','on','--jinja','--temp','0.7','--top-p','0.95','--top-k','20','--min-p','0','--log-disable','-sys','You are a helpful assistant. Reply in Japanese unless the user requests another language.')
    if ($NoThinking) { $runArgs+=@('--reasoning','off','--reasoning-budget','0') }
    if ($SimpleIO) { $runArgs+='--simple-io' }
    if ($Prompt) {
        $tempPrompt=Join-Path ([IO.Path]::GetTempPath()) ('bonsai-prompt-'+[guid]::NewGuid().ToString()+'.txt')
        [IO.File]::WriteAllText($tempPrompt,$Prompt,(New-Object Text.UTF8Encoding($false)))
        $runArgs+=@('-f',$tempPrompt,'-st')
    } elseif ($PromptFile) {
        $resolved=(Resolve-Path -LiteralPath $PromptFile).Path
        $runArgs+=@('-f',$resolved,'-st')
    }
    Write-Host "Bonsai 27B | $backend | context=$Context"
    Write-Host 'Type your message and press Enter. /exit to quit. Ctrl+C interrupts generation.'
    & $binary @runArgs
    $code=$LASTEXITCODE
    if ($code -ne 0) { Write-Host 'If GPU memory is insufficient, close other AI apps or use 02-chat-cpu.bat.' }
    exit $code
} catch { Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
finally { if ($tempPrompt -and (Test-Path -LiteralPath $tempPrompt)) { Remove-Item -LiteralPath $tempPrompt -Force } }
