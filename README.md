# Time-Tracker

Sammlung eigener Projekte, die bisher nur lokal in OneDrive lagen.

| Projekt | Beschreibung |
| --- | --- |
| [`WebsiteTimeTrack/`](WebsiteTimeTrack/) | Chrome-Extension (Manifest V3), die misst, wie lange man auf welcher Website ist |

---

## WebsiteTimeTrack

### Installation

1. `chrome://extensions` oeffnen
2. **Entwicklermodus** aktivieren
3. **Entpackte Erweiterung laden** → Ordner `WebsiteTimeTrack/` auswaehlen

Tests laufen ohne Abhaengigkeiten:

```bash
node WebsiteTimeTrack/test/background.test.mjs
```

### Funktionsumfang

**Messen**

- Erfasst pro Domain, wie lange der zugehoerige Tab aktiv im Vordergrund war
- Zaehlt nur, wenn wirklich gebrowst wird: aktiver Tab **und** fokussiertes
  Chrome-Fenster **und** der Nutzer nicht idle (60 s Schwelle)
- Nur `http`/`https`; `chrome://`, `file://` und Extension-Seiten bleiben aussen vor
- `www.` wird abgeschnitten, `youtube.com` und `www.youtube.com` sind dieselbe Seite
- Daten liegen in Tages-Buckets, ein Segment ueber Mitternacht wird korrekt
  auf beide Tage aufgeteilt
- Standby/Ruhezustand erzeugt keine Fantasie-Zeiten

**Anzeigen**

- Popup mit sortierter Rangliste, Balken relativ zur meistgenutzten Seite
- Zeitraum umschaltbar: **Heute / 7 Tage / Gesamt**
- Gesamtsumme des gewaehlten Zeitraums
- Aktualisiert sich sekuendlich, solange das Popup offen ist
- Dark Mode ueber `prefers-color-scheme`
- Zuruecksetzen mit zweistufiger Bestaetigung

**Technisch**

- Alles lokal in `chrome.storage.local`, keine Server, keine Netzwerkzugriffe,
  keine externen Bibliotheken
- Berechtigungen: `tabs`, `storage`, `idle`, `alarms`
- Bestehende Daten aus Version 1.0 werden beim Update automatisch migriert

### Was gefixt wurde (1.0 → 1.1.0)

**Kritisch – das Tracking lief so gar nicht zuverlaessig**

1. **`setInterval` im Service Worker.** MV3 beendet den Service Worker nach
   kurzer Untaetigkeit, der Sekundentimer stirbt mit. Ersetzt durch
   ereignisbasierte Segmentmessung plus `chrome.alarms` im Minutentakt.
2. **Zustand nur im Modul-Scope.** `activeTabId`/`lastActiveTime` waren nach
   jedem Neustart des Workers weg. Liegt jetzt in `chrome.storage.session`.
3. **Tracking blieb nach Idle tot.** Beim Wechsel auf `idle` wurde
   `activeTabId = null` gesetzt, beim Zurueckkommen aber nie wieder gefuellt –
   ab der ersten Pause zaehlte nichts mehr, bis man den Tab wechselte.
4. **Nichts wurde gezaehlt bis zum ersten Tabwechsel.** `activeTabId` startete
   als `null` und wurde nur von `onActivated` gesetzt. Der aktive Tab wird
   jetzt beim Start des Workers direkt ermittelt.
5. **Fensterfokus wurde ignoriert.** Minimiertes Chrome oder eine andere App im
   Vordergrund liefen voll weiter mit. Jetzt haengt `chrome.windows.onFocusChanged`
   mit drin.

**Popup**

6. **Das Diagramm erschien nie.** Chart.js kam per `<script src="https://cdn…">`,
   was die MV3-CSP (`script-src 'self'`) blockt. Die Balken werden jetzt selbst
   gerendert – kein CDN, keine Abhaengigkeit.
7. **Unsortierte Liste** in willkuerlicher Storage-Reihenfolge → absteigend nach Zeit.
8. **Kein Auto-Refresh**, die Zahlen standen still, solange das Popup offen war.
9. **Reset loeschte alles sofort und ohne Rueckfrage**, ausserdem via
   `storage.clear()` auch alles Nicht-Zeitbezogene.
10. **`formatTime`** gab immer `0h 0m 42s` aus statt `42 s`.
11. Kein Empty-State, kein `<title>`, kein `charset`, kein `lang`.

**Robustheit & Datenqualitaet**

12. **Abstuerze bei geschlossenen Tabs.** `chrome.tabs.get()` auf einen
    verschwundenen Tab warf eine unbehandelte Rejection.
13. **`tab.url.startsWith(...)`** warf `TypeError`, sobald ein Tab keine URL hatte.
14. **`new URL()` ohne try/catch.**
15. **Systematische Unterzaehlung.** Pro Sekunde wurde auf ganze Sekunden
    abgerundet und der Rest verworfen – unter Timer-Drosselung ging so
    laufend Zeit verloren. Gerechnet wird jetzt in Millisekunden.
16. **Race Condition beim Schreiben.** `storage.get` + `storage.set` ist nicht
    atomar; parallele Events konnten sich gegenseitig ueberschreiben. Alle
    Schreibzugriffe laufen jetzt serialisiert.
17. **Standby erzeugte Riesenwerte.** Ein zugeklappter Laptop wurde beim
    Aufwachen als durchgehende Nutzung gebucht. Segmente ueber 5 Minuten
    werden verworfen.
18. **Flaches Storage-Schema.** Jede Domain lag als eigener Top-Level-Key neben
    potenziellen Einstellungen, und das Popup las mit `get(null)` blind alles
    ein. Jetzt ein sauber getrennter `usage`-Baum mit Versionsfeld.
19. **`chrome.idle.setDetectionInterval`** wurde nie gesetzt.

**Manifest / Repo**

20. `alarms`-Permission ergaenzt, `icons`-Block ergaenzt (fehlte komplett),
    Einrueckung korrigiert, Version auf `1.1.0`.
21. **`WebsiteTimeTrack.pem` wurde nicht eingecheckt.** Das ist der private
    Signierschluessel der Extension – wer ihn hat, kann Updates unter deiner
    Extension-ID veroeffentlichen. `.gitignore` blockt `*.pem` und `*.crx`.
    Bewahre die Datei ausserhalb des Repos auf.

### Ideen fuer als naechstes

**Naheliegend**

- **Limits pro Seite** mit Benachrichtigung („90 min YouTube erreicht")
- **Blocklist / Fokusmodus**: gesetzte Seiten nach Ablauf des Limits sperren
- **Verlauf**: Balken pro Tag der letzten 30 Tage, Wochenvergleich
- **Kategorien** (Arbeit / Social / Unterhaltung) mit Auswertung pro Gruppe
- **Favicons** in der Liste, dazu Suchfeld ab vielen Eintraegen
- **Einzelne Domain loeschen** statt nur „alles zuruecksetzen"
- **Ignorierliste** fuer Domains, die gar nicht erst erfasst werden
- **Options-Seite** fuer Idle-Schwelle, Limits, Ignorierliste

**Groesser**

- **Export/Import** als CSV und JSON, dazu automatischer Wochenreport
- **Sync** ueber `chrome.storage.sync` oder eigenes Backend fuer mehrere Geraete
- **Tiefer als die Domain**: Zeit pro YouTube-Kanal oder pro GitHub-Repo
- **Produktivitaets-Score** je Tag aus den Kategorien
- **Firefox-Port** – die WebExtension-APIs sind zu 95 % identisch
- **Aktive statt nur offener Zeit**: Scroll-/Tastatur-Events per Content-Script,
  damit ein offenes Video-Tab nicht als Interaktion zaehlt
