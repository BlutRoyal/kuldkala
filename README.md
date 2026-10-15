# 🐟 Kuldkala

Isiklik ToDo ja meeldetuletuste äpp (PWA), mille saab lisada telefoni avakuvale.

- Asjad on jaotatud: tähtaeg möödas, täna, tulemas, ilma tähtajata, ootan, kunagi.
- Sildid **Töö** ja **Era**, iga asja juures "Esimene samm (~5 min)".
- Vaba tekst: "homme kell 15 helista Peetrile #töö" täidab kuupäeva, kella ja sildi ise (`parse.js`).
- Ühe puudutusega tehtuks, kiire lisamine, tänase päeva ilm (Open-Meteo).
- Andmed on omaniku Google Sheetis, server on Google Apps Script, sisselogimine käib Google'i kontoga.

Seadistamine: vaata [SETUP.md](SETUP.md).

Kui `config.js` on tühi, töötab äpp demorežiimis ja hoiab andmeid ainult brauseris.

## Failid

| Fail | Mis see on |
|---|---|
| `index.html`, `app.js`, `style.css` | äpp |
| `sw.js`, `manifest.webmanifest`, `icons/` | avakuvale lisamine ja võrguta avamine |
| `config.js` | avalikud seaded (serveri URL, Google Client ID) |
| `apps-script/Code.gs` | server, mis kleebitakse Google Sheeti Apps Scripti |
