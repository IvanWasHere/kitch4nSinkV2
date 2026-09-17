import type User from '#models/user'
import type Organization from '#models/organization'
import type { DemoSeeder } from '#seeding/demo_seeders'

/**
 * The demo domain's share of `node ace dev:seed` (plan §12).
 *
 * Registered in `start/seeders.ts`, which hands it the workspaces core has
 * already built. It lives here rather than inside the command so that
 * removing this module takes its demo data with it, instead of leaving a
 * rewrite behind (docs/modules.md).
 */
class ListsDemoSeeder {
  /**
   * Acme's lists, sized against the overridden todo cap so the meters have
   * something to say: one comfortable, one amber, one full. A full list is
   * not a broken one — everything in it still works, only *adding* is blocked
   * (plan §7.4) — and that is hard to believe until you see it.
   */
  async seedFreeWorkspace(organization: Organization, owner: User, member: User) {
    const { DateTime } = await import('luxon')

    /*
     * The filler goes in first so it is the *oldest* work here. The dashboard
     * lists the newest todos, and a column of "Client request 11" tells
     * whoever opens it nothing at all.
     */
    const punch = await this.makeList(organization, owner, {
      name: 'Launch punch list',
      description: 'Everything between here and the announcement.',
      color: 'orange',
    })

    await this.makeFill(organization, punch, owner, 11, 'Punch list item')

    const requests = await this.makeList(organization, owner, {
      name: 'Client requests',
      description: 'Full — the plan allows twelve here, and there are twelve.',
      color: 'red',
    })

    await this.makeFill(organization, requests, member, 12, 'Client request')

    const weekly = await this.makeList(organization, owner, {
      name: 'Weekly ops',
      description: 'The recurring run — someone ticks these off every Monday.',
      color: 'blue',
    })

    await this.makeTodo(organization, weekly, owner, {
      title: 'Check the queue for anything stuck overnight',
      priority: 'high',
      dueAt: DateTime.utc().plus({ days: 1 }),
      assignee: member,
    })
    await this.makeTodo(organization, weekly, owner, {
      title: 'Reply to anything sitting in support over a day',
      dueAt: DateTime.utc().plus({ days: 2 }),
    })
    await this.makeTodo(organization, weekly, member, {
      title: 'Post the weekly numbers',
      notes: 'Signups, churn and anything that moved more than ten percent.',
    })
    await this.makeComplete(organization, weekly, owner, 'Rotate the staging database')
  }

  /**
   * The working week of the workspace the demo is toured in. Five lists,
   * todos in every state a todo has — overdue, due soon, assigned, done —
   * and one archived list, because archiving hides a list without freeing
   * its slot (plan §5.6).
   */
  async seedProWorkspace(organization: Organization, owner: User, priya: User, tomas: User) {
    const { DateTime } = await import('luxon')
    const { default: lists } = await import('#modules/lists/services/list_service')

    const launch = await this.makeList(organization, owner, {
      name: 'Launch checklist',
      description: 'Everything that has to be true before we tell anyone.',
      color: 'blue',
    })

    /* Overdue by two days: the dashboard counts it, and the row goes red. */
    await this.makeTodo(organization, launch, owner, {
      title: 'Rotate the webhook signing secret',
      notes: 'The one in the provider dashboard, not the one in .env.',
      priority: 'high',
      dueAt: DateTime.utc().minus({ days: 2 }),
      assignee: priya,
    })
    await this.makeTodo(organization, launch, owner, {
      title: 'Point the status page at the new host',
      priority: 'high',
      dueAt: DateTime.utc().plus({ days: 1 }),
      assignee: tomas,
    })
    await this.makeTodo(organization, launch, owner, {
      title: 'Write the deployment guide',
      dueAt: DateTime.utc().plus({ days: 4 }),
    })
    await this.makeTodo(organization, launch, priya, {
      title: 'Verify the sending domain',
      priority: 'low',
    })
    await this.makeComplete(organization, launch, owner, 'Move the demo data off the live database')
    await this.makeComplete(
      organization,
      launch,
      priya,
      'Take a backup and restore it somewhere else'
    )

    const triage = await this.makeList(organization, owner, {
      name: 'Bug triage',
      description: 'Reported this week, worst first.',
      color: 'red',
    })

    await this.makeTodo(organization, triage, priya, {
      title: 'Uploads over 10 MB time out on slow connections',
      priority: 'high',
      dueAt: DateTime.utc().plus({ days: 2 }),
      assignee: priya,
    })
    await this.makeTodo(organization, triage, tomas, {
      title: 'Invitation email renders wide in Outlook',
      priority: 'low',
      assignee: tomas,
    })
    await this.makeTodo(organization, triage, owner, {
      title: 'Sorting by due date puts empty dates first',
    })
    await this.makeComplete(organization, triage, priya, 'Two-factor codes rejected a second early')

    const calendar = await this.makeList(organization, owner, {
      name: 'Content calendar',
      description: 'What goes out, and when.',
      color: 'green',
    })

    await this.makeTodo(organization, calendar, tomas, {
      title: 'Draft the launch post',
      dueAt: DateTime.utc().plus({ days: 6 }),
      assignee: tomas,
    })
    await this.makeTodo(organization, calendar, tomas, {
      title: 'Three screenshots for the changelog',
      dueAt: DateTime.utc().plus({ days: 9 }),
    })

    const design = await this.makeList(organization, owner, {
      name: 'Design system',
      description: 'Tokens, components, and the things that disagree with them.',
      color: 'purple',
    })

    await this.makeTodo(organization, design, tomas, {
      title: 'Audit the empty states',
      assignee: tomas,
    })
    await this.makeTodo(organization, design, tomas, { title: 'One focus ring, everywhere' })

    /* Archived, not deleted: it still counts against the cap (plan §5.6). */
    const retro = await this.makeList(organization, owner, {
      name: 'Q2 retro actions',
      description: 'Closed out — kept so the next retro can read it.',
      color: 'gray',
    })
    await this.makeComplete(organization, retro, owner, 'Write the incident review')
    await this.makeComplete(organization, retro, priya, 'Alert on queue depth, not just failures')
    await lists.archive(retro)
  }

  private async makeList(
    organization: Organization,
    actor: User,
    data: { name: string; description?: string; color?: string }
  ) {
    const { default: lists } = await import('#modules/lists/services/list_service')

    return lists.create(organization, actor, data as never)
  }

  private async makeTodo(
    organization: Organization,
    list: Awaited<ReturnType<ListsDemoSeeder['makeList']>>,
    actor: User,
    data: {
      title: string
      notes?: string
      priority?: 'low' | 'normal' | 'high'
      dueAt?: import('luxon').DateTime
      assignee?: User
    }
  ) {
    const { default: todos } = await import('#modules/lists/services/todo_service')

    return todos.create(organization, list, actor, {
      title: data.title,
      notes: data.notes ?? null,
      priority: data.priority ?? 'normal',
      dueAt: data.dueAt ?? null,
      assignedToPublicId: data.assignee?.publicId ?? null,
    })
  }

  /**
   * A todo that is already done, so "recently finished" is not an empty box
   * on a workspace that has clearly been working.
   */
  private async makeComplete(
    organization: Organization,
    list: Awaited<ReturnType<ListsDemoSeeder['makeList']>>,
    actor: User,
    title: string
  ) {
    const { default: todos } = await import('#modules/lists/services/todo_service')

    const todo = await this.makeTodo(organization, list, actor, { title })
    await todos.complete(todo, actor)

    return todo
  }

  /**
   * Filler, for a list whose point is how full it is rather than what is in
   * it. Numbered so nobody mistakes it for real work.
   */
  private async makeFill(
    organization: Organization,
    list: Awaited<ReturnType<ListsDemoSeeder['makeList']>>,
    actor: User,
    count: number,
    prefix: string
  ) {
    for (let index = 1; index <= count; index++) {
      await this.makeTodo(organization, list, actor, { title: `${prefix} ${index}` })
    }
  }
}

const seeder = new ListsDemoSeeder()

/**
 * `todosPerList` is dropped to 12 on the free workspace on purpose. Twelve is
 * small enough that a list can be *seen* filling up — the count pill turning
 * amber and then red is the whole point of the meter, and it is invisible
 * against the plan's own 50.
 */
export const listsDemoSeeder: DemoSeeder = {
  key: 'lists',

  overrides: {
    free: { todosPerList: 12 },
  },

  async seed({ free, pro }) {
    await seeder.seedFreeWorkspace(free.organization, free.owner, free.members[0])
    await seeder.seedProWorkspace(pro.organization, pro.owner, pro.members[0], pro.members[1])
  },
}
