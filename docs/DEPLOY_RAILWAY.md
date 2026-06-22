# Deploy su Railway — Soundclash

Guida per mettere online il gioco e farlo testare da più persone.
La demo live gira su Railway: **https://soundclash-production-9c06.up.railway.app/**

## ⚠️ La scelta che conta: una sola istanza (NON multi-replica/autoscale)

Le sessioni delle stanze vivono nel processo del server (`lib/server/session-store.ts`).
Per questo il deploy deve girare su **una sola istanza sempre accesa**:

- ✅ **Singola replica** — `railway.json` fissa `numReplicas: 1`. Host e telefoni colpiscono
  lo **stesso processo** → il multiplayer funziona **senza modifiche al codice**.
- ❌ **Più repliche / autoscale** — ogni istanza ha la sua memoria → l'host crea la stanza su
  un'istanza, il giocatore entra su un'altra → "stanza non trovata". Non usarlo finché le
  sessioni non sono su uno store condiviso (Redis/Supabase).

## Passi (Railway)

1. **Crea il progetto** su Railway → **Deploy from GitHub repo** → seleziona `MichaelxBelmonte/SoundClash`.
2. **Build & start** (già definiti in `railway.json`, builder NIXPACKS):
   - **Build command:** `npm run build`
   - **Start command:** `npm run start` (lo start script fa il bind su `0.0.0.0:$PORT`)
   - `numReplicas: 1`, `restartPolicyType: ON_FAILURE`.
3. **Variabili d'ambiente** (Service → Variables) — almeno:
   - `MXM_KEY` = chiave Musixmatch **(obbligatoria** — ricerca + testi)
   - `ELEVENLABS_API_KEY` (opzionale — voce host BEATBOT + Genre Roulette/Beat Lock/Voice Clash; senza, quei giochi sono bloccati ma lo show lirico gira)
   - `ELEVENLABS_VOICE_HYPE` / `_JUDGE` / `_DIVA` (opzionali — id voce)
   - `ANTHROPIC_API_KEY` (opzionale — distractor lirici dei giochi, bars di Voice Clash, e localizzazione del banter nelle lingue del narratore diverse da `en`/`it`; senza, si usano euristiche locali / pacchetto inglese)
   - `ANTHROPIC_BANTER_MODEL` / `ANTHROPIC_CHOICES_MODEL` (opzionali — override modello; default `claude-opus-4-8` / `claude-sonnet-4-6`)
   - `LALAL_API_KEY` (opzionale — separazione stem per Stem Heist)
   - **Non** mettere mai i segreti nel codice o in file committati.
4. **Node:** il progetto è pinnato a Node 22 (`package.json` → `engines`, `.nvmrc`). NIXPACKS lo rispetta.
5. Avvia il deploy. Ottieni un URL pubblico HTTPS (oggi `https://soundclash-production-9c06.up.railway.app/`).

## Verifica online (test reale)

1. Apri l'URL sul **portatile/TV** → `Start clash` → crea la stanza host.
2. Sul telefono: **scansiona il QR** (oppure vai su `/join` e digita il codice).
3. L'host parte (`Auto-pick show`) e i telefoni rispondono in tempo reale (polling 1s).
4. Il QR/link usa l'origine reale del deploy (`window.location.origin`) → scansiona da qualsiasi telefono. ✅
5. Apri il **network tab** su una schermata lirica: verifica che compaiano la stringa
   `lyrics_copyright` e la chiamata al tracking pixel Musixmatch su **ogni** render del testo.

## Limite noto (in-memory)

Un **redeploy o un crash riavvia il processo → le stanze attive si perdono**. Per una demo dal
vivo è irrilevante. Per robustezza durante la valutazione si può spostare lo store sessioni su
uno store condiviso (**Upstash Redis** o Supabase). ⚠️ **Non ancora implementato**: oggi
`lib/server/session-store.ts` è una semplice `Map` in-memory, senza alcun codice Redis.

## Alternativa: Replit (Reserved VM)

Soundclash gira anche su **Replit** scegliendo un deployment **Reserved VM** (singola macchina
sempre accesa) — **non** Autoscale, per lo stesso motivo della singola replica qui sopra.
Build `npm run build`, run `npm run start`. Il file `.replit` nel repo preconfigura il progetto.

## Note Next.js

- `next start` legge `PORT` e fa il bind su `0.0.0.0` (impostato nello script `start`).
- Verifica che `npm run build` passi in locale **a dev server spento** (`next build` mentre
  gira `next dev` corrompe `.next`).
