# Schicht-Netto-Rechner (PWA)

Offline-fähige Web-App. Installierbar auf dem Pixel wie eine normale App.

## Auf dem Handy installieren – einfachster Weg (GitHub Pages)

1. Neues GitHub-Repo anlegen, z. B. `schicht-netto`.
2. Diese 5 Dateien hochladen: `index.html`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`.
3. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, Ordner `/root` → Save.
4. Nach ~1 Min ist die App live unter: `https://<dein-name>.github.io/schicht-netto/`
5. Diese URL am Pixel in **Chrome** öffnen → Menü (⋮) → **„App installieren"** (oder es erscheint der Button „App installieren" oben rechts).

Fertig: eigenes Icon im App-Drawer, läuft offline, kein Browser-Rahmen.

## Wichtig
- HTTPS ist Pflicht für die Installation – GitHub Pages liefert das automatisch. Ein lokales Öffnen per `file://` funktioniert **nicht** für die Installation (nur zum Anschauen).
- Nach Änderungen an `index.html`: in `sw.js` die Zeile `const CACHE = "schicht-netto-v1"` auf `v2` etc. hochzählen, sonst zeigt das Handy die alte Version aus dem Cache.

## Echtes APK (optional, später)
Sobald die PWA online ist: `pwabuilder.com` → deine URL eingeben → Android-Paket (.apk/.aab) generieren und per Sideload installieren.
