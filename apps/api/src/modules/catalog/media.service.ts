import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../config';

/**
 * Imágenes en disco local (carpeta uploads/, fuera de git). La base guarda la
 * ruta relativa en media.storage_key y la URL pública en media.url, igual que
 * guardaría el public_id de Cloudinary: cambiar de almacenamiento es cambiar esta clase.
 */
@Injectable()
export class MediaService {
  async saveImage(file: Express.Multer.File, folder: string) {
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException(`${file.originalname} no es una imagen`);
    }
    // se normaliza a WebP de 1600 px como máximo: liviano y nítido para vitrina
    const img = sharp(file.buffer, { failOn: 'none' }).rotate().resize({
      width: 1600,
      height: 1600,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const { data, info } = await img.webp({ quality: 85 }).toBuffer({ resolveWithObject: true });

    const storageKey = `${folder}/${randomUUID()}.webp`;
    const abs = path.join(config.uploadsDir, storageKey);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data);

    return {
      storageKey,
      url: `/uploads/${storageKey}`,
      mime: 'image/webp',
      width: info.width,
      height: info.height,
      bytes: data.length,
      originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
    };
  }

  async remove(storageKey: string) {
    // solo borra lo que está dentro de uploads/ (las rutas legacy no se tocan)
    const abs = path.resolve(config.uploadsDir, storageKey);
    if (!abs.startsWith(config.uploadsDir + path.sep)) return;
    await unlink(abs).catch(() => undefined);
  }
}
