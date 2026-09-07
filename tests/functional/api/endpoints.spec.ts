import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import Todo from '#models/todo'
import TodoList from '#models/todo_list'
import { decodeCursor } from '#api/cursor'
import { addMember, createApiWorkspace, createList } from '#tests/helpers'

/**
 * The endpoints themselves (plan §11, §15).
 */
test.group('API — lists', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('returns public ids and never internal ones', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch')

    const response = await client.get('/api/v1/lists').headers(headers)

    response.assertStatus(200)

    const [row] = response.body().data
    assert.equal(row.id, list.publicId)
    assert.match(row.id, /^lst_/)

    /**
     * The transformer's whole job: adding a column to the model must not
     * widen the public contract, and an integer id must never leave.
     */
    assert.notProperty(row, 'organization_id')
    assert.notProperty(row, 'created_by_user_id')
    assert.notProperty(row, 'deleted_at')
    assert.notInclude(JSON.stringify(row), `"${list.id}"`)
  })

  test('creates a list', async ({ client, assert }) => {
    const { organization, headers } = await createApiWorkspace()

    const response = await client
      .post('/api/v1/lists')
      .headers(headers)
      .json({ name: 'From the API', description: 'made by a robot', color: 'green' })

    response.assertStatus(201)
    response.assertBodyContains({ data: { name: 'From the API', color: 'green', todos_count: 0 } })

    const stored = await TodoList.findByOrFail('name', 'From the API')
    assert.equal(stored.organizationId, organization.id)
  })

  test('a duplicate name is a 422, not a 500', async ({ client }) => {
    const { user, organization, headers } = await createApiWorkspace()
    await createList(organization, user, 'Launch')

    const response = await client.post('/api/v1/lists').headers(headers).json({ name: 'Launch' })

    response.assertStatus(422)
    response.assertBodyContains({ error: { code: 'validation_failed' } })
  })

  test('an invalid body reports every failing field at once', async ({ client, assert }) => {
    const { headers } = await createApiWorkspace()

    const response = await client
      .post('/api/v1/lists')
      .headers(headers)
      .json({ name: '', color: 'chartreuse' })

    response.assertStatus(422)

    const details = response.body().error.details
    assert.isArray(details)
    assert.isAtLeast(details.length, 2, 'one round trip, every problem')
  })

  test('updates and archives in one call', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch')

    const response = await client
      .patch(`/api/v1/lists/${list.publicId}`)
      .headers(headers)
      .json({ name: 'Launched', archived: true })

    response.assertStatus(200)
    response.assertBodyContains({ data: { name: 'Launched', archived: true } })

    await list.refresh()
    assert.equal(list.name, 'Launched')
    assert.isNotNull(list.archivedAt)
  })

  /**
   * A client retrying after a timeout must not fail.
   */
  test('archiving an archived list is a success', async ({ client }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch')

    await client.patch(`/api/v1/lists/${list.publicId}`).headers(headers).json({ archived: true })
    const again = await client
      .patch(`/api/v1/lists/${list.publicId}`)
      .headers(headers)
      .json({ archived: true })

    again.assertStatus(200)
  })

  test('deleting takes the todos with it and answers 204', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch', ['One', 'Two'])

    const response = await client.delete(`/api/v1/lists/${list.publicId}`).headers(headers)

    response.assertStatus(204)

    await list.refresh()
    assert.isNotNull(list.deletedAt)

    const surviving = await Todo.query().where('todo_list_id', list.id).whereNull('deleted_at')
    assert.isEmpty(surviving)
  })

  /**
   * Archived lists are hidden by default — a client syncing active work
   * should not silently pick up things a customer put away.
   */
  test('archived lists are excluded unless asked for', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()

    const archived = await createList(organization, user, 'Old')
    await createList(organization, user, 'Current')

    const { default: lists } = await import('#todos/list_service')
    await lists.archive(archived)

    const live = await client.get('/api/v1/lists').headers(headers)
    assert.deepEqual(
      live.body().data.map((row: { name: string }) => row.name),
      ['Current']
    )

    const onlyArchived = await client.get('/api/v1/lists?archived=true').headers(headers)
    assert.deepEqual(
      onlyArchived.body().data.map((row: { name: string }) => row.name),
      ['Old']
    )

    const everything = await client.get('/api/v1/lists?archived=all').headers(headers)
    assert.lengthOf(everything.body().data, 2)
  })

  /**
   * A DateTime read back from the database renders as `…+00:00` while one
   * just created renders as `…Z`. Both are valid ISO 8601, but an API that
   * emits two formats for the same field breaks a client comparing strings
   * — so every timestamp goes out in one shape.
   */
  test('every timestamp is emitted in one format', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch')

    const created = await client
      .post(`/api/v1/lists/${list.publicId}/todos`)
      .headers(headers)
      .json({ title: 'Ship it', due_at: '2026-12-01T09:00:00Z' })

    const listed = await client.get(`/api/v1/lists/${list.publicId}/todos`).headers(headers)
    const [fromDatabase] = listed.body().data

    for (const row of [created.body().data, fromDatabase]) {
      for (const field of ['created_at', 'due_at']) {
        assert.match(
          row[field],
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
          `${field}: ${row[field]}`
        )
      }
    }
  })

  test('an unknown id is a 404 with a stable code', async ({ client }) => {
    const { headers } = await createApiWorkspace()

    const response = await client.get('/api/v1/lists/lst_zzzzzzzzzzzz').headers(headers)

    response.assertStatus(404)
    response.assertBodyContains({ error: { code: 'not_found' } })
  })
})

test.group('API — pagination', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('walks every row exactly once across pages', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()

    for (let index = 0; index < 7; index++) {
      await createList(organization, user, `List ${index}`)
    }

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0

    do {
      const url: string = `/api/v1/lists?limit=3${cursor ? `&cursor=${cursor}` : ''}`
      const response = await client.get(url).headers(headers)

      response.assertStatus(200)

      for (const row of response.body().data) {
        seen.push(row.id)
      }

      cursor = response.body().meta.next_cursor
      pages++
    } while (cursor && pages < 10)

    assert.lengthOf(seen, 7)
    assert.lengthOf(new Set(seen), 7, 'no duplicates')
    assert.isNull(cursor, 'and it terminated on its own')
  })

  /**
   * The reason for cursors: under offset pagination an insert between page
   * fetches shifts every row down, so a syncing client sees one twice and
   * misses another (plan §11).
   */
  test('a row inserted mid-walk cannot make the client skip or repeat one', async ({
    client,
    assert,
  }) => {
    const { user, organization, headers } = await createApiWorkspace()

    for (let index = 0; index < 4; index++) {
      await createList(organization, user, `List ${index}`)
    }

    const first = await client.get('/api/v1/lists?limit=2').headers(headers)
    const firstIds = first.body().data.map((row: { id: string }) => row.id)

    /**
     * Somebody adds a list between the two requests.
     */
    await createList(organization, user, 'Inserted')

    const second = await client
      .get(`/api/v1/lists?limit=2&cursor=${first.body().meta.next_cursor}`)
      .headers(headers)
    const secondIds = second.body().data.map((row: { id: string }) => row.id)

    assert.isEmpty(
      firstIds.filter((id: string) => secondIds.includes(id)),
      'no row appears on both pages'
    )
  })

  test('the page size is clamped rather than refused', async ({ client, assert }) => {
    const { headers } = await createApiWorkspace()

    const response = await client.get('/api/v1/lists?limit=100000').headers(headers)

    response.assertStatus(200)
    assert.equal(response.body().meta.limit, 100)
  })

  test('a nonsense cursor starts from the beginning instead of erroring', async ({
    client,
    assert,
  }) => {
    const { user, organization, headers } = await createApiWorkspace()
    await createList(organization, user, 'Only one')

    const response = await client.get('/api/v1/lists?cursor=%%%broken%%%').headers(headers)

    response.assertStatus(200)
    assert.lengthOf(response.body().data, 1)
  })

  test('the cursor is opaque', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()

    await createList(organization, user, 'One')
    await createList(organization, user, 'Two')

    const response = await client.get('/api/v1/lists?limit=1').headers(headers)
    const cursor = response.body().meta.next_cursor

    assert.isString(cursor)
    assert.isNumber(decodeCursor(cursor), 'ours to decode')
    assert.notMatch(cursor, /^\d+$/, 'not a bare id')
  })
})

test.group('API — todos', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('creates a todo inside a list', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch')

    const response = await client
      .post(`/api/v1/lists/${list.publicId}/todos`)
      .headers(headers)
      .json({ title: 'Ship it', priority: 'high', due_at: '2026-12-01T09:00:00.000Z' })

    response.assertStatus(201)
    response.assertBodyContains({
      data: {
        title: 'Ship it',
        priority: 'high',
        completed: false,
        list_id: list.publicId,
        due_at: '2026-12-01T09:00:00.000Z',
      },
    })

    await list.refresh()
    assert.equal(list.todosCount, 1, 'the denormalised counter moved with it')
  })

  /**
   * A due date guessed from an ambiguous string is a task that silently
   * becomes overdue in the wrong week.
   */
  test('an unparseable due date is a 422, not a silent null', async ({ client }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch')

    const response = await client
      .post(`/api/v1/lists/${list.publicId}/todos`)
      .headers(headers)
      .json({ title: 'When?', due_at: 'next tuesday' })

    response.assertStatus(422)
    response.assertTextIncludes('due_at')
  })

  test('assigns to a member by public id and round-trips it', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')
    const list = await createList(organization, user, 'Launch')

    const response = await client
      .post(`/api/v1/lists/${list.publicId}/todos`)
      .headers(headers)
      .json({ title: 'Sam does it', assigned_to: member.publicId })

    response.assertStatus(201)
    assert.equal(response.body().data.assigned_to, member.publicId)
  })

  /**
   * The obvious cross-tenant injection point (plan §5.6, §11).
   */
  test('an assignee from another workspace is a 422, never a silent null', async ({
    client,
    assert,
  }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch')

    const stranger = await createApiWorkspace()

    const response = await client
      .post(`/api/v1/lists/${list.publicId}/todos`)
      .headers(headers)
      .json({ title: 'Not yours', assigned_to: stranger.user.publicId })

    response.assertStatus(422)
    response.assertTextIncludes('assigned_to')

    assert.lengthOf(await Todo.all(), 0, 'and nothing was written')
  })

  test('completing records who and when, and is idempotent', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch', ['Ship it'])
    const [todo] = await list.related('todos').query()

    const first = await client.post(`/api/v1/todos/${todo.publicId}/complete`).headers(headers)

    first.assertStatus(200)
    first.assertBodyContains({ data: { completed: true } })

    await todo.refresh()
    const completedAt = todo.completedAt
    assert.isNotNull(completedAt)
    assert.isNotNull(todo.completedByUserId)

    const again = await client.post(`/api/v1/todos/${todo.publicId}/complete`).headers(headers)
    again.assertStatus(200)

    await todo.refresh()
    assert.equal(todo.completedAt?.toMillis(), completedAt?.toMillis(), 'unchanged')
  })

  test('un-completing clears both the timestamp and who did it', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch', ['Ship it'])
    const [todo] = await list.related('todos').query()

    await client.post(`/api/v1/todos/${todo.publicId}/complete`).headers(headers)
    await client.post(`/api/v1/todos/${todo.publicId}/uncomplete`).headers(headers)

    await todo.refresh()
    assert.isNull(todo.completedAt)
    assert.isNull(todo.completedByUserId)
  })

  test('filters by completion', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch', ['One', 'Two'])
    const [first] = await list.related('todos').query()

    await client.post(`/api/v1/todos/${first.publicId}/complete`).headers(headers)

    const done = await client
      .get(`/api/v1/lists/${list.publicId}/todos?completed=true`)
      .headers(headers)
    const open = await client
      .get(`/api/v1/lists/${list.publicId}/todos?completed=false`)
      .headers(headers)

    assert.lengthOf(done.body().data, 1)
    assert.lengthOf(open.body().data, 1)
  })

  /**
   * A filter is not a write, so a stale member id matches nothing rather
   * than breaking a client whose cached directory is out of date.
   */
  test('filtering by an unknown assignee matches nothing rather than erroring', async ({
    client,
    assert,
  }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch', ['One'])

    const response = await client
      .get(`/api/v1/lists/${list.publicId}/todos?assigned_to=usr_zzzzzzzzzzzz`)
      .headers(headers)

    response.assertStatus(200)
    assert.isEmpty(response.body().data)
  })

  test('deleting frees a slot against the per-list cap', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    const list = await createList(organization, user, 'Launch', ['One'])
    const [todo] = await list.related('todos').query()

    const response = await client.delete(`/api/v1/todos/${todo.publicId}`).headers(headers)

    response.assertStatus(204)

    await list.refresh()
    assert.equal(list.todosCount, 0)
  })
})

/**
 * The one genuinely unusual API behaviour, and the reason `GET /organization`
 * exists (plan §7.4, §11).
 */
test.group('API — plan limits', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a create at the cap is a 402 carrying the numbers and an upgrade url', async ({
    client,
    assert,
  }) => {
    const { organization, headers } = await createApiWorkspace()

    organization.limitOverrides = { lists: 1 }
    await organization.save()

    await client.post('/api/v1/lists').headers(headers).json({ name: 'One' })

    const response = await client.post('/api/v1/lists').headers(headers).json({ name: 'Two' })

    response.assertStatus(402)
    response.assertBodyContains({
      error: {
        code: 'plan_limit_exceeded',
        details: { limit: 'lists', allowed: 1, current: 1 },
      },
    })

    assert.isString(response.body().error.details.upgrade_url)
  })

  test('the per-list todo cap is a 402 too', async ({ client }) => {
    const { user, organization, headers } = await createApiWorkspace()

    organization.limitOverrides = { todosPerList: 1 }
    await organization.save()

    const list = await createList(organization, user, 'Launch', ['One'])

    const response = await client
      .post(`/api/v1/lists/${list.publicId}/todos`)
      .headers(headers)
      .json({ title: 'Two' })

    response.assertStatus(402)
    response.assertBodyContains({ error: { details: { limit: 'todosPerList' } } })
  })

  /**
   * The bulk-import contract: size the batch from `remaining`, and treat a
   * mid-batch 402 as a stop signal.
   */
  test('GET /organization reports the headroom that the 402 will enforce', async ({
    client,
    assert,
  }) => {
    const { organization, headers } = await createApiWorkspace()

    organization.limitOverrides = { lists: 3 }
    await organization.save()

    await client.post('/api/v1/lists').headers(headers).json({ name: 'One' })

    const before = await client.get('/api/v1/organization').headers(headers)
    const remaining = before.body().data.usage.lists.remaining

    assert.equal(remaining, 2)

    for (let index = 0; index < remaining; index++) {
      const created = await client
        .post('/api/v1/lists')
        .headers(headers)
        .json({ name: `Batch ${index}` })

      created.assertStatus(201)
    }

    const oneTooMany = await client.post('/api/v1/lists').headers(headers).json({ name: 'Over' })
    oneTooMany.assertStatus(402)

    const after = await client.get('/api/v1/organization').headers(headers)
    assert.equal(after.body().data.usage.lists.remaining, 0)
  })

  test('unlimited is reported as null, not as a large number', async ({ client, assert }) => {
    const { organization, headers } = await createApiWorkspace({ planKey: 'business' })

    const response = await client.get('/api/v1/organization').headers(headers)

    assert.isNull(response.body().data.usage.lists.limit)
    assert.isNull(response.body().data.usage.lists.remaining)
    void organization
  })
})

test.group('API — members', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('lists members with just enough to resolve an assignee', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()
    await addMember(organization, user, 'sam@example.com')

    const response = await client.get('/api/v1/members').headers(headers)

    response.assertStatus(200)
    assert.lengthOf(response.body().data, 2)

    const [row] = response.body().data
    assert.deepEqual(Object.keys(row).sort(), ['email', 'id', 'name', 'role'])

    /**
     * Nothing about the person beyond what an assignment needs.
     */
    assert.notProperty(row, 'two_factor_secret')
    assert.notProperty(row, 'last_login_at')
    assert.notProperty(row, 'avatar_key')
  })
})

/**
 * Not a test of the spec's prose, but of the promises it makes: if a
 * documented path or status disappears, somebody's generated client breaks.
 */
test.group('API — the published document', () => {
  test('documents every route the API actually exposes', async ({ client, assert }) => {
    const response = await client.get('/openapi.json')

    response.assertStatus(200)

    const document = response.body()
    const documented = Object.keys(document.paths)

    for (const path of [
      '/organization',
      '/members',
      '/lists',
      '/lists/{id}',
      '/lists/{id}/todos',
      '/todos/{id}',
      '/todos/{id}/complete',
    ]) {
      assert.include(documented, path, path)
    }
  })

  test('says loudly that a 402 is not retryable', async ({ client, assert }) => {
    const response = await client.get('/openapi.json')
    const document = response.body()

    assert.include(document.info.description, 'stop signal')
    assert.include(document.paths['/lists'].post.responses['402'].description, 'stop signal')
  })

  test('is readable without a key, because that is when people read it', async ({ client }) => {
    const response = await client.get('/docs')

    response.assertStatus(200)
  })

  test('describes the cursor contract a sync depends on', async ({ client, assert }) => {
    const response = await client.get('/openapi.json')
    const document = response.body()

    const meta =
      document.paths['/lists'].get.responses['200'].content['application/json'].schema.properties
        .meta

    assert.include(meta.properties.next_cursor.description, 'null on the last page')
  })
})
