# Lagbilder

En liggande bild per lokalt lag, helst minst 1600 px bred.

1. Lägg originalet i `bilder/lag/` i projektroten (mappen ignoreras av git)
   med lagets namn nedan, t.ex. `bilder/lag/ifk-vastervik.jpg`. JPG, PNG
   och WebP går bra.
2. Kör `npm run images:lag`. Skriptet skapar `<namn>.webp` (1600 px) och
   `<namn>-640.webp` här i mappen.
3. Committa filerna i den här mappen.

Bilderna förminskas i förväg för att servern (Render gratis, 512 MB) inte ska
behöva göra det. De visas i "Veckans match", på lagkorten och på lagsidan
(efter omstart/deploy). Saknas bilden visas en grafisk reserv.

| Lag | Namn |
|---|---|
| IFK Västervik | `ifk-vastervik` |
| Hjorted/Totebo | `hjorted-totebo` |
| Tjust IF FF | `tjust-if-ff` |
| Västerviks FF | `vasterviks-ff` |
| B.O.IF | `boif` |
| Gunnebo IF | `gunnebo-if` |
| FC Örbäcken | `fc-orbacken` |
| Överums IK | `overums-ik` |
| Ankarsrums IS | `ankarsrums-is` |
| Västerviks damfotboll IF | `vasterviks-dam` |

Använd bara bilder ni har rätt att publicera.
