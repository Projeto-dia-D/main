' Invoca sync_whatsapp_domingo.bat de forma OCULTA (sem janela do CMD).
Set objShell = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)
objShell.CurrentDirectory = projectDir
objShell.Run "cmd /c """"" & scriptDir & "\sync_whatsapp_domingo.bat""""", 0, True
