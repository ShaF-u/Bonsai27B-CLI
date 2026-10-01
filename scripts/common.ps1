$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$script:Release = 'prism-b10743-adfffbe'
$script:BonsaiRoot = Split-Path -Parent $PSScriptRoot
function Get-BonsaiHardware {
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_IDENTIFIER -match 'ARM') { throw 'This package requires x64 Windows 10/11.' }
    $backend='cpu'; $vram=0; $gpu=$null
    $smi=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if ($smi) {
        $info=(& $smi.Source 2>$null | Out-String)
        # Use the GPU with the most memory, not just the first one.
        foreach ($row in @(& $smi.Source --query-gpu=index,memory.total --format=csv,noheader,nounits 2>$null)) {
            $parts="$row".Split(','); $index=0; $parsed=0
            if ($parts.Count -eq 2 -and [int]::TryParse($parts[0].Trim(),[ref]$index) -and [int]::TryParse($parts[1].Trim(),[ref]$parsed) -and $parsed -gt $vram) { $vram=$parsed; $gpu=$index }
        }
        if ($info -match 'CUDA(?:\s+UMD)?\s+Version:\s+(\d+)\.(\d+)') {
            if (([int]$Matches[1] -gt 12 -or ([int]$Matches[1] -eq 12 -and [int]$Matches[2] -ge 4)) -and $vram -ge 6000) { $backend='cuda' }
        }
    }
    $ctx=8192
    if ($backend -eq 'cuda' -and $vram -ge 11000) { $ctx=32768 }
    [pscustomobject]@{Backend=$backend;VramMiB=$vram;Context=$ctx;GpuIndex=$gpu}
}
function Select-BonsaiGpu($Hardware,[string]$Backend) {
    if ($Backend -eq 'cuda' -and $null -ne $Hardware.GpuIndex) { $env:CUDA_VISIBLE_DEVICES="$($Hardware.GpuIndex)" }
}
function Assert-Hash([string]$Path,[string]$Expected) {
    $actual=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actual -ne $Expected) { throw "SHA256 mismatch: $Path. Rename the damaged file and run 00-install.bat again." }
}
function Get-CheckedDownload([string]$Url,[string]$Path,[string]$Hash) {
    if (Test-Path -LiteralPath $Path) { Assert-Hash $Path $Hash; return }
    $partial=$Path+'.part'
    Write-Host "Downloading: $([IO.Path]::GetFileName($Path))"
    $curl=Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & $curl.Source --fail --location --retry 5 --retry-delay 3 --connect-timeout 30 --continue-at - --output $partial $Url
        if ($LASTEXITCODE -ne 0) { throw 'Download failed. Run 00-install.bat again to resume.' }
    } elseif (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
        Start-BitsTransfer -Source $Url -Destination $partial -DisplayName 'Bonsai download'
    } else {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $partial
    }
    # A corrupt partial file would otherwise be resumed and fail forever.
    try { Assert-Hash $partial $Hash }
    catch { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue; throw 'SHA256 mismatch after download. The damaged file was removed; run 00-install.bat again.' }
    Move-Item -LiteralPath $partial -Destination $Path
}
function Ensure-VcRuntime {
    $needsInstall=$false
    foreach ($name in @('vcruntime140.dll','vcruntime140_1.dll','msvcp140.dll')) {
        $dll=Join-Path $env:SystemRoot "System32\$name"
        if (-not (Test-Path -LiteralPath $dll)) { $needsInstall=$true; break }
        $v=(Get-Item -LiteralPath $dll).VersionInfo
        if ($v.FileMajorPart -lt 14 -or ($v.FileMajorPart -eq 14 -and $v.FileMinorPart -lt 44)) { $needsInstall=$true; break }
    }
    if (-not $needsInstall) { return }
    Write-Host 'Installing Microsoft Visual C++ x64 runtime. Windows may request administrator approval.'
    $redist=Join-Path $BonsaiRoot 'downloads\vc_redist.x64.exe'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vc14/vc_redist.x64.exe' -OutFile $redist
    $signature=Get-AuthenticodeSignature -LiteralPath $redist
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Microsoft runtime signature verification failed.' }
    $setup=Start-Process -FilePath $redist -ArgumentList '/install','/passive','/norestart' -Wait -PassThru -WindowStyle Hidden
    if ($setup.ExitCode -eq 3010) { throw 'Visual C++ runtime installed. Restart Windows, then run 00-install.bat again.' }
    if ($setup.ExitCode -ne 0) { throw "Visual C++ runtime setup failed (exit $($setup.ExitCode))." }
}

function Get-BonsaiModels {
    @(
        [pscustomobject]@{
            Id='bonsai'; Label='Bonsai 27B / 軽量・高速（従来モデル）'
            Description='Qwen3.6系・1-bit Q1_0・約3.8GB。軽さ重視の標準版。'
            File='Bonsai-27B-Q1_0.gguf'; Size=3803452480L
            Hash='17ef842e47450caeb8eaa3ebfbbab5d2f2278b62b79be107985fb69a2f819aa0'
            Repo='prism-ml/Bonsai-27B-gguf'; Revision='f10afb355f104535e3e3e98cf7ab7795c72bd292'
            MinVramMiB=6000
        }
        [pscustomobject]@{
            Id='huihui'; Label='Huihui Qwen3.8 27B / 拒否低減版（新しいベース）'
            Description='Bonsai 2系・Ternary PQ2_0・約7.7GB。拒否を減らす加工あり。品質・速度は用途によります。'
            File='Huihui-Qwen3.8-27B-abliterated-Ternary-Bonsai-PQ2_0.gguf'; Size=7704693216L
            Hash='0de67be7b5256c20971f44e514d87ec7fa81ad4f8d8fcf151644009f74f3a5cf'
            Repo='huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF'; Revision='3f101cd22b7999228bbd5d79a33975414eb9758b'
            MinVramMiB=10000
        }
    )
}
function Test-BonsaiInstalled($Spec) {
    $file=Join-Path $BonsaiRoot "models\$($Spec.File)"
    return ((Test-Path -LiteralPath $file -PathType Leaf) -and (Get-Item -LiteralPath $file).Length -eq $Spec.Size)
}
function Select-BonsaiModels {
    param([ValidateSet('install','chat')][string]$Purpose,[ValidateSet('auto','bonsai','huihui','both')][string]$Choice='auto')
    $catalog=@(Get-BonsaiModels)
    if ($Choice -ne 'auto') {
        if ($Choice -eq 'both') {
            if ($Purpose -ne 'install') { throw '起動時は bonsai または huihui を指定してください。' }
            return $catalog
        }
        $selected=$catalog | Where-Object Id -eq $Choice
        if ($Purpose -eq 'chat' -and -not (Test-BonsaiInstalled $selected)) { throw "$($selected.Label) は未導入です。00-install.bat -Model $Choice を実行してください。" }
        return $selected
    }
    Write-Host ''
    Write-Host '========== モデル選択 ==========' -ForegroundColor Cyan
    for ($i=0; $i -lt $catalog.Count; $i++) {
        $state=if (Test-BonsaiInstalled $catalog[$i]) {'導入済み'} else {'未導入 / 要インストール'}
        Write-Host "[$($i+1)] $($catalog[$i].Label) [$state]"
        Write-Host "    $($catalog[$i].Description)"
    }
    if ($Purpose -eq 'install') { Write-Host '[3] 両方をインストール（モデル合計 約11.5GB）' }
    Write-Host '[0] キャンセル'
    if ($Purpose -eq 'chat') {
        $installed=@($catalog | Where-Object { Test-BonsaiInstalled $_ })
        if ($installed.Count -eq 0) { throw 'モデルが未導入です。先に00-install.batを実行してください。' }
        if ($installed.Count -eq 1) {
            Write-Host "導入済みのモデルを起動します: $($installed[0].Label)"
            return $installed[0]
        }
    }
    while ($true) {
        $answer=Read-Host '番号を入力してEnter'
        if ($null -eq $answer) { throw '入力がありません。-Model bonsai / huihui を指定してください。' }
        switch ($answer.Trim()) {
            '0' { return }
            '1' { $selected=$catalog[0] }
            '2' { $selected=$catalog[1] }
            '3' { if ($Purpose -eq 'install') { return $catalog }; $selected=$null }
            default { $selected=$null }
        }
        if (-not $selected) { Write-Host '表示されている番号を入力してください。'; continue }
        if ($Purpose -eq 'chat' -and -not (Test-BonsaiInstalled $selected)) { Write-Host 'このモデルは未導入です。00-install.batでインストールしてください。'; continue }
        return $selected
    }
}

function Expand-BonsaiRuntime([string]$Archive,[string]$Destination) {
    # A running CLI locks DLLs. Reuse an identical installation instead of overwriting it.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
    $identical=$true
    try {
        foreach ($entry in $zip.Entries) {
            if (-not $entry.Name) { continue }
            $target=Join-Path $Destination $entry.FullName
            if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-Item -LiteralPath $target).Length -ne $entry.Length) { $identical=$false; break }
            $stream=$entry.Open(); $sha=[Security.Cryptography.SHA256]::Create()
            try { $expected=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
            finally { $stream.Dispose(); $sha.Dispose() }
            if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $expected) { $identical=$false; break }
        }
    } finally { $zip.Dispose() }
    if ($identical) { Write-Host '実行環境は導入済みです（ファイル一致を確認）。'; return }
    try { Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force }
    catch { throw "実行環境を更新できません。起動中のCLIを終了して00-install.batを再実行してください。詳細: $($_.Exception.Message)" }
}
