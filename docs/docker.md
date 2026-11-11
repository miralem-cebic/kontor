# kontor im Container (Raspberry Pi und andere Rechner)

kontor kann als Docker-Container laufen, zum Beispiel auf einem Raspberry Pi im Heimnetz. Dann hast du eine Adresse, unter der du kontor von jedem Rechner im Haus öffnest, ohne die Dateien zu verteilen.

## Was der Container macht und was nicht

- Der Container liefert nur die App aus, wie ein Webserver eine Webseite. Er hat keine Datenbank, kein Konto und keinen Zugriff auf deine Daten.
- Deine Daten liegen weiterhin in dem Ordner, den du im Browser auswählst, auf dem Rechner, an dem der Browser läuft. Der Pi sieht sie nie. Er sichert sie auch nicht: die Sicherung des Ordners bleibt deine Aufgabe.
- Die App sendet nichts an den Pi zurück (`connect-src 'none'`). Der Pi liefert die Seite, mehr nicht.
- kontor hat keine Anmeldung. Wer die Adresse im Netz erreicht, sieht die App, aber nicht deine Firmenordner. Veröffentliche den Port nicht im Internet.

## Wichtig: ohne HTTPS geht es nicht

Chrome und Edge geben den Ordnerdialog nur an „sicheren“ Adressen frei: `https://…` oder `http://localhost`. Unter `http://raspberrypi.local:8080` meldet kontor „Browser nicht unterstützt“. Deshalb veröffentlicht `compose.yaml` den Port nur auf dem eigenen Rechner (`127.0.0.1`). Für das Heimnetz gibt es drei Wege:

| Weg | Wann |
| --- | --- |
| **SSH-Tunnel** | Zum Ausprobieren. Auf deinem Rechner: `ssh -L 8080:127.0.0.1:8080 pi@raspberrypi.local`, dann `http://localhost:8080` öffnen. |
| **Caddy mit eigenem Zertifikat** (`compose.https.yaml`) | Dauerhaft im Heimnetz, ohne eigene Domain. Jedes Gerät muss dem Zertifikat einmal vertrauen (siehe unten). |
| **Ein Reverse Proxy, den du schon hast** | Zum Beispiel Nginx Proxy Manager, Traefik oder Tailscale (`tailscale serve --bg 8080`). Er liefert HTTPS und reicht an Port 8080 weiter. |

## Installieren

Du brauchst einen Raspberry Pi mit einem 64-Bit- oder 32-Bit-Raspberry-Pi-OS (Pi 2, 3, 4, 5 und Zero 2 W; das Image gibt es für `arm64` und `arm/v7`, nicht für den Pi 1 und den Pi Zero) und Docker mit dem Compose-Plugin ([Anleitung von Docker](https://docs.docker.com/engine/install/raspberry-pi-os/)).

```bash
mkdir kontor && cd kontor
curl -fsSLO https://raw.githubusercontent.com/miralem-cebic/kontor/main/compose.yaml
docker compose up -d
```

Dann ist kontor auf dem Pi unter `http://localhost:8080` erreichbar, für dein Heimnetz brauchst du einen der Wege oben.

Das Image heißt `ghcr.io/miralem-cebic/kontor` und wird bei jedem Release veröffentlicht (`<version>` und `latest`). Wer eine bestimmte Version will, trägt sie in `compose.yaml` statt `latest` ein.

Aus dem Quellcode: `docker compose up -d --build` im geklonten Repository baut das Image selbst (auf dem Pi dauert das einige Minuten).

### Port und Adresse ändern

Über Umgebungsvariablen oder eine `.env`-Datei neben `compose.yaml`:

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `KONTOR_PORT` | `8080` | Port auf dem Pi |
| `KONTOR_BIND` | `127.0.0.1` | Adresse, auf der der Port lauscht. `0.0.0.0` öffnet ihn für das ganze Netz, aber **nur mit HTTPS davor** sinnvoll (siehe oben). |

## HTTPS im Heimnetz mit Caddy

1. Rechnernamen des Pi feststellen: `hostname`. Unter Raspberry Pi OS erreichst du ihn im Heimnetz als `<name>.local`, zum Beispiel `raspberrypi.local`.
2. Starten, mit diesem Namen:

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/miralem-cebic/kontor/main/compose.https.yaml
   mkdir -p docker && curl -fsSL -o docker/Caddyfile https://raw.githubusercontent.com/miralem-cebic/kontor/main/docker/Caddyfile
   KONTOR_HOST=raspberrypi.local docker compose -f compose.yaml -f compose.https.yaml up -d
   ```

3. Das Zertifikat von Caddy kommt von einer eigenen Zertifizierungsstelle. Hole ihr Wurzelzertifikat vom Pi:

   ```bash
   docker compose -f compose.yaml -f compose.https.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt ./kontor-root.crt
   ```

4. Installiere `kontor-root.crt` auf jedem Gerät, das kontor öffnet, als vertrauenswürdige Stammzertifizierungsstelle (Windows: Doppelklick, „Zertifikat installieren“, „Vertrauenswürdige Stammzertifizierungsstellen“; macOS: Schlüsselbundverwaltung, „Immer vertrauen“). Danach öffnest du `https://raspberrypi.local`.

Installiere nur das Wurzelzertifikat deines eigenen Pi. Sein privater Schlüssel liegt im Volume `caddy_data` auf dem Pi: wer ihn bekommt, kann Zertifikate ausstellen, denen deine Geräte vertrauen. Schütze den Pi und seine Sicherungen entsprechend, und gib das Volume nicht weiter.

## Beachte

- **Jede Adresse ist für den Browser ein eigener Ort.** Wechselst du Adresse oder Port (`localhost:8080`, `raspberrypi.local`), fragt kontor einmal neu nach dem Ordner. Die Ordner selbst bleiben unberührt.
- **Nie ein Unternehmen auf zwei Geräten gleichzeitig bearbeiten.** Eine gemeinsame Adresse macht das leichter, als es sein sollte. Rechnungsnummern setzen voraus, dass jeweils nur ein Gerät schreibt (siehe [README](../README.md), „Deine Daten“).
- **Nur Chrome oder Edge am Desktop.** Daran ändert der Container nichts.
- **Aktualisieren:** `docker compose pull && docker compose up -d`. Danach lädt der Browser die neue Version beim nächsten Öffnen.
- **Prüfen:** `docker compose ps` zeigt `healthy`, wenn der Server antwortet.

Technischer Hintergrund und die Gründe stehen in [ADR 0007](adr/0007-container-image-for-self-hosting.md).
