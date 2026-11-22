Option Explicit
Dim fso, shell, baseDir, pythonwPath, serverPath, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
pythonwPath = baseDir & "\server\.venv\Scripts\pythonw.exe"
serverPath = baseDir & "\server\server.py"

If Not fso.FileExists(pythonwPath) Then
  MsgBox "Python virtual environment not found at:" & vbCrLf & pythonwPath, 16, "LibertyGrab Engine"
  WScript.Quit 1
End If

cmd = """" & pythonwPath & """ """ & serverPath & """"
shell.Run cmd, 0, False

If WScript.Arguments.Count = 0 Then
  shell.Popup "LibertyGrab Local Engine is now running in the background (127.0.0.1:17890).", 3, "LibertyGrab Video Downloader", 64
End If
