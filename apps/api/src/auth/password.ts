import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// promisify() pierde la sobrecarga con opciones, así que se envuelve a mano
const scrypt = (secret: string, salt: Buffer, keyLen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(secret, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

// scrypt viene en Node: no hace falta bcrypt ni argon2, que en Windows arrastran
// compilación nativa. Los parámetros son los recomendados por el RFC 7914 para
// uso interactivo; van guardados en el hash para poder subirlos sin invalidar
// las contraseñas que ya existen.
const N = 16384; // costo de CPU/memoria
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/** Devuelve `scrypt$N$r$p$salt_b64$hash_b64`. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(plain, salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Compara en tiempo constante. Nunca lanza por un hash con formato raro: un
 * registro corrupto es una contraseña que no coincide, no un 500.
 */
export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
