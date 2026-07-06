' Fable MC Steuerzentrale (Server) OHNE Konsolenfenster starten.
' Doppelklick oeffnet die Steuerzentrale in ihrem eigenen Fenster; es bleibt
' kein Kommandozeilenfenster offen. Schliesst man das Steuerzentrale-Fenster,
' wird der Server sauber gestoppt.
Set sh = CreateObject("WScript.Shell")
p = WScript.ScriptFullName
sh.CurrentDirectory = Left(p, InStrRev(p, "\") - 1)
sh.Run "cmd /c node launcher.js", 0, False
