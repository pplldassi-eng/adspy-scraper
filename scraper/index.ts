import { chromium } from 'playwright';
import fs from 'fs';

const KEYWORDS = ['blender'];
const COUNTRIES = ['CI'];

// Filtre : garde seulement les annonces e-commerce probables
function looksLikeEcommerce(ad: any): boolean {
  const text = (ad.text + ' ' + ad.advertiser + ' ' + ad.destinationUrl).toLowerCase();
  // Exclusions explicites
  const blacklist = [
    'meshy', '3d', 'blender 3d', 'after effects', 'vfx',
    'unity', 'unreal', 'godot', 'game', 'asset', 'animation',
    'english tutor', 'recipe', 'vegan', 'dessert', 'cookies',
    'wordpress', 'plugin', 'interior design', 'architecture',
  ];
  if (blacklist.some((w) => text.includes(w))) return false;
  // Inclusions positives (domaines locaux, whatsapp, shopify, etc.)
  const whitelist = [
    '.ci', '.sn', '.cm', '.bf', '.ml', '.tg', '.bj',
    'whatsapp', 'shop', 'store', 'brainnel', 'djokstore',
    'livraison', 'commander', 'fcfa', 'cfa', 'f cfa',
  ];
  return whitelist.some((w) => text.includes(w));
}

async function scrapeAds(keyword: string, country: string) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'fr-FR',
  });
  const page = await context.newPage();

  const url =
    `https://www.facebook.com/ads/library/?active_status=active` +
    `&ad_type=all&country=${country}` +
    `&q=${encodeURIComponent(keyword)}` +
    `&search_type=keyword_unordered&media_type=all`;

  console.log(`🔍 Recherche : "${keyword}" en ${country}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(8000);

  // Scroll agressif pour charger max d'annonces
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(1500 + Math.random() * 1500);
  }

  fs.mkdirSync('debug', { recursive: true });
  await page.screenshot({
    path: `debug/${keyword}-${country}.png`,
    fullPage: true,
  });

  // 🔑 Extraction par TEXTE (beaucoup plus robuste que les sélecteurs CSS)
  const pageText: string = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`debug/${keyword}-${country}-fulltext.txt`, pageText);

  // Découpage par blocs d'annonces
  const adBlocks = pageText.split(
    /(?=(?:Actif|Inactif)\s*\n\s*ID dans la bibliothèque\s*:)/
  );

  console.log(`📦 ${adBlocks.length} blocs bruts détectés`);

  const rawAds: any[] = [];

  for (const block of adBlocks) {
    const libraryId = block.match(
      /ID dans la bibliothèque\s*:\s*(\d+)/
    )?.[1];
    if (!libraryId) continue;

    const startDateMatch = block.match(/Début de diffusion le\s*(.+?)(?:\n|$)/);
    const startDate = startDateMatch?.[1]?.trim() || '';

    const status = /^Actif/m.test(block.trim()) ? 'Actif' : 'Inactif';

    // Annonceur : ligne juste avant "Sponsorisé"
    const advertiserMatch = block.match(/\n([^\n]+?)\nSponsorisé/);
    const advertiser = advertiserMatch?.[1]?.trim() || '';

    // URL de destination (domaine en majuscules ex: DJOKSTORE.CI)
    const urlMatch = block.match(/\n([A-Z][A-Z0-9.\-]+\.[A-Z]{2,})\n/);
    const destinationUrl = urlMatch?.[1]?.trim() || '';

    // CTA
    const ctaMatch = block.match(
      /\n(Commander|Learn More|S'inscrire|Shop Now|Send WhatsApp Message|Acheter|Download|Order Now|Envoyer un message WhatsApp)\n?/
    );
    const cta = ctaMatch?.[1] || '';

    // Texte de la pub : entre "Sponsorisé" et le 1er marqueur (vidéo/URL/CTA)
    let text = '';
    const sponsoIdx = block.indexOf('Sponsorisé');
    if (sponsoIdx >= 0) {
      const after = block.slice(sponsoIdx + 'Sponsorisé'.length);
      const stop = after.match(
        /\n(?=\d+:\d+\s*\/|\n[A-Z][A-Z0-9.\-]+\.[A-Z]{2,}\n|Commander|Learn More|Shop Now|S'inscrire|Acheter|Send WhatsApp)/
      );
      const end = stop ? stop.index! : Math.min(after.length, 3000);
      text = after.slice(0, end).trim();
    }

    // Image
    const imageMatch = block.match(/https:\/\/scontent[^\s)]+\.(jpg|jpeg|png|webp)/);
    const imageUrl = imageMatch?.[0] || '';

    rawAds.push({
      libraryId,
      advertiser,
      text,
      imageUrl,
      destinationUrl,
      cta,
      startDate,
      status,
      country,
      keyword,
      scrapedAt: new Date().toISOString(),
    });
  }

  // Filtrage e-commerce
  const ads = rawAds.filter(looksLikeEcommerce);

  fs.writeFileSync(
    `debug/${keyword}-${country}-ads.json`,
    JSON.stringify(ads, null, 2)
  );
  fs.writeFileSync(
    `debug/${keyword}-${country}-raw.json`,
    JSON.stringify(rawAds, null, 2)
  );

  console.log(
    `✅ ${rawAds.length} annonces brutes → ${ads.length} e-commerce retenues`
  );

  ads.slice(0, 5).forEach((ad) => {
    console.log(`\n--- ${ad.advertiser} (ID ${ad.libraryId}) ---`);
    console.log(`📅 ${ad.startDate} | ${ad.status}`);
    console.log(`🔗 ${ad.destinationUrl} | CTA: ${ad.cta}`);
    console.log(`📝 ${ad.text.slice(0, 250).replace(/\n/g, ' ')}...`);
  });

  await browser.close();
  return ads;
}

async function main() {
  for (const keyword of KEYWORDS) {
    for (const country of COUNTRIES) {
      try {
        await scrapeAds(keyword, country);
      } catch (e) {
        console.error(`❌ Erreur "${keyword}" (${country}):`, e);
      }
    }
  }
}

main().catch(console.error);
