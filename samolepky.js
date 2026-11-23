// ============================================================
//  SEZNAM SAMOLEPEK – tohle je jediné místo, které se mění,
//  když chceš přidat nebo vyměnit samolepky.
//
//  Každá samolepka:
//    id        – jedinečný kód (nesmí se opakovat, po vydání neměnit)
//    jmeno     – jak se jmenuje
//    emoji     – zatím místo obrázku
//    obrazek   – (nepovinné) cesta k obrázku, např. 'obrazky/pepa.png'
//                Když je vyplněný, ukáže se obrázek místo emoji.
//                Nejlepší je PNG s průhledným pozadím, cca 512×512.
//    barva     – barva okraje samolepky
//    vzacnost  – 'bezna' | 'neobvykla' | 'vzacna' | 'epicka' | 'legendarni'
//    mesto     – 'vsude' | 'litomysl' | 'usti'  (kde se objevuje)
//    popis     – krátký text do alba
// ============================================================

// vystrizek = postava bez pozadí (PNG). Na mapě a při chytání se ukáže ona místo kolečka.
window.SAMOLEPKY = [
  // ---- Samolepky lidí ----
  // utok / obrana / vydrz = základní hodnoty (jako u pokémonů, cca 100–300).
  // Čím vyšší, tím větší Síla a Životy. Když chybí, vezmou se podle vzácnosti.
  // vyplnit: true = fotka vyplní celou samolepku (pro fotky lidí).
  { id: 'baca', jmeno: 'Bača', emoji: '🧍‍♀️', obrazek: 'obrazky/baca.jpg', vystrizek: 'obrazky/baca-vystrizek.png', vyplnit: true, stred: '50% 22%', zoom: 1.5, barva: '#7D4FD8',
    vzacnost: 'epicka', mesto: 'vsude', utok: 255, obrana: 195, vydrz: 230,
    popis: 'Hodně vzácná. Kdo ji chytí, má štěstí.' },
  { id: 'rezi', jmeno: 'Hladová Rézi', emoji: '🍴', obrazek: 'obrazky/hladova-rezi.jpg', vystrizek: 'obrazky/hladova-rezi-vystrizek.png', vyplnit: true, stred: '46% 30%', zoom: 1.35, barva: '#FF9F0A',
    vzacnost: 'bezna', mesto: 'vsude', utok: 150, obrana: 120, vydrz: 175,
    popis: 'Potkáš ji skoro všude. S příborem v ruce a pořád hladová.' },
  { id: 'jev', jmeno: 'Vzácný jev', emoji: '🥕', obrazek: 'obrazky/vzacny-jev.jpg', vystrizek: 'obrazky/vzacny-jev-vystrizek.png', vyplnit: true, stred: '44% 30%', zoom: 1.4, barva: '#FF6B3D',
    vzacnost: 'neobvykla', mesto: 'vsude', utok: 175, obrana: 150, vydrz: 165,
    popis: 'Tak vzácný zase není. Ale chytit ho stojí za to.' },
];

// Města, kde se hraje. Uvnitř poloměru (v metrech) je víc samolepek
// a objevují se tam i ty „jen pro město“.
window.MESTA = {
  litomysl: { jmeno: 'Litomyšl',        lat: 49.8706, lon: 16.3109, polomer: 3500 },
  usti:     { jmeno: 'Ústí nad Orlicí', lat: 49.9740, lon: 16.3937, polomer: 3500 },
};

// Vlastní Lepárny (místa, kde se doplňují lapky). Můžeš přidat skutečná místa:
//   { jmeno: 'Zámek', lat: 49.8680, lon: 16.3120 },
// Souřadnice najdeš v Mapách: podrž prst na místě a zkopíruj čísla.
window.ZASTAVKY_VLASTNI = [];
