import forge from "node-forge";

export function encrypt(text: string, encryptionKey: string): string {
  const iv = forge.random.getBytesSync(16);
  const key = forge.util.createBuffer(encryptionKey, "utf8").getBytes(32);

  const cipher = forge.cipher.createCipher("AES-CBC", key);
  cipher.start({ iv });
  cipher.update(forge.util.createBuffer(text, "utf8"));
  cipher.finish();

  const encrypted = cipher.output.getBytes();

  return forge.util.encode64(iv + encrypted);
}

export function decrypt(encryptedText: string, encryptionKey: string): string {
  const raw = forge.util.decode64(encryptedText);
  const iv = raw.substring(0, 16);
  const encrypted = raw.substring(16);
  const key = forge.util.createBuffer(encryptionKey, "utf8").getBytes(32);

  const decipher = forge.cipher.createDecipher("AES-CBC", key);
  decipher.start({ iv });
  decipher.update(forge.util.createBuffer(encrypted));
  const success = decipher.finish();

  if (!success) {
    throw new Error(
      "Decryption failed. Possibly due to invalid key or corrupted data.",
    );
  }

  const plainText = decipher.output.toString("utf8");
  return plainText.trim();
}
