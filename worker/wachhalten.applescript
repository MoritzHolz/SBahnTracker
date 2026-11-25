-- Schalter „Mac wach halten“. Bauen: worker/mac.sh wach app
property jobLabel : "de.sbahn.wachhalten"

on isOn()
	try
		do shell script "/bin/launchctl print gui/$(/usr/bin/id -u)/" & jobLabel
		return true
	on error
		return false
	end try
end isOn

on run
	try
		if isOn() then
			set answer to button returned of (display dialog "Der Mac wird gerade wach gehalten." with title "Mac wach halten: EIN" buttons {"Schließen", "Ausschalten"} default button "Ausschalten" cancel button "Schließen")
			do shell script "/bin/launchctl remove " & jobLabel
			display notification "Der Mac darf wieder schlafen." with title "Mac wach halten: AUS"
		else
			set answer to button returned of (display dialog "Der Mac darf gerade schlafen." & return & return & "Zum Wachhalten: Netzteil anschließen und Deckel offen lassen. Der Bildschirm darf ausgehen." with title "Mac wach halten: AUS" buttons {"Schließen", "Einschalten"} default button "Einschalten" cancel button "Schließen")
			do shell script "/bin/launchctl submit -l " & jobLabel & " -- /usr/bin/caffeinate -i -s"
			display notification "Der Mac bleibt wach, bis du ausschaltest." with title "Mac wach halten: EIN"
		end if
	on error number -128
		return
	end try
end run
