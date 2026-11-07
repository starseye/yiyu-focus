Option Explicit

Dim shell, fso, baseDir, htmlPath, edgePath, fileUrl

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
htmlPath = fso.BuildPath(baseDir, "index.html")

If Not fso.FileExists(htmlPath) Then
  MsgBox "index.html was not found next to this launcher.", vbExclamation, "Yiyu Focus"
  WScript.Quit
End If

edgePath = ""
If fso.FileExists(shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe") Then
  edgePath = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
ElseIf fso.FileExists(shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe") Then
  edgePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
ElseIf fso.FileExists(shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\Edge\Application\msedge.exe") Then
  edgePath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\Edge\Application\msedge.exe"
End If

fileUrl = "file:///" & Replace(htmlPath, "\", "/")

If edgePath = "" Then
  shell.Run """" & htmlPath & """", 1, False
Else
  shell.Run """" & edgePath & """ --app=""" & fileUrl & """ --start-maximized", 1, False
End If