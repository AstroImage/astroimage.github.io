/* AIS ANCHE SENZA RETE (21 ottobre 2026).
   ═══════════════════════════════════════════════════════════

   La pagina arriva dal sito, e al telescopio la rete puo' mancare: nel browser come nel pannello del Ponte, che apre la
   pagina vera da https. Questo e' il lavoratore di sfondo del browser (service worker): tiene una copia della pagina e dei
   suoi dati, presa durante una visita con la rete, e la da' quando la rete non risponde.

   PRIMA LA RETE, POI LA COPIA. Con la rete si serve sempre la versione del sito, e intanto si rinnova la copia: una pagina
   nuova arriva come prima, al primo caricamento. Solo se la rete non risponde — o non risponde entro ATTESA_MS, che al
   telescopio con una rete lenta e' la stessa cosa — si serve la copia dell'ultima visita.

   SOLO LE COSE DEL SITO. La pagina, i dati, la guida, il manifesto e le icone dell'app: le richieste a un'altra
   origine — N.I.N.A. sulla porta 1888, le immagini del cielo, i cataloghi — passano senza che le tocchi, e senza rete
   semplicemente non rispondono, come oggi.
   Solo le letture (GET): il resto non si mette da parte.

   Fuori dal sito, o aperta dal file sul disco, la pagina non registra questo lavoratore: lo standalone ha gia' tutto
   dentro. */

const COPIA = 'ais-pagina';
const ATTESA_MS = 6000;

self.addEventListener('install', (e) => { self.skipWaiting(); });

/* Si prende subito in carico la pagina aperta, senza aspettare che la si ricarichi: la copia comincia dalla prima visita.
   Le copie con un altro nome — di un lavoratore di prima — si tolgono. */
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nome of await caches.keys()) if (nome !== COPIA) await caches.delete(nome);
    await self.clients.claim();
  })());
});

/* LA PRIMA VISITA. La pagina scarica i suoi dati prima di registrare questo lavoratore, e quelle richieste non passano di
   qui: allora la pagina dice che cosa ha caricato — se stessa e i file del sito — e se ne fa subito la copia. Solo indirizzi
   dello stesso sito. */
self.addEventListener('message', (e) => {
  const elenco = e.data && Array.isArray(e.data.copia) ? e.data.copia : null;
  if (!elenco) return;
  e.waitUntil((async () => {
    const copia = await caches.open(COPIA);
    for (const indirizzo of elenco) {
      try {
        if (new URL(indirizzo).origin !== self.location.origin) continue;
        const risposta = await fetch(indirizzo);
        if (risposta.ok) await copia.put(indirizzo, risposta);
      } catch (errore) { /* senza rete adesso: la copia si fara' alla prossima visita */ }
    }
  })());
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(dallaReteODallaCopia(r));
});

async function dallaReteODallaCopia(r) {
  const copia = await caches.open(COPIA);
  const dallaRete = fetch(r).then((risposta) => {
    if (risposta.ok) copia.put(r, risposta.clone());
    return risposta;
  });
  /* se vince la copia e poi la rete fallisce, l'errore della rete non resta senza nessuno che lo raccolga */
  dallaRete.catch(() => {});
  /* la rete ha ATTESA_MS per rispondere; se non ce la fa e c'e' una copia, si da' la copia, e la rete intanto continua e
     la rinnova per la volta dopo */
  let timer;
  const tardi = new Promise((ok) => { timer = setTimeout(() => ok('tardi'), ATTESA_MS); });
  try {
    const primo = await Promise.race([dallaRete, tardi]);
    if (primo !== 'tardi') { clearTimeout(timer); return primo; }
    const salvata = await dallaCopia(copia, r);
    return salvata || await dallaRete;
  } catch (errore) {
    clearTimeout(timer);
    const salvata = await dallaCopia(copia, r);
    if (salvata) return salvata;
    throw errore;
  }
}

/* LA PAGINA HA DUE NOMI. AIS installata come app parte da «./» (il manifesto), e chi l'ha aperta la prima volta da
   «index.html» ha in copia quel nome; o il contrario. Per una pagina da aprire, se il suo nome non c'e' si prova l'altro. */
async function dallaCopia(copia, r) {
  const salvata = await copia.match(r, { ignoreSearch: true });
  if (salvata || r.mode !== 'navigate') return salvata;
  const u = new URL(r.url);
  const altro = u.pathname.endsWith('/') ? u.pathname + 'index.html'
    : u.pathname.endsWith('/index.html') ? u.pathname.slice(0, -'index.html'.length) : null;
  return altro ? copia.match(new URL(altro, u.origin).href, { ignoreSearch: true }) : undefined;
}
