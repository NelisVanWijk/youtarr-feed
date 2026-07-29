# Youtarr Feed

Een mobiele abonnementenfeed voor Youtarr, gemaakt om op een iPhone als app te
gebruiken. De app toont gewone kanaalvideo’s, geen Shorts. Video’s die al lokaal
staan worden vanuit Youtarr afgespeeld. Tik je op een ontbrekende video, dan
start Youtarr de download meteen.

Je Youtarr-wachtwoord blijft alleen als serverinstelling in `.env`; het wordt
niet naar de browser of iPhone gestuurd.

## Koppelen

1. Kopieer `.env.example` naar een nieuw bestand met de naam `.env`.
2. Vul daarin je Youtarr-gebruikersnaam en -wachtwoord in.
3. Pas `YOUTARR_URL` alleen aan als Youtarr niet via poort 3087 op dezelfde
   server bereikbaar is.
4. Start de app met `docker compose up -d --build`.
4. Open `http://ADRES-VAN-JE-SERVER:3090` op je iPhone.
5. Kies in Safari voor **Deel → Zet op beginscherm**.

Zonder `.env` start de interface veilig in voorbeeldmodus.

## Wat je krijgt

- één chronologische feed van alle Youtarr-kanalen;
- een apart overzicht per kanaal;
- filters voor alles, nog ophalen en al gedownload;
- direct downloaden zodra je een ontbrekende video opent;
- lokaal afspelen zodra Youtarr klaar is;
- een indeling die zich als iPhone-app laat installeren.

## Unraid

De repository bevat een Unraid-template in `unraid/youtarr-feed.xml`. Daarin
kun je het Youtarr-adres, je inloggegevens, een optionele API-key en optionele
Plex-gegevens rechtstreeks in het Unraid-formulier invullen.

De Plex-velden zijn alleen nodig wanneer deze app na een afgeronde download
zelf een Plex-bibliotheekscan moet starten. Als Youtarr dat al doet, laat je ze
leeg.

GitHub Actions bouwt bij elke wijziging op `main` automatisch
`ghcr.io/nelisvanwijk/youtarr-feed:latest`.

Na publicatie kun je de ruwe URL van `unraid/youtarr-feed.xml` in Unraid
gebruiken of de template indienen bij Community Applications.

## Belangrijk

Zet de app voor gebruik buitenshuis achter HTTPS, bijvoorbeeld via je bestaande
reverse proxy of een privéverbinding zoals Tailscale. Publiceer de app en
Youtarr niet rechtstreeks via onbeveiligde HTTP-poorten.
