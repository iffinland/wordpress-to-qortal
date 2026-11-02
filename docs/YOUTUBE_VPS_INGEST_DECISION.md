# YouTube-videote VPS-ingest: teostatavuse otsus ja tööplaan

Status: **audit / otsustusdokument**, 2026-11-02. See dokument ei kirjelda
implementeeritud funktsionaalsust. Praegune kood ei laadi YouTube'i videoid alla
ega avalda QDN-i serverist.

Keskne detailne audit:
`/home/iffi/dev-workspace/docs/wordpress-to-qortal/audit/2026-11-02-youtube-vps-ingest-audit.md`

## Otsus lühidalt

YouTube'i videote VPS-is allalaadimine ja töötlemine on **tehniliselt
teostatav**, kuid see on uus serveripoolne alamsüsteem, mitte olemasoleva
kohaliku töövoo väike muudatus.

Praegune töövoog on täielikult kasutaja arvutis:

```text
dump -> convert -> plan-media -> download-media -> validate -> prepare-publish
```

Seejärel valib kasutaja Qortal UI-s kohaliku batch-kataloogi ja Q-App saadab
brauseri `File` objektid Qortal Hubi bridge'i kaudu. `src/publish.js` teeb ainult
`--dry-run` kontrolli; päris QDN-avaldamine on implementeerimata.

YouTube'i `iframe`-id tuvastatakse `src/utils/html.js`-s `media.embeds`
loendina, kuid `src/convert.js` `createMediaMap()` ei lisa neid media-mappi.
Seetõttu YouTube'i videoid ei planeerita, ei laadita, ei transkodeerita ega
avaldata QDN-i.

## Kolm eraldi kihti

| Kiht | Praegu | VPS-põhine lahendus |
| --- | --- | --- |
| Ingest | WordPressi media + välised YouTube embed'id | `yt-dlp` või originaalmasteri upload |
| Töötlus | Kasutaja arvutis või üldse mitte | `ffmpeg` VPS-is, üks worker |
| Avaldamine | Brauser + Qortal Hub + wallet | Qortal Core API VPS-is või eraldi signer |

Täielik "mitte kasutaja arvutisse" nõuab, et kõik kolm kihti oleksid
serveripoolsed. Kui VPS teeb ainult ingest'i ja transkodeerimise, tuleb valmis
fail ikkagi kasutaja masinani viia või lasta Q-Appil see alla laadida.

## Qortal avaldamise tehniline rada

Qortal Core `master` revisionis `108bf19` on olemas serveripoolne rada:

- `POST /arbitrary/{service}/{name}/{identifier}/chunk`
- `POST /arbitrary/{service}/{name}/{identifier}/finalize`
- `POST /transactions/sign`
- `POST /transactions/process`

Piirangud:

- `ArbitraryDataFile.MAX_FILE_SIZE = 2 GiB`;
- `CHUNK_SIZE = 512 KiB`;
- `/transactions/sign` võtab privaatvõtme päringu kehas;
- Qortal Core peab olema sync'itud ja nimi peab kuuluma allkirjastavale kontole;
- proof-of-work/nonce ja fee tuleb lahendada;
- partial/ambiguous avaldamist ei tohi automaatselt uuesti proovida.

**Praeguses VPS-is Qortal Core'i ei ole.** Seal töötab ainult Qortium preview
(`qortium-1.8.1-51cfb30`, testnet, API port 24891). Qortiumi ei tohi Qortali
jaoks kasutada.

## VPS-i riistvara

Mõõdetud 2026-11-02:

| Näitaja | Väärtus |
| --- | --- |
| CPU | 6 vCPU, AMD EPYC (KVM) |
| RAM | 11,69 GiB, swap 0 |
| Ketas | 197 GB, 140 GB vaba, SSD |
| Qortiumi sõlm | ~3,7 GiB RAM |
| Võrk | ~210 Mbps download (mõõdetud) |
| 1080p H.264 veryfast | ~0,98× reaalajas |
| 720p H.264 veryfast | ~1,7× reaalajas |
| 4K H.264 veryfast | ~0,37× reaalajas |

Hinnang:

- **üks 1080p video korraga:** tinglikult jah, kuid CPU on piiripealne ja
  swap puudub;
- **720p väike batch:** jah;
- **paralleelsed tööd / 4K / suur arhiiv:** ei;
- **Qortal Core + Qortium samal VPS-il:** pingeline, vajab mõõtmist ja
  tõenäoliselt 16–32 GiB RAM-i, 1–2 TB SSD-d ning swap'i.

Ühe 60-minutilise 1080p video kettaeelarve koos lähte, transkodeeritud faili,
thumbnaili ja Qortali temp/koopiaga on ligikaudu 5–10 GB. 140 GB vaba ruumi
juures mahub 15–25 tööd, mitte kogu arhiiv.

## Tööplaan ja maht

| Faas | Sisu | Hinnang |
| --- | --- | --- |
| 0 | Audit ja otsus | 0,5–1 päev |
| 1 | PoC: `yt-dlp` + `ffmpeg` + üks video + mõõtmine | 2–4 päeva |
| 2 | VPS job runner, storage, retry/resume, cleanup, logid | 4–6 päeva |
| 3 | Qortal Core + API key + eraldi wallet + chunk/finalize/sign/process + verifitseerimine | 5–8 päeva |
| 4 | Transcode-profiilid, thumbnail, Q-Tube metadata, CMS-i viited | 3–6 päeva |
| 5 | Admin API/UI, auth, jobade vaade (valikuline) | 5–10 päeva |
| 6 | Turva, backup, monitor, õiguslik kontroll, piloot | 3–5 päeva |

- **MVP ilma UI-ta:** ~15–24 tööpäeva (3–5 nädalat).
- **UI-ga:** ~20–34 tööpäeva (4–7 nädalat).
- **Tootmiskyps suur lahendus:** ~30–50 tööpäeva (6–10 nädalat).
- **Ainult VPS-i download + transcode, ilma QDN-avaldamiseta:** ~6–10 tööpäeva
  (1,5–2 nädalat).

Ühe 60-minutilise 1080p video töötlemine on praegusel VPS-il hinnanguliselt
1,2–2,2 tundi (download + transcode + QDN publish). 100 video töötlemine on
seega ~5–9 päeva pidevat tööd; 1000 video ~2–3 kuud.

## Riskid, mis tuleb enne implementatsiooni lahendada

1. **Õiguslik alus.** YouTube'i sisu allalaadimine peab olema õigustatud;
   eelistada Corbett Reporti originaalmastereid või selget luba.
2. **YouTube'i bot-check.** Andmekeskuse IP-d blokeeritakse sageli; `yt-dlp`
   vajab hooldust ja võib vajada küpsiseid/PO-tokenit.
3. **Qortal node'i mudel.** Lokaalne VPS-i sõlm vs eraldi sõlm; mõlemal on
   ressursi- ja turvamõju.
4. **Wallet'i mudel.** `/transactions/sign` vajab privaatvõtit. Kasuta eraldi
   publishing-kontot, mitte owner'i põhiwalletit; hoia võti VPS-is range
   õigusega ja ainult localhost API taga.
5. **Kettaruum ja backup.** 140 GB ei ole piisav suurele arhiivile; vaja
   retention'i, kvoote ja varundust.
6. **QDN 2 GiB piir.** Pikad/4K videod ei mahu; vaja 1080p piirangut või
   tükeldamist.
7. **Qortiumi sõlme kaitse.** Transkodeerimine peab olema piiratud (üks worker,
   `nice`/cgroup), et Qortiumi sõlm ei kannataks.

## Soovitatav esimene samm

1. Vali üks õigustega video (eelistatavalt originaalmaster).
2. Laadi see VPS-i `incoming/` kataloogi.
3. Transkodeeri 1080p H.264/AAC profiiliga, mõõda aeg, RAM ja ketta kasv.
4. Tee thumbnail ja metadata.
5. Ära avalda QDN-i enne, kui Qortal Core'i sõlm, wallet'i mudel ja õiguslik
   alus on owneri poolt kinnitatud.
6. Otsusta seejärel MVP maht ja infra laiendus.

## Seotud failid

- `src/downloadMedia.js` — lokaalne media download;
- `src/utils/html.js` — `iframe`/embed tuvastus;
- `src/convert.js` — `createMediaMap()` ja media-tüübid;
- `src/publish.js` — ainult dry-run;
- `viewer/src/publisher/PublisherPage.tsx` — brauseri `File` + `qortalRequest`
  publisher;
- `scripts/runCorbettBatch.js` — lokaalne batch-voog.
