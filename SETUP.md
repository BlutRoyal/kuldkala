# Kuldkala seadistamine

Ühekordne seadistus, kokku umbes 20 minutit. Iga samm on eraldi ja väike.

## 1. Google Sheet ja server (~5 min)

1. Tee uus Google Sheet nimega **Kuldkala** (sheets.new).
2. Menüü **Extensions → Apps Script**. Kustuta sealne näidiskood ja kleebi asemele faili `apps-script/Code.gs` sisu. Salvesta (Ctrl+S).
3. Vali üleval funktsioon **setup** ja vajuta **Run**. Google küsib luba: vali oma konto → Advanced → Go to Kuldkala → Allow.
   Sheeti tekib leht `tasks`.

## 2. Praegused ülesanded sisse (~2 min)

1. Sheetis ava leht `tasks`.
2. **File → Import → Upload** ja vali fail `algandmed.csv` (saad selle Claude'ilt, see pole avalikus repos).
3. Vali **Append to current sheet** ja **Convert text to numbers, dates and formulas: No**. Vajuta Import.

## 3. Google'i sisselogimine (~7 min)

1. Ava https://console.cloud.google.com ja tee uus projekt nimega `kuldkala`.
2. **APIs & Services → OAuth consent screen**: tüüp External, äpi nimi Kuldkala, oma e-post. Lisa **Test users** alla oma Gmail.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://blutroyal.github.io`
4. Kopeeri **Client ID** (lõpeb `.apps.googleusercontent.com`).

## 4. Serveri seaded ja avaldamine (~3 min)

1. Apps Scriptis vasakul **⚙️ Project Settings → Script properties → Add**:
   - `CLIENT_ID` = eelmise sammu Client ID
   - `ALLOWED_EMAILS` = sinu Gmail (mitu aadressi komadega)
2. **Deploy → New deployment → ⚙️ Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (sisselogimist kontrollib kood ise, võõrad saavad vastuseks ainult vea)
3. Kopeeri **Web app URL** (lõpeb `/exec`).

## 5. Äpp

1. Pane Client ID ja Web app URL faili `config.js` (või saada need Claude'ile, need pole salajased).
2. GitHubis: repo **Settings → Pages → Branch: main, / (root) → Save**.
3. Telefonis ava Chrome'is `https://blutroyal.github.io/kuldkala/` → menüü ⋮ → **Lisa avakuvale**.

## 6. Teated (push)

**A. Uuenda server**
1. Apps Scriptis asenda kogu kood uue `apps-script/Code.gs` sisuga ja salvesta.
2. Käivita uuesti **setup** (lisab lehe `devices` ja veeru `log`).
3. Käivita **installTriggers** (kontrollib iga 5 min tagant, kas on vaja teadet saata). Luba õigused.
4. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** URL jääb samaks.

**B. Firebase**
1. console.firebase.google.com → **Add project** → vali olemasolev Google Cloudi projekt `kuldkala`.
2. ⚙️ **Project settings → General → Your apps → Web (</>)** → registreeri. Kopeeri `firebaseConfig` plokk.
3. **Cloud Messaging → Web Push certificates → Generate key pair.** Kopeeri võti.
4. **Service accounts → Generate new private key.** Avaneb JSON-fail. Kopeeri kogu selle sisu ja pane Apps Scripti
   **Script properties** alla nimega `FCM_KEY`. See on salajane: ära saada seda kellelegi ega pane GitHubi.
   Pärast võid faili arvutist kustutada.
5. `firebaseConfig` ja Web Push võti lähevad faili `config.js` (`FIREBASE` ja `VAPID_KEY`). Need pole salajased.

**C. Telefonis**
1. Ava äpp ja vajuta üleval kollast 🔔 ikooni → luba teated.
2. Proovi: Apps Scriptis käivita **testPush**. Telefoni peaks tulema teade "Teated töötavad!".

Kuidas teated käivad:
- Kellaajaga asjast tuleb teade õigel ajal. Kui see jääb kinnitamata, kordub teade iga 2 tunni järel 24 tunni jooksul.
  Öösel kella 22 ja 8 vahel teateid ei tule.
- Teates on nupud **✓ Tehtud** ja **1h hiljem**.
- Iga päev kell 9 tuleb **☀️ Tänane plaan**: mitu asja on üle tähtaja, mitu on täna, ilm ja mida esimesena teha.

## Turvalisus

- Repo on avalik, aga selles pole ühtegi salasõna. Client ID ja Web app URL on avalikud väärtused.
- Iga päringu juures kontrollib server Google'i sisselogimist ja seda, kas e-post on `ALLOWED_EMAILS` nimekirjas.
- Andmed on ainult sinu Google Sheetis. Ära jaga Sheeti kellelegi.
- Teate nupud kasutavad seadme oma salajast võtit. Sellega saab ainult asja tehtuks märkida või edasi lükata.
- Hoia Google'i ja GitHubi kontol kaheastmeline kinnitus (2FA) sees.

## Uue kasutaja lisamine (hiljem)

Lisa tema e-post `ALLOWED_EMAILS` hulka ja Google Cloudis **Test users** alla. Igaüks näeb ainult oma asju.
