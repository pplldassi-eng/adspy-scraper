import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import fs from 'fs';
import { Pool } from 'pg';

const KEYWORD = process.env.SCRAPE_KEYWORD || 'livraison gratuite';
const COUNTRY = process.env.SCRAPE_COUNTRY || 'CI';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function scoreEcommerce(ad: any): number {
  const combined = (ad.text + ' ' + ad.advertiser + ' ' + ad.destinationUrl).toLowerCase();
  let score = 0;

  const jours = ad.daysActive || 0;
  if (jours >= 60) score += 20;
  else if (jours >= 30) score += 12;
  else if (jours >= 15) score += 6;

  if (/(whatsapp|api\.whatsapp)/i.test(combined)) score += 5;
  if (/\b(livraison|paiement à la livraison|cod|cash on delivery)\b/i.test(combined)) score += 4;
  if (/\d[\d\s.,]*\s*(fcfa|cfa|\bf\b)/i.test(ad.text)) score += 4;
  if (/\.(ci|sn|cm|bf|ml|tg|bj)\b/i.test(combined)) score += 4;

  if (/\b(meshy|vfx|after effects|cgi|render|animation|tutorial|course|ebook)\b/i.test(combined)) score -= 15;
  if (/\b(recipe|recette|vegan|dessert|gluten|ingredients)\b/i.test(combined)) score -= 15;
  if (/\b(plugin|wordpress|license|autocad|revit|bim)\b/i.test(combined)) score -= 15;
  if (/\b(english|tutor|learn|sculpting|game asset)\b/i.test(combined)) score -= 15;
  if (/\b(consultation|interior design|architecture|b2b|wholesaler)\b/i.test(combined)) score -= 15;

  return score;
}

function looksLikeEcommerce(ad: any): boolean {
  return scoreEcommerce(ad) >= 5;
}

function extractPrice(text: string): number | null {
  const patterns = [
    /(\d[\d\s.,]*)\s*(?:FCFA|F CFA|CFA)/i,
    /(\d{1,3}(?:[.\s]\d{3})+)\s*F\b/i,
    /(\d{4,6})\s*F\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const n = m[1].replace(/[^\d]/g, '');
      if (n.length >= 3 && n.length <= 8) return parseInt(n);
    }
  }
  return null;
}

function daysSince(dateStr: string): number {
  if (!dateStr) return 0;
  const mois: any = {
    'janv': 0, 'févr': 1, 'mars': 2, 'avr': 3, 'mai': 4, 'juin': 5,
    'juil': 6, 'août': 7, 'sept': 8, 'oct': 9, 'nov': 10, 'déc': 11
  };
  const m = dateStr.match(/(\d+)\s+([a-zéû]+)\s+(\d{4})/i);
  if (!m) return 0;
  const day = parseInt(m[1]);
  const monthKey = Object.keys(mois).find(k => m[2].toLowerCase().startsWith(k.slice(0, 4)));
  if (!monthKey) return 0;
  const date = new Date(parseInt(m[3]), mois[monthKey], day);
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export function cleanUrl(u: string): string {
  return u
    .replace(/\\u0026/g, '&')
    .replace(/\\u0025/g, '%')
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\+$/, '');
}

export function extractMediaUrls(html: string) {
  const re = /https:(?:\\?\/){2}(?:scontent|video)[^"'\s<>]*/g;
  const all = [...new Set((html.match(re) || []).map(cleanUrl))];
  const signed = all.filter(u => /[?&]oh=/.test(u) && /[?&]oe=/.test(u));
  const path = (u: string) => u.split('?')[0];
  const images = signed.filter(u => /\.(jpg|jpeg|png|webp)$/i.test(path(u)));
  const videos = signed.filter(u => /\.mp4$/i.test(path(u)));
  return { images, videos, total: all.length, signed: signed.length };
}

async function downloadMedia(context: BrowserContext, url: string) {
  const r = await context.request.get(url, {
    headers: { Referer: 'https://www.facebook.com/' },
    timeout: 60000,
  });
  if (!r.ok()) {
    const body = (await r.text()).slice(0, 80);
    throw new Error(`DOWNLOAD HTTP ${r.status()} : ${body}`);
  }
  return {
    buffer: await r.body(),
    contentType: r.headers()['content-type'] || 'application/octet-stream',
  };
}

export async function uploadToCatbox(
  context: BrowserContext,
  fileUrl: string,
  resourceType: 'image' | 'video'
): Promise<string | null> {
  try {
    const { buffer, contentType } = await downloadMedia(context, fileUrl);
    const ext = resourceType === 'video' ? 'mp4'
      : contentType.includes('png') ? 'png'
      : contentType.includes('webp') ? 'webp' : 'jpg';
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([buffer], { type: contentType }), `ad_${Date.now()}.${ext}`);
    const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
    const text = (await res.text()).trim();
    if (!res.ok || !text.startsWith('https://')) {
      console.error(`❌ UPLOAD Catbox ${res.status} : ${text.slice(0, 100)}`);
      return null;
    }
    return text;
  } catch (e: any) {
    console.error(`❌ ${resourceType} : ${e.message}`);
    return null;
  }
}

async function scrapeAds(keyword: string, country: string) {
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: 'http://localhost:8080' },
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'fr-FR',
  });
  const page = await context.newPage();

  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(keyword)}&search_type=keyword_unordered&media_type=all`;

  console.log(`Recherche : "${keyword}" en ${country} via Flaregun proxy`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(8000);

  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(1500 + Math.random() * 1500);
  }

  fs.mkdirSync('debug', { recursive: true });
  const pageText: string = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`debug/${keyword}-${country}-fulltext.txt`, pageText);

  // Récupérer le HTML complet de la page (contient les attributs src)
  const pageHtml: string = await page.content();
  fs.writeFileSync(`debug/${keyword}-${country}-page.html`, pageHtml);
  
  const { images: uniqueImages, videos: uniqueVideos, total, signed } = extractMediaUrls(pageHtml);
  console.log(`🔗 ${total} liens trouvés, ${signed} signés (oh+oe)`);

  const adBlocks = pageText.split(/(?=(?:Actif|Inactif)\s*\n\s*ID dans la bibliothèque\s*:)/);
  console.log(`${adBlocks.length} blocs bruts detectes`);

  const rawAds: any[] = [];

  for (const block of adBlocks) {
    const libraryId = block.match(/ID dans la bibliothèque\s*:\s*(\d+)/)?.[1];
    if (!libraryId) continue;

    const startDate = block.match(/Début de diffusion le\s*(.+?)(?:\n|$)/)?.[1]?.trim() || '';
    const advertiser = block.match(/\n([^\n]+?)\nSponsorisé/)?.[1]?.trim() || '';
    const destinationUrl = block.match(/\n([A-Z][A-Z0-9.\-]+\.[A-Z]{2,})\n/)?.[1]?.trim() || '';
    const cta = block.match(/\n(Commander|Learn More|S'inscrire|Shop Now|Send WhatsApp Message|Acheter|Download|Order Now|Envoyer un message WhatsApp)\n?/)?.[1] || '';

    let text = '';
    const sponsoIdx = block.indexOf('Sponsorisé');
    if (sponsoIdx >= 0) {
      const after = block.slice(sponsoIdx + 'Sponsorisé'.length);
      const stop = after.match(/\n(?=\d+:\d+\s*\/|\n[A-Z][A-Z0-9.\-]+\.[A-Z]{2,}\n|Commander|Learn More|Shop Now)/);
      text = after.slice(0, stop ? stop.index! : Math.min(after.length, 3000)).trim();
    }

    // Associer par index (chaque bloc = 1 annonce)
    const mediaIndex = rawAds.length;
    const imageUrl = uniqueImages[mediaIndex] || null;
    const videoUrl = uniqueVideos[mediaIndex] || null;

    if (imageUrl) console.log(`  🖼️ Image trouvée pour ${advertiser || 'inconnu'}`);
    if (videoUrl) console.log(`  🎥 Vidéo trouvée pour ${advertiser || 'inconnu'}`);

    const daysActive = daysSince(startDate);
    const price = extractPrice(text);

    const ad = {
      libraryId,
      advertiser,
      productName: text.split('\n')[0]?.slice(0, 200) || '',
      text,
      price,
      destinationUrl,
      cta,
      startDate,
      daysActive,
      status: 'Actif',
      country,
      keyword,
      imageUrl,
      videoUrl,
    };

    (ad as any).score = scoreEcommerce(ad);
    rawAds.push(ad);
  }

  const ads = rawAds.filter(looksLikeEcommerce);

  fs.writeFileSync(
    `debug/${keyword}-${country}-ads.json`,
    JSON.stringify(ads, null, 2)
  );
  fs.writeFileSync(
    `debug/${keyword}-${country}-raw.json`,
    JSON.stringify(rawAds, null, 2)
  );

  console.log(`${rawAds.length} brutes -> ${ads.length} e-commerce retenues`);

  for (const ad of ads) {
    try {
      // Upload vers Catbox.moe
      let finalImageUrl: string | null = null;
      if (ad.imageUrl) {
        finalImageUrl = await uploadToCatbox(context, ad.imageUrl, 'image');
        if (finalImageUrl) {
          console.log(`  📦 Image uploadée vers Catbox pour ${ad.advertiser}`);
        }
      }
      
      let finalVideoUrl: string | null = null;
      if (ad.videoUrl) {
        finalVideoUrl = await uploadToCatbox(context, ad.videoUrl, 'video');
        if (finalVideoUrl) {
          console.log(`  📦 Vidéo uploadée vers Catbox pour ${ad.advertiser}`);
        }
      }

      await pool.query(
        `INSERT INTO ads (
          library_id, advertiser, product_name, ad_text, price, 
          destination_url, cta, start_date, days_active, status, 
          country, keyword, score, image_url, video_url
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        ON CONFLICT (library_id) DO UPDATE SET
          days_active = EXCLUDED.days_active,
          score = EXCLUDED.score,
          image_url = EXCLUDED.image_url,
          video_url = EXCLUDED.video_url,
          scraped_at = NOW()`,
        [
          ad.libraryId, ad.advertiser, ad.productName, ad.text,
          ad.price, ad.destinationUrl, ad.cta, ad.startDate,
          ad.daysActive, ad.status, ad.country, ad.keyword, 
          ad.score, finalImageUrl, finalVideoUrl
        ]
      );
      console.log(`Sauvegarde : ${ad.advertiser} (score ${ad.score}, ${ad.daysActive}j)`);
    } catch (e) {
      console.error(`Erreur insert ${ad.libraryId}:`, e);
    }
  }

  await browser.close();
  return ads;
}

async function main() {
  try {
    await scrapeAds(KEYWORD, COUNTRY);
  } catch (e) {
    console.error(`Erreur "${KEYWORD}" (${COUNTRY}):`, e);
  }
  await pool.end();
}

main().catch(console.error);
