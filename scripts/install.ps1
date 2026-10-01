param([string]$SeedDirectory,[ValidateSet('auto','bonsai','huihui','both')][string]$Model='auto')
. (Join-Path $PSScriptRoot 'common.ps1')
try {
    $selectedModels=@(Select-BonsaiModels -Purpose install -Choice $Model)
    if ($selectedModels.Count -eq 0) { Write-Host 'キャンセルしました。'; exit 0 }
    $hardware=Get-BonsaiHardware
    Write-Host "Bonsai 27B installer / backend: $($hardware.Backend) / VRAM: $($hardware.VramMiB) MiB"
    $modelDir=Join-Path $BonsaiRoot 'models'
    $downloads=Join-Path $BonsaiRoot 'downloads'
    New-Item -ItemType Directory -Path $modelDir,$downloads -Force | Out-Null
    Ensure-VcRuntime
    foreach ($spec in $selectedModels) {
        $modelPath=Join-Path $modelDir $spec.File
        Write-Host "導入するモデル: $($spec.Label)" -ForegroundColor Cyan
        Write-Host $spec.Description
        if ($SeedDirectory -and -not (Test-Path -LiteralPath $modelPath)) {
            $candidates=@(
                (Join-Path $SeedDirectory $spec.File),
                (Join-Path $SeedDirectory "models\$($spec.File)"),
                (Join-Path $SeedDirectory "models\gguf\27B\$($spec.File)")
            )
            $seed=$candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
            if ($seed) {
                Write-Host '既存モデルをコピーして検証しています...'
                Copy-Item -LiteralPath $seed -Destination ($modelPath+'.part')
                Assert-Hash ($modelPath+'.part') $spec.Hash
                Move-Item -LiteralPath ($modelPath+'.part') -Destination $modelPath
            }
        }
        Get-CheckedDownload "https://huggingface.co/$($spec.Repo)/resolve/$($spec.Revision)/$($spec.File)" $modelPath $spec.Hash
    }
    $assets=@(
        @{Name="llama-$Release-bin-win-cpu-x64.zip";Hash='d0b3016c9cc4bc1385de68be034adee570277ba952dd94292ba3888b7f18cc44';Backend='cpu'}
    )
    if ($hardware.Backend -eq 'cuda') {
        $assets+=@{Name="llama-$Release-bin-win-cuda-12.4-x64.zip";Hash='1b849f713bee42fda258de83770cd422e8f48dd631ce370eb0641f6458c69d87';Backend='cuda'}
        $assets+=@{Name='cudart-llama-bin-win-cuda-12.4-x64.zip';Hash='8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6';Backend='cuda'}
    }
    foreach ($asset in $assets) {
        $zip=Join-Path $downloads $asset.Name
        Get-CheckedDownload "https://github.com/PrismML-Eng/llama.cpp/releases/download/$Release/$($asset.Name)" $zip $asset.Hash
        $dest=Join-Path $BonsaiRoot "runtime\$($asset.Backend)"
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Expand-BonsaiRuntime -Archive $zip -Destination $dest
    }
    $exe=Join-Path $BonsaiRoot "runtime\$($hardware.Backend)\llama-cli.exe"
    & $exe --version
    if ($LASTEXITCODE -ne 0) { throw 'Runtime check failed. Check the Windows/GPU driver or try CPU mode.' }
    # Lets standalone copies of the .bat files find this installation.
    $regKey='HKCU:\Software\Bonsai27B-CLI'
    New-Item -Path $regKey -Force | Out-Null
    Set-ItemProperty -Path $regKey -Name InstallDir -Value $BonsaiRoot
    Write-Host 'Installation complete. Double-click 01-chat.bat.' -ForegroundColor Green
    exit 0
} catch { Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
