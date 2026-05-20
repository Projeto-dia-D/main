' Invoca sync_monday_15min.bat de forma OCULTA (sem janela do CMD aparecer).
' Pra agendar no Task Scheduler com este .vbs em vez do .bat → nada visual aparece.
'
' Argumentos do Run:
'   1 = janela normal
'   0 = OCULTO ← usado aqui
'   True/False = aguarda terminar (False = dispara e segue)
Set objShell = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Pega o diretório onde este .vbs está + sobe pra raiz do projeto
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)

' Comando: roda o .bat oculto, aguarda terminar
objShell.CurrentDirectory = projectDir
objShell.Run "cmd /c """"" & scriptDir & "\sync_monday_15min.bat""""", 0, True
