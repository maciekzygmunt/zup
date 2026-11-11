const base62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
const lowercase = "0123456789abcdefghijklmnopqrstuvwxyz"

// Unbiased random string: bytes that would favor some characters are skipped.
function randomString(length: number, alphabet: string) {
  const limit = 256 - (256 % alphabet.length)
  let value = ""
  while (value.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && value.length < length) value += alphabet[byte % alphabet.length]
    }
  }
  return value
}

// Internal site id (~95 bits).
export const siteId = () => randomString(16, base62)

// Default slug (~103 bits), so URLs of public sites cannot be guessed.
export const randomSlug = () => randomString(20, lowercase)
