' Fable MC (Spiel) OHNE Konsolenfenster starten.
' Doppelklick startet die Desktop-App direkt; es bleibt kein Kommandozeilen-
' fenster offen. Das Spiel schliesst man ueber sein eigenes Fenster.
Set sh = CreateObject("WScript.Shell")
p = WScript.ScriptFullName
sh.CurrentDirectory = Left(p, InStrRev(p, "\") - 1)
sh.Run "cmd /c npm run app", 0, False
