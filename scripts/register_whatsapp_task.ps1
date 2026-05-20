# Registra task scheduled "DiaD-SyncWhatsApp-Domingo" pra rodar todo
# domingo às 23:00, em modo OCULTO (sem janela CMD).
#
# Uso: powershell -ExecutionPolicy Bypass -File scripts/register_whatsapp_task.ps1

$TaskName = 'DiaD-SyncWhatsApp-Domingo'

# Remove task antiga se existir
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task antiga removida."
}

$ProjectDir = (Get-Location).Path
if (-not (Test-Path "$ProjectDir\scripts\sync_whatsapp_to_supabase.py")) {
    $ProjectDir = Split-Path -Parent $PSScriptRoot
}
Write-Host "ProjectDir: $ProjectDir"

$WScript = "$env:SystemRoot\System32\wscript.exe"
$VbsScript = "$ProjectDir\scripts\sync_whatsapp_hidden.vbs"

if (-not (Test-Path $VbsScript)) {
    Write-Error "scripts/sync_whatsapp_hidden.vbs não encontrado!"
    exit 1
}
Write-Host "wscript: $WScript"
Write-Host "vbs:     $VbsScript"

# Action
$action = New-ScheduledTaskAction `
    -Execute $WScript `
    -Argument "`"$VbsScript`"" `
    -WorkingDirectory $ProjectDir

# Trigger: TODO domingo às 23:00
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 11pm

# Settings: oculto, sem timeout pesado
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew `
    -Hidden

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Sync WhatsApp grupos -> Supabase (Dia D) - todo domingo 23h - oculto' `
    -Force | Out-Null

Write-Host "Task '$TaskName' criada com sucesso (oculta, domingo 23h)."
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Proxima execucao: $($info.NextRunTime)"
