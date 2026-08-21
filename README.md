# Time-Tracker

Sammlung eigener Projekte, die bisher nur lokal in OneDrive lagen.

| Projekt | Beschreibung |
| --- | --- |
| [`WebsiteTimeTrack/`](WebsiteTimeTrack/) | Browser-Extension (Manifest V3, Chrome + Firefox), die misst, wie lange man auf welcher Website ist |
| [`site/`](site/) | Statische Landingpage der Extension (englisch) |

---

## WebsiteTimeTrack

Misst lokal die Zeit je Website – mit Tageslimits, Fokusmodus, Kategorien,
Produktivitaets-Score, Wochenreport und Export. Keine Server, keine externen
Bibliotheken, keine Netzwerkzugriffe.

### Installation

```bash
npm run build     # erzeugt dist/chrome und dist/firefox
```

* **Chrome:** `chrome://extensions` → Entwicklermodus → *Entpackte Erweiterung laden* → `WebsiteTimeTrack/dist/chrome`
* **Firefox:** `about:debugging` → *Dieser Firefox* → *Temporaeres Add-on laden* → `WebsiteTimeTrack/dist/firefox/manifest.json`

Ohne Build laesst sich der Ordner `WebsiteTimeTrack/` in Chrome direkt laden.

```bash
npm test          # 62 Tests, keine Abhaengigkeiten
```

### Was die Extension kann

**Messung**

| | |
| --- | --- |
| Zeit je Domain | Tagesgenau gespeichert, 365 Tage Historie |
| Echte Aktivitaet | Zaehlt nur bei aktivem Tab, fokussiertem Fenster und nicht-idlem Nutzer |
| Interaktionspflicht | Optional: nur zaehlen bei Maus, Tastatur oder Scrollen |
| Ton-Ausnahme | Tabs mit Ton zaehlen trotzdem, damit Videos nicht als Pause gelten |
| Idle-Korrektur | Die Idle-Schwelle wird rueckwirkend abgezogen, nicht mitgezaehlt |
| Mitternacht | Segmente ueber 0 Uhr werden auf beide Tage aufgeteilt |
| Standby-Schutz | Segmente ueber 5 Minuten gelten als Ruhezustand und werden verworfen |
| Ignorierliste | Domains, die gar nicht erst erfasst werden (inkl. Subdomains) |

**Unterobjekte statt nur Domains**

| | |
| --- | --- |
| YouTube | Zeit je Kanal (Kanalname kommt vom Content-Script) |
| GitHub / GitLab | Zeit je Repository |
| Reddit | Zeit je Subreddit |
| Twitch, X | Zeit je Kanal bzw. Profil |
| Beliebige Domains | Erstes Pfadsegment als Bereich, per Einstellung |

**Auswertung im Popup**

| | |
| --- | --- |
| Zeitraeume | Heute, 7 Tage, 30 Tage, Gesamt |
| Rangliste | Sortiert, mit Favicon, Balken in Kategoriefarbe |
| Aufklappen | Klick auf eine Domain zeigt ihre Unterobjekte |
| Verlauf | Balkendiagramm der letzten 30 Tage |
| Kategorien | Anteil je Kategorie mit Prozent und Zeit |
| Produktivitaets-Score | 0–100, gewichtet nach Kategorie |
| Einzeln loeschen | Domain aus allen Tagen entfernen, zweistufig bestaetigt |
| Live | Aktualisiert sich sekuendlich, solange das Popup offen ist |

**Limits, Sperre, Fokus**

| | |
| --- | --- |
| Tageslimit je Domain | In Minuten, Subdomains eingeschlossen |
| Vorwarnung | Benachrichtigung bei frei waehlbarem Prozentsatz (Standard 80 %) |
| Sperre | Optional beim Erreichen des Limits, mit eigener Sperrseite |
| Fokusmodus | Sperrt Ablenkung auf Knopfdruck, mit Ablaufzeit |
| Fokus-Standard | Ohne eigene Liste greifen die Kategorien Social und Unterhaltung |
| Snooze | 5 Minuten Ausnahme direkt von der Sperrseite |

**Kategorien und Score**

| | |
| --- | --- |
| Sieben Kategorien | Arbeit, Lernen, News, Shopping, Social, Unterhaltung, Sonstiges |
| Vorbelegung | Rund 100 bekannte Domains sind zugeordnet |
| Eigene Zuordnung | Pro Domain aenderbar, wirkt auch auf Subdomains |
| Score | 50 ist neutral, Arbeit und Lernen heben ihn, Social und Unterhaltung senken ihn |

**Report, Export, Sync**

| | |
| --- | --- |
| Wochenreport | Montags automatisch: Summe, Top-Seiten, Kategorien, Score, Vergleich zur Vorwoche |
| CSV-Export | Eine Zeile je Tag und Domain, direkt pivotierbar |
| JSON-Backup | Vollstaendig, inklusive Unterobjekten und Einstellungen |
| Import | Zusammenfuehren oder ersetzen |
| Einstellungs-Sync | Ueber das Browserprofil, ohne Zutun |
| Daten-Sync | Optional, letzte N Tage, je Geraet ein eigener Bereich (konfliktfrei) |

**Technik**

| | |
| --- | --- |
| Speicher | Alles lokal; `storage.local` fuer Daten, `storage.sync` fuer Einstellungen |
| Berechtigungen | `tabs`, `storage`, `idle`, `alarms`, `notifications`, `favicon` |
| Aufbewahrung | 365 Tage Domaindaten, 60 Tage Unterobjekte, automatisch bereinigt |
| Migration | Daten aus 1.0 und 1.1 werden beim Update uebernommen |
| Firefox | Eigenes Manifest, sonst identischer Code |
| Tests | 62 Tests ohne Abhaengigkeiten (`npm test`) |

### Aufbau

```
WebsiteTimeTrack/
  manifest.json           Chrome (MV3, Service Worker)
  manifest.firefox.json   Firefox (MV3, Event Page)
  background.js           Segmentmessung, Limits, Sperre, Wartung
  content.js              Interaktionsmeldung + YouTube-Kanal
  popup.*                 Rangliste, Verlauf, Kategorien
  options.*               Einstellungen, Kategorien, Report, Export
  blocked.*               Sperrseite mit Snooze
  lib/
    time.js         Tages- und Wochenschluessel, Formatierung
    entity.js       Domain- und Unterobjekt-Erkennung, Musterabgleich
    categories.js   Kategorien, Standardzuordnung, Score
    settings.js     Defaults, Lesen/Schreiben in storage.sync
    storage.js      Schema, Aggregation, Migration, Aufbewahrung
    limits.js       Limits, Benachrichtigungen, Sperrgruende
    report.js       Wochenreport
    export.js       CSV, JSON, Import
    sync.js         Geraeteabgleich
  test/                   62 Tests
```

---

## site

Statische Landingpage, englisch, ohne Abhaengigkeiten – einfach
`site/index.html` oeffnen oder den Ordner irgendwo statisch ausliefern
(GitHub Pages, Netlify, jeder Webserver).

```
site/
  index.html    Hero, Features, Privacy, Download + Anleitung, Footer
  terms.html    Terms of Use
  styles.css
  assets/       Logo, Favicon, Screenshots
```

Die Screenshots sind keine Mockups, sondern aus der echten Extension
gerendert: `tools/screenshots.mjs` startet die Seiten der Extension in
Chromium, ersetzt die `chrome.*`-APIs durch Beispieldaten und fotografiert
das Ergebnis.

```bash
npm run screenshots     # braucht playwright (devDependency)
```

Aendert sich die Oberflaeche der Extension, erzeugt derselbe Befehl die
Bilder neu – die Website kann also nicht veralten.

**Hinweis:** Die Oberflaeche der Extension ist deutsch, die Website englisch.
Die Screenshots zeigen daher deutsche Beschriftungen.

---

### Versionsgeschichte

**2.0.0** – Limits mit Benachrichtigung, Sperre und Fokusmodus, 30-Tage-Verlauf,
Kategorien mit Produktivitaets-Score, Favicons, einzelne Domains loeschen,
Ignorierliste, Optionsseite, CSV/JSON-Export mit Import, Wochenreport,
Geraeteabgleich, Unterobjekte (YouTube-Kanal, GitHub-Repo, Subreddit),
Firefox-Port, Interaktionserkennung per Content-Script.

Dabei zusaetzlich korrigiert: Beim Wechsel in den Idle-Zustand wurde die volle
Zeit bis zum naechsten Alarm gebucht, obwohl Chrome den Zustand erst nach
Ablauf der Schwelle meldet. Die Schwelle wird jetzt abgezogen; bei aktivierter
Interaktionspflicht endet ein Segment am Ende des Interaktionsfensters.

**1.1.0** – Fehlerbehebungen an der Erstfassung:

*Kritisch:* `setInterval` im Service Worker (MV3 beendet ihn, der Timer stirbt
mit) · Zustand nur im Modul-Scope · nach einer Idle-Phase zaehlte nichts mehr ·
vor dem ersten Tabwechsel zaehlte nichts · Fensterfokus wurde ignoriert ·
Chart.js vom CDN wurde von der MV3-CSP blockiert, das Diagramm erschien nie.

*Robustheit:* Abstuerze bei geschlossenen Tabs und Tabs ohne URL ·
systematische Unterzaehlung durch Sekundenrundung · Race Condition beim
Schreiben · Standby wurde als Nutzung gebucht · flaches Storage-Schema ·
`setDetectionInterval` nie gesetzt.

*Popup:* unsortiert · kein Auto-Refresh · Reset ohne Rueckfrage · `formatTime`
gab immer `0h 0m 42s` aus.

**1.0** – Ursprungsfassung aus OneDrive.

### Hinweis zum Signierschluessel

Das urspruengliche Archiv enthielt `WebsiteTimeTrack.pem`, den privaten
Signierschluessel der Extension. Er ist bewusst nicht eingecheckt – wer ihn
hat, kann Updates unter derselben Extension-ID veroeffentlichen. `.gitignore`
blockt `*.pem` und `*.crx`; die Datei gehoert ausserhalb des Repos aufbewahrt.
