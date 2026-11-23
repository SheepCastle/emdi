$ErrorActionPreference = "Stop"

$Repo = "SheepCastle/emdi"
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\emdi"
$ExePath = Join-Path $InstallDir "emdi.exe"

Write-Host "==> Checking latest release of emdi..." -ForegroundColor Cyan
$Headers = @{ "User-Agent" = "emdi-installer" }
$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $Headers
$Tag = $Release.tag_name
$Asset = $Release.assets | Where-Object { $_.name -like "*-windows-x64.zip" } | Select-Object -First 1

if (-not $Asset) {
    throw "Could not find Windows release archive (*-windows-x64.zip) in release $Tag."
}

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("emdi-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

try {
    $ZipPath = Join-Path $TmpDir "emdi-windows.zip"
    Write-Host "==> Downloading emdi $Tag..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $ZipPath -Headers $Headers

    # Close running emdi process if active
    Get-Process -Name "emdi" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400

    Write-Host "==> Installing to $InstallDir..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force

    # Remove Mark-of-the-Web if present
    Get-ChildItem -Path $InstallDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

    # Create Start Menu shortcut
    $StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    $ShortcutPath = Join-Path $StartMenuDir "엠디 (emdi).lnk"
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $ExePath
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "엠디 (emdi) — Lightweight Markdown Editor"
    $Shortcut.Save()

    # Register .md / .markdown file association in HKCU (no admin required)
    $ClassesRoot = "HKCU:\Software\Classes"
    $ProgId = "Emdi.MarkdownFile"
    New-Item -Path "$ClassesRoot\$ProgId\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path "$ClassesRoot\$ProgId" -Name "(Default)" -Value "Markdown Document (emdi)"
    Set-ItemProperty -Path "$ClassesRoot\$ProgId\shell\open\command" -Name "(Default)" -Value "`"$ExePath`" `"%1`""
    New-Item -Path "$ClassesRoot\.md\OpenWithProgids" -Force | Out-Null
    New-ItemProperty -Path "$ClassesRoot\.md\OpenWithProgids" -Name $ProgId -Value "" -PropertyType String -Force | Out-Null
    New-Item -Path "$ClassesRoot\.markdown\OpenWithProgids" -Force | Out-Null
    New-ItemProperty -Path "$ClassesRoot\.markdown\OpenWithProgids" -Name $ProgId -Value "" -PropertyType String -Force | Out-Null

    Write-Host ""
    Write-Host "Done! emdi $Tag is installed at $ExePath" -ForegroundColor Green
    Write-Host "Launch from Start Menu ('엠디 (emdi)') or run: & `"$ExePath`"" -ForegroundColor Gray
}
finally {
    Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
