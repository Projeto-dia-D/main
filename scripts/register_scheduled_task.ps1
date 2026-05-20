# Registra (ou re-registra) a task scheduled "DiaD-SyncMonday15min" rodando
# em modo OCULTO (sem janela do CMD/PowerShell aparecer a cada 15 min).
#
# IMPORTANTE: usa variáveis de ambiente em vez de hardcoded paths pra
# evitar problemas de encoding com o acento em "Usuário".
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\register_scheduled_task.ps1

$TaskName = 'DiaD-SyncMonday15min'

# Remove a task antiga se existir
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task antiga removida."
}

# Resolve paths dinamicamente — evita problemas de encoding
$ProjectDir = (Get-Location).Path
# Se rodar de outra pasta, ajusta pra raiz do projeto
if (-not (Test-Path "$ProjectDir\scripts\sync_monday_to_supabase.py")) {
    $ProjectDir = Split-Path -Parent $PSScriptRoot
}
Write-Host "ProjectDir: $ProjectDir"

# Estratégia: usa wscript.exe + .vbs invocador oculto.
# - wscript.exe NÃO mostra janela
# - .vbs invoca o .bat com window=0 (hidden) e aguarda
# - O .bat usa python.exe normal (que escreve no log) — log fica preservado
$WScript = "$env:SystemRoot\System32\wscript.exe"
$VbsScript = "$ProjectDir\scripts\sync_monday_hidden.vbs"

if (-not (Test-Path $VbsScript)) {
    Write-Error "scripts/sync_monday_hidden.vbs não encontrado!"
    exit 1
}
if (-not (Test-Path $WScript)) {
    Write-Error "wscript.exe não encontrado em $WScript"
    exit 1
}
Write-Host "wscript: $WScript"
Write-Host "vbs:     $VbsScript"

# Action: roda wscript hidden invoker → bat → python
$action = New-ScheduledTaskAction `
    -Execute $WScript `
    -Argument "`"$VbsScript`"" `
    -WorkingDirectory $ProjectDir

# Trigger: começa AGORA, repete a cada 15 min, indefinidamente
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 15)

# Settings: oculto, sem timeout pesado, ignora nova instância se anterior tá rodando
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew `
    -Hidden

# Registra
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Sync Monday -> Supabase a cada 15 min (Dia D) - oculto' `
    -Force | Out-Null

Write-Host "Task '$TaskName' criada com sucesso (modo oculto)."
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Proxima execucao: $($info.NextRunTime)"
Write-Host ""
Write-Host "Comandos uteis:"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName'   # status"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'     # rodar agora"
Write-Host "  Disable-ScheduledTask -TaskName '$TaskName'   # pausar"
