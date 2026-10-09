---
title: Landing
nav_order: 13
---

# Landing

The public front of the product: the marketing page at `/`, and the privacy notice and terms of
service at `/privacy` and `/terms`. All three are written in code, not in the back office —
admin-authored pages are [Content](content.md)'s job.

This is a **removable module** — `app/modules/landing/`. Without it, `/` sends people inward: to
their workspace if they are signed in, to sign-in if they are not. [Removing it](#removing-it) is
a list of deletions.

---

## What it shows

**`/`** — a hero with a drawing of the dashboard, a "before and after", the numbers, the feature
cards, pricing read from `config/plans.ts` (so it cannot advertise a tier the product does not
have), a FAQ that opens without JavaScript, and a closing call to action. Every call to action on
the page follows the [registration gate](registration-control.md):

| Visitor | Call to action |
|---|---|
| Signed in | *Go to your workspace* |
| Registration open | *Start for free* and *Sign in* |
| Registration closed, waiting list available | *Join the waiting list* and *Sign in* |
| Registration closed, no waiting list | *Sign in* |

The public header follows the same rule on every marketing page (*Get started*, *Join the waiting
list*, or neither), through a core view helper, `registrationIsOpen()`. Landing asks core's gate,
never the Registration Control module, so either module can be removed without the other noticing.

**`/privacy` and `/terms`** — template copy that describes what this codebase actually stores and
which kinds of provider it shares data with, with the company-specific parts in `[brackets]`. Each
shows a *Template text* notice at the top.

{: .warning }
The legal pages are a starting structure, not legal advice. Replace the bracketed parts, have both
reviewed, and remove the notice before launch — they live in
`resources/views/pages/landing/privacy.edge` and `terms.edge`.

The footer of every marketing page links to both, and the signup form says that creating an
account accepts them. Both links look for the routes by name (`legal.privacy`, `legal.terms`) and
disappear with the module. A CMS page cannot take `/privacy` or `/terms`: Content reserves every
path a route already answers.

---

## How `/` changes hands

Every layout and error page links to the route named `home`, so a route by that name must exist
whether this module is installed or not. Core registers its own `/` in `start/routes.ts` — the
fallback, `HomeController`, which redirects inward — and hands it to the module:

```ts
export const home = router.get('/', [controllers.Home, 'index']).as('home')
registerLandingRoutes({ replacing: home })
```

`registerLandingRoutes` marks that route as deleted and registers its own `/` under the same name.
Remove the call and nothing replaces the fallback, so it is what answers. The constant is exported
only so it is not an unused variable once the call is gone.

`tests/functional/home.spec.ts` asserts the fallback's behaviour whenever no front page is
installed, and that `home` is always `/`.

---

## Where it lives

```
app/modules/landing/
  controllers/landing_controller.ts   home, privacy, terms
  routes.ts                           takes over /, adds the legal pages
  tests/functional/landing.spec.ts
```

The views are in `resources/views/pages/landing/` — `home.edge`, `privacy.edge`, `terms.edge`.

The home page's styles are `resources/css/landing.css`, a **separate Vite entry** listed in
`vite.config.ts` and pushed into the page head by `home.edge` alone, so no other page downloads
them. Every class is prefixed `lp-` and every colour is a design token — the page is the
application's blue. The legal pages need no CSS of their own: they use the generic `.prose` and
`.content-article` classes.

The floating pill header and the centred footer belong to the core marketing layout, not to this
module, so the blog and any other public page share them. Landing only adds its in-page links
(*Features*, *Pricing*, *FAQ*) through the layout's `nav` slot.

Landing adds no tables, jobs, settings or audit actions.

---

## Removing it

Checked by doing it: with the module removed as below, the suite passes — including the fallback
case in `home.spec.ts` — and `npm run typecheck` is clean.

**1. Delete the module and its views.**

```bash
rm -rf app/modules/landing resources/views/pages/landing
rm resources/css/landing.css docs/landing.md
```

and remove `'resources/css/landing.css'` from `entryPoints` in `vite.config.ts`.

**2. Unregister it.** In `start/routes.ts`, delete `registerLandingRoutes({ replacing: home })` and
its import. Leave the `home` line above it — that is the fallback.

**3. Update the modularity test**, if `start/routes.ts` no longer names any module. With Content
still installed it does, and there is nothing to change.

Nothing else needs an edit: the footer links, the signup form's terms line and the header's call
to action all stand down on their own.

**Check:**

```bash
npm run typecheck
npm run lint
node ace test
```
