import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { DateTime } from 'luxon'
import yazl from 'yazl'

import env from '#start/env'
import type User from '#models/user'
import privacy from '#privacy/registry'
import storage from '#storage/disk_storage'

export interface BuiltExport {
  path: string
  /**
   * `data.json` again, on its own — what the back office shows an admin for
   * an export they generated, without opening the archive.
   */
  dataPath: string
  sizeBytes: number
  cleanup: () => Promise<void>
}

/**
 * Builds a person's data export as a zip (plan §22.8.1):
 *
 *   data.json   — one section per registered contributor
 *   README.txt  — what each section is, and what was left out and why
 *   files/      — the files they uploaded
 *
 * Knows nothing about any table. Every section comes from `#privacy/registry`,
 * so a feature that stores something about a person is in the export by
 * registering, and out of it by being removed.
 *
 * Written to a temporary file, not held in memory: an export with a few
 * hundred megabytes of uploads must not need a few hundred megabytes of heap.
 */
export async function buildExport(user: User, reference: string): Promise<BuiltExport> {
  const directory = await mkdtemp(join(tmpdir(), 'privacy-export-'))
  const path = join(directory, `${reference}.zip`)
  const dataPath = join(directory, `${reference}.json`)
  const cleanup = () => rm(directory, { recursive: true, force: true })

  try {
    const zip = new yazl.ZipFile()
    const data: Record<string, unknown> = {}
    const included: { key: string; describes: string; excludes?: string }[] = []
    const missing: string[] = []

    for (const contributor of privacy.all()) {
      const section = await contributor.export(user)

      if (section !== null && section !== undefined) {
        data[contributor.key] = section
        included.push(contributor)
      } else if (contributor.excludes) {
        included.push(contributor)
      }

      for (const file of (await contributor.files?.(user)) ?? []) {
        /**
         * A row whose object is gone is reported in the README rather than
         * failing the whole export — the person still gets everything else,
         * and is told exactly what could not be included.
         */
        if (!(await storage.exists({ disk: file.disk, key: file.key }))) {
          missing.push(file.path)
          continue
        }

        /**
         * Lazily, so a person with a thousand uploads does not hold a
         * thousand open streams at once.
         */
        zip.addReadStreamLazy(`files/${file.path}`, (callback) => {
          storage
            .stream({ disk: file.disk, key: file.key })
            .then((stream) => callback(null, stream))
            .catch((error) => callback(error, undefined as unknown as NodeJS.ReadableStream))
        })
      }
    }

    const exportedAt = DateTime.utc().toISO()

    const json = Buffer.from(
      JSON.stringify(
        { application: env.get('APP_NAME', 'Acme'), exportedAt, reference, data },
        null,
        2
      )
    )

    zip.addBuffer(json, 'data.json')
    await writeFile(dataPath, json)
    zip.addBuffer(Buffer.from(readme(exportedAt!, reference, included, missing)), 'README.txt')
    zip.end()

    await pipeline(zip.outputStream, createWriteStream(path))

    const { size } = await stat(path)

    return { path, dataPath, sizeBytes: size, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

function readme(
  exportedAt: string,
  reference: string,
  sections: { key: string; describes: string; excludes?: string }[],
  missing: string[]
) {
  const appName = env.get('APP_NAME', 'Acme')

  const lines = [
    `Your ${appName} data`,
    '',
    `Exported ${exportedAt} (UTC). Reference ${reference}.`,
    '',
    'data.json holds everything below, as JSON. The files you uploaded are in the files/ folder;',
    'each entry under "files" in data.json says which one it is.',
    '',
    'What is in it',
    '-------------',
    '',
  ]

  for (const section of sections) {
    lines.push(`${section.key}`, `  ${section.describes}`)

    if (section.excludes) {
      lines.push(`  Not included: ${section.excludes}`)
    }

    lines.push('')
  }

  if (missing.length) {
    lines.push(
      'Files that could not be included',
      '--------------------------------',
      '',
      'These are listed in data.json but their contents could not be read when the export was',
      'made. Contact support with the reference above and we will look into it.',
      '',
      ...missing.map((name) => `  ${name}`),
      ''
    )
  }

  lines.push(
    'What is never included',
    '----------------------',
    '',
    "Other people's personal data, and anything that works as a credential: passwords,",
    'two-factor secrets, recovery codes, API keys and sign-in tokens.',
    ''
  )

  return lines.join('\n')
}
