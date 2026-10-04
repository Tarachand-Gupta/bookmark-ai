import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-GCM binds an encrypted credential to its immutable canonical account. */
export class CredentialCipher {
  private readonly key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32 || this.key.toString('base64') !== base64Key) {
      throw new Error('MASTER_CREDENTIAL_ENCRYPTION_KEY must be canonical base64 of 32 bytes');
    }
  }
  encrypt(token: string, accountId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(accountId));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
  }
  decrypt(value: string, accountId: string): string {
    const [version, iv, tag, body, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || body === undefined || extra !== undefined) throw new Error('Invalid encrypted tenant credential');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(accountId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }
}
