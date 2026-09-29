param([string]$SeedDirectory)
. (Join-Path $PSScriptRoot 'common.ps1')
try {
    $hardware=Get-BonsaiHardware
    Write-Host "Bonsai 27B installer / backend: $($hardware.Backend) / VRAM: $($hardware.VramMiB) MiB"
    $modelDir=Join-Path $PSScriptRoot 'models'
    $downloads=Join-Path $PSScriptRoot 'downloads'
    New-Item -ItemType Directory -Path $modelDir,$downloads -Force | Out-Null
    Ensure-VcRuntime
    $model=Join-Path $modelDir $ModelName
    if ($SeedDirectory -and -not (Test-Path -LiteralPath $model)) {
        $seed=Join-Path $SeedDirectory "models\gguf\27B\$ModelName"
        if (Test-Path -LiteralPath $seed) {
            Write-Host 'Copying existing model (no download needed)...'
            Copy-Item -LiteralPath $seed -Destination ($model+'.part')
            Assert-Hash ($model+'.part') $ModelHash
            Move-Item -LiteralPath ($model+'.part') -Destination $model
        }
    }
    Get-CheckedDownload "https://huggingface.co/prism-ml/Bonsai-27B-gguf/resolve/f10afb355f104535e3e3e98cf7ab7795c72bd292/$ModelName" $model $ModelHash
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
        $dest=Join-Path $PSScriptRoot "runtime\$($asset.Backend)"
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
    }
    $exe=Join-Path $PSScriptRoot "runtime\$($hardware.Backend)\llama-cli.exe"
    & $exe --version
    if ($LASTEXITCODE -ne 0) { throw 'Runtime check failed. Check the Windows/GPU driver or try CPU mode.' }
    Write-Host 'Installation complete. Double-click 01-chat.bat.' -ForegroundColor Green
    exit 0
} catch { Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
