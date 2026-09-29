$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$script:ModelName = 'Bonsai-27B-Q1_0.gguf'
$script:ModelHash = '17ef842e47450caeb8eaa3ebfbbab5d2f2278b62b79be107985fb69a2f819aa0'
$script:ModelSize = 3803452480L
$script:Release = 'prism-b10743-adfffbe'
function Get-BonsaiHardware {
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_IDENTIFIER -match 'ARM') { throw 'This package requires x64 Windows 10/11.' }
    $backend='cpu'; $vram=0
    $smi=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if ($smi) {
        $info=(& $smi.Source 2>$null | Out-String)
        $memory=@(& $smi.Source --query-gpu=memory.total --format=csv,noheader,nounits 2>$null)
        if ($memory.Count -gt 0) { $parsed=0; if ([int]::TryParse($memory[0].Trim(),[ref]$parsed)) { $vram=$parsed } }
        if ($info -match 'CUDA(?:\s+UMD)?\s+Version:\s+(\d+)\.(\d+)') {
            if (([int]$Matches[1] -gt 12 -or ([int]$Matches[1] -eq 12 -and [int]$Matches[2] -ge 4)) -and $vram -ge 6000) { $backend='cuda' }
        }
    }
    $ctx=8192
    if ($backend -eq 'cuda' -and $vram -ge 11000) { $ctx=32768 }
    [pscustomobject]@{Backend=$backend;VramMiB=$vram;Context=$ctx}
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
    } else {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $partial
    }
    Assert-Hash $partial $Hash
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
    $redist=Join-Path $PSScriptRoot 'downloads\vc_redist.x64.exe'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vc14/vc_redist.x64.exe' -OutFile $redist
    $signature=Get-AuthenticodeSignature -LiteralPath $redist
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Microsoft runtime signature verification failed.' }
    $setup=Start-Process -FilePath $redist -ArgumentList '/install','/passive','/norestart' -Wait -PassThru -WindowStyle Hidden
    if ($setup.ExitCode -eq 3010) { throw 'Visual C++ runtime installed. Restart Windows, then run 00-install.bat again.' }
    if ($setup.ExitCode -ne 0) { throw "Visual C++ runtime setup failed (exit $($setup.ExitCode))." }
}
