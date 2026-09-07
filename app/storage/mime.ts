import { open } from 'node:fs/promises'

import type { AllowedExtension } from '#storage/keys'

/**
 * What a file actually *is*, decided from its first bytes (plan §10).
 *
 * The browser's `Content-Type` is a claim by whoever made the request, so it
 * is never the basis of a decision here. A `.png` that is really an HTML
 * document is the classic stored-XSS upload, and the extension alone cannot
 * tell you.
 *
 * This is a deliberately small sniffer rather than a dependency: the
 * allowlist is eight extensions, six of which have a fixed magic number, and
 * a table we can read is worth more than a library we cannot.
 */
interface Signature {
  mimeType: string
  extensions: AllowedExtension[]

  /**
   * Bytes that must appear at `offset`. `null` in the pattern means "any
   * byte", which is what WebP's four-byte length field needs.
   */
  offset: number
  pattern: (number | null)[]
}

const SIGNATURES: Signature[] = [
  {
    mimeType: 'image/png',
    extensions: ['png'],
    offset: 0,
    pattern: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    mimeType: 'image/jpeg',
    extensions: ['jpg', 'jpeg'],
    offset: 0,
    pattern: [0xff, 0xd8, 0xff],
  },
  {
    mimeType: 'image/gif',
    extensions: ['gif'],
    offset: 0,
    pattern: [0x47, 0x49, 0x46, 0x38],
  },
  {
    /**
     * `RIFF????WEBP` — the four bytes between are the file length.
     */
    mimeType: 'image/webp',
    extensions: ['webp'],
    offset: 0,
    pattern: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  },
  {
    mimeType: 'application/pdf',
    extensions: ['pdf'],
    offset: 0,
    pattern: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
]

/**
 * Text has no magic number, so it is proved by what it does *not* contain.
 */
const TEXT_EXTENSIONS: AllowedExtension[] = ['txt', 'csv']

export interface SniffResult {
  mimeType: string

  /**
   * Whether the bytes agree with the extension the file will be stored under.
   * A mismatch is a refusal, not a correction — silently renaming a file to
   * match its content is how an executable ends up served as an image.
   */
  matchesExtension: boolean
}

/**
 * How many bytes are enough to decide. The longest signature is twelve; the
 * rest of the window is for the text heuristic.
 */
const WINDOW = 4096

export async function sniffFile(
  path: string,
  extension: AllowedExtension
): Promise<SniffResult | null> {
  const handle = await open(path, 'r')

  try {
    const buffer = Buffer.alloc(WINDOW)
    const { bytesRead } = await handle.read(buffer, 0, WINDOW, 0)

    return sniffBuffer(buffer.subarray(0, bytesRead), extension)
  } finally {
    await handle.close()
  }
}

export function sniffBuffer(bytes: Buffer, extension: AllowedExtension): SniffResult | null {
  for (const signature of SIGNATURES) {
    if (matches(bytes, signature)) {
      return {
        mimeType: signature.mimeType,
        matchesExtension: signature.extensions.includes(extension),
      }
    }
  }

  /**
   * No signature matched. That is only acceptable for the text formats, and
   * only when the bytes really are text: a NUL byte means binary, and binary
   * with no recognised header is exactly the thing we are refusing.
   */
  if (TEXT_EXTENSIONS.includes(extension) && looksLikeText(bytes)) {
    return {
      mimeType: extension === 'csv' ? 'text/csv' : 'text/plain',
      matchesExtension: true,
    }
  }

  return null
}

function matches(bytes: Buffer, signature: Signature): boolean {
  if (bytes.length < signature.offset + signature.pattern.length) {
    return false
  }

  return signature.pattern.every(
    (byte, index) => byte === null || bytes[signature.offset + index] === byte
  )
}

/**
 * An empty file is text as far as this is concerned — it carries nothing, and
 * the size check is what rejects it if that matters.
 */
function looksLikeText(bytes: Buffer): boolean {
  for (const byte of bytes) {
    if (byte === 0x00) {
      return false
    }
  }

  /**
   * A leading `<` is refused even in a `.txt`: served back with a sniffing
   * browser and a wrong content type, an HTML document is a stored XSS
   * regardless of the extension it arrived under.
   */
  const head = bytes.subarray(0, 64).toString('utf8').trimStart().toLowerCase()

  return !head.startsWith('<')
}
