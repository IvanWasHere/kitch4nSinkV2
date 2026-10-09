import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import AuditLog from '#models/audit_log'
import SiteSetting from '#models/site_setting'
import { SettingsService } from '#settings/settings_service'

/**
 * Keys that exist only for this file. Core declares none of its own (plan
 * §22.3), so the suite brings its own — through the same augmentation a
 * feature uses, which is also what proves that augmentation types `get`.
 */
declare module '#settings/settings_service' {
  interface SiteSettings {
    test_flag: boolean
    test_limit: number
  }
}

test.group('SettingsService', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  function service() {
    return new SettingsService().define('test_flag', true).define('test_limit', 48)
  }

  test('an unset key reads as its default', async ({ assert }) => {
    assert.isTrue(await service().get('test_flag'))
    assert.equal(await service().get('test_limit'), 48)
    assert.equal(
      await SiteSetting.query()
        .count('* as total')
        .first()
        .then((r) => Number(r!.$extras.total)),
      0
    )
  })

  test('a stored value wins over the default, including a falsy one', async ({ assert }) => {
    const settings = service()

    await settings.set('test_flag', false)
    await settings.set('test_limit', 0)

    assert.isFalse(await settings.get('test_flag'))
    assert.equal(await settings.get('test_limit'), 0)
  })

  test('setting a key twice keeps one row', async ({ assert }) => {
    const settings = service()

    await settings.set('test_limit', 12)
    await settings.set('test_limit', 24)

    const rows = await SiteSetting.query().where('key', 'test_limit')
    assert.lengthOf(rows, 1)
    assert.equal(await settings.get('test_limit'), 24)
  })

  test('every change is audited with the value before and after', async ({ assert }) => {
    const settings = service()

    await settings.set('test_flag', false)
    await settings.set('test_flag', true)

    const entries = await AuditLog.query().where('action', 'settings.changed').orderBy('id', 'asc')

    assert.lengthOf(entries, 2)
    assert.deepEqual(entries[0].metadata, { key: 'test_flag', from: true, to: false })
    assert.deepEqual(entries[1].metadata, { key: 'test_flag', from: false, to: true })
    assert.equal(entries[0].actorType, 'system', 'no context means no staff member did it')
    assert.equal(entries[0].subjectId, 'test_flag')
  })

  test('reading a key nobody gave a default fails loudly', async ({ assert }) => {
    await assert.rejects(() => new SettingsService().get('test_flag'), /has no default/)
  })

  test('lists the declared keys in declaration order', ({ assert }) => {
    assert.deepEqual(service().defined(), ['test_flag', 'test_limit'])
  })
})
