Option Explicit

Dim WshShell, Fso, LauncherDir, RepoRoot, LauncherScript
Dim PythonExe, RepoPython, SiblingRepoRoot, SiblingPython

Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")

LauncherDir = Fso.GetParentFolderName(WScript.ScriptFullName)
RepoRoot = Fso.GetParentFolderName(LauncherDir)
LauncherScript = Fso.BuildPath(LauncherDir, "synth_launcher.py")
RepoPython = Fso.BuildPath(RepoRoot, ".venv\Scripts\pythonw.exe")
SiblingRepoRoot = Fso.BuildPath(Fso.GetParentFolderName(RepoRoot), "command-center")
SiblingPython = Fso.BuildPath(SiblingRepoRoot, ".venv\Scripts\pythonw.exe")
PythonExe = WshShell.Environment("PROCESS")("CC_LAUNCHER_PYTHON")

If PythonExe = "" Or Not Fso.FileExists(PythonExe) Then
    If Fso.FileExists(RepoPython) Then
        PythonExe = RepoPython
    ElseIf Fso.FileExists(SiblingPython) Then
        PythonExe = SiblingPython
    Else
        MsgBox "Command Center could not find its Python environment." & vbCrLf & vbCrLf & _
            "Expected one of:" & vbCrLf & RepoPython & vbCrLf & SiblingPython & vbCrLf & vbCrLf & _
            "Set CC_LAUNCHER_PYTHON to another pythonw.exe if needed.", _
            vbCritical, "Command Center"
        WScript.Quit 1
    End If
End If

WshShell.CurrentDirectory = RepoRoot
WshShell.Run Quote(PythonExe) & " " & Quote(LauncherScript), 0, False

Set Fso = Nothing
Set WshShell = Nothing

Function Quote(Value)
    Quote = Chr(34) & Value & Chr(34)
End Function
