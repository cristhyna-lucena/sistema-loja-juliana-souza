import sharp, { type Sharp } from "sharp";
import decode from "heic-decode";
import { createHash } from "node:crypto";
import { MAX_PHOTO_PIXELS, MAX_PHOTO_BYTES, type PhotoVariant } from "@sistema/shared";
import { PhotoValidationError } from "./storage";
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 20 });
type RawImage = { width: number; height: number; data: Uint8ClampedArray };
type HeicImages = { width: number; height: number; decode(): Promise<RawImage> }[] & { dispose(): void };
function isHeic(buffer: Buffer) { return buffer.toString("ascii", 4, 8) === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(buffer.toString("ascii", 8, 12)); }
export async function processImage(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) throw new PhotoValidationError("A imagem deve ter até 15 MB.");
  let base: Sharp; let width: number; let height: number;
  try {
    if (isHeic(buffer)) {
      const images = await (decode as unknown as { all(args: { buffer: Buffer }): Promise<HeicImages> }).all({ buffer });
      try {
        const image = images[0];
        if (!image || !image.width || !image.height || image.width * image.height > MAX_PHOTO_PIXELS) throw new PhotoValidationError("A imagem deve ter até 40 megapixels.");
        const raw = await image.decode(); width = raw.width; height = raw.height;
        base = sharp(Buffer.from(raw.data), { raw: { width, height, channels: 4 }, limitInputPixels: MAX_PHOTO_PIXELS });
      } finally { images.dispose(); }
    } else {
      const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
      const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const webp = buffer.toString("ascii",0,4) === "RIFF" && buffer.toString("ascii",8,12) === "WEBP";
      if (!jpeg && !png && !webp) throw new PhotoValidationError("Arquivo inválido. Use JPG, PNG, WebP ou HEIC.");
      base = sharp(buffer, { limitInputPixels: MAX_PHOTO_PIXELS, failOn: "warning" });
      const meta = await base.metadata();
      if (!meta.width || !meta.height || meta.width * meta.height > MAX_PHOTO_PIXELS) throw new PhotoValidationError("A imagem deve ter até 40 megapixels.");
      if ((meta.pages ?? 1) > 1) throw new PhotoValidationError("Use uma foto estática, sem animação.");
      const swap = (meta.orientation ?? 1) >= 5;
      width = swap ? meta.height : meta.width; height = swap ? meta.width : meta.height;
      base = base.rotate();
    }
    base = base.toColourspace("srgb").flatten({ background: "#ffffff" });
    const files: { variant: PhotoVariant; width: number; mime: string; buffer: Buffer }[] = [];
    for (const [name, size] of [["thumb",160], ["card",480], ["produto",1024], ["zoom",2048]] as const) {
      const canvas = base.clone().resize(size, size, { fit: "contain", background: "#ffffff" });
      files.push({ variant: `${name}.webp`, width: size, mime: "image/webp", buffer: await canvas.clone().webp({ quality: 78 }).toBuffer() });
      files.push({ variant: `${name}.avif`, width: size, mime: "image/avif", buffer: await canvas.clone().avif({ quality: 50, effort: 3 }).toBuffer() });
    }
    files.push({ variant: "social.jpg", width: 1024, mime: "image/jpeg", buffer: await base.clone().resize(1024,1024,{fit:"contain",background:"#ffffff"}).jpeg({quality:85}).toBuffer() });
    const blur = await base.clone().resize(16,16,{fit:"contain",background:"#ffffff"}).jpeg({quality:40}).toBuffer();
    return { hash: createHash("sha256").update(buffer).digest("hex"), width, height, blurDataUrl: "data:image/jpeg;base64," + blur.toString("base64"), files };
  } catch (error) {
    if (error instanceof PhotoValidationError) throw error;
    if (error instanceof Error && /pixel limit|image exceeds|too large/i.test(error.message)) throw new PhotoValidationError("A imagem deve ter até 40 megapixels.");
    throw new PhotoValidationError("Não foi possível ler a imagem. Envie uma foto válida em JPG, PNG, WebP ou HEIC.");
  }
}
