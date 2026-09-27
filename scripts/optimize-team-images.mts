// Förminskar lagbilder i förväg så att servern aldrig behöver göra det
// (Render gratis har 512 MB minne; ett mobilfoto som sharp avkodar i
// körtid kan ta flera hundra MB).
//
// Lägg originalen i bilder/lag/<slug>.<jpg|jpeg|png|webp> (mappen ignoreras
// av git) och kör: npm run images:lag
// Resultat: public/images/lag/<slug>.webp (1600 px) och <slug>-640.webp.

import { readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { TEAM_SLUGS } from "../lib/teams";

const SRC = path.join(process.cwd(), "bilder", "lag");
const OUT = path.join(process.cwd(), "public", "images", "lag");
const SIZES = [
  { suffix: "", width: 1600, quality: 72 },
  { suffix: "-640", width: 640, quality: 70 },
];
const slugs = new Set(Object.values(TEAM_SLUGS));

mkdirSync(SRC, { recursive: true });
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
if (files.length === 0) console.log(`Inga bilder i ${SRC}.`);

for (const file of files) {
  const slug = path.parse(file).name.toLowerCase();
  if (!slugs.has(slug)) {
    console.warn(`Hoppar över ${file}: okänt lag. Giltiga namn: ${[...slugs].join(", ")}`);
    continue;
  }
  const input = path.join(SRC, file);
  const { width = 0 } = await sharp(input).metadata();
  if (width < 1600) console.warn(`${file} är bara ${width} px bred (minst 1600 rekommenderas).`);
  for (const size of SIZES) {
    const out = path.join(OUT, `${slug}${size.suffix}.webp`);
    const info = await sharp(input)
      .rotate() // följ kamerans EXIF-orientering
      .resize({ width: size.width, withoutEnlargement: true })
      .webp({ quality: size.quality })
      .toFile(out);
    console.log(`${path.basename(out)}: ${info.width}×${info.height}, ${Math.round(info.size / 1024)} KB`);
  }
}
