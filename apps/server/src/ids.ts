const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

// 16 base62 characters (~95 bits), so URLs of public sites cannot be guessed.
export function deploymentId(): string {
  let id = ""
  while (id.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      // Bytes >= 248 are skipped so every character is equally likely.
      if (byte < 248 && id.length < 16) id += alphabet[byte % 62]
    }
  }
  return id
}
