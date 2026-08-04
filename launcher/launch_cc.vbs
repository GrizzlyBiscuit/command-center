Option Explicit

Dim WshShell, Fso, LauncherDir, RepoRoot, LauncherScript
Dim PythonExe, RepoPython, LegacyPython

Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")

LauncherDir = Fso.GetParentFolderName(WScript.ScriptFullName)
RepoRoot = Fso.GetParentFolderName(LauncherDir)
LauncherScript = Fso.BuildPath(LauncherDir, "synth_launcher.py")
RepoPython = Fso.BuildPath(RepoRoot, ".venv\Scripts\pythonw.exe")
LegacyPython = "C:\Users\mattz\AppData\Local\hermes\hermes-agent\venv\Scripts\pythonw.exe"
PythonExe = WshShell.Environment("PROCESS")("CC_LAUNCHER_PYTHON")

If PythonExe = "" Or Not Fso.FileExists(PythonExe) Then
    If Fso.FileExists(RepoPython) Then
        PythonExe = RepoPython
    ElseIf Fso.FileExists(LegacyPython) Then
        PythonExe = LegacyPython
    Else
        PythonExe = "pythonw.exe"
    End If
End If

WshShell.CurrentDirectory = RepoRoot
WshShell.Run Quote(PythonExe) & " " & Quote(LauncherScript), 0, False

Set Fso = Nothing
Set WshShell = Nothing

Function Quote(Value)
    Quote = Chr(34) & Value & Chr(34)
End Function
