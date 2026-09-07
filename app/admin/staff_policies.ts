/*
|--------------------------------------------------------------------------
| Staff policy registry
|--------------------------------------------------------------------------
|
| Its own registry, separate from `#generated/policies`, for the reason
| `InitializeBouncerMiddleware` gives: tenant policies take a `User` and
| staff policies take a `StaffUser`, and one Bouncer cannot be typed against
| both without one of them silently dropping out of the action list.
|
| Two guards, two tables, two registries (D5). `StaffAuthMiddleware` builds
| `ctx.staffBouncer` from this one.
|
| It also lives outside `app/policies/` on purpose: that directory is scanned
| to build `#generated/policies`, and a `StaffUser` policy appearing in the
| tenant registry makes the whole map incompatible with a `User` actor — at
| which point *every* tenant policy silently drops out of the type-level
| action list and `bouncer.with('TodoPolicy')` stops compiling.
|
*/

export const staffPolicies = {
  StaffPolicy: () => import('#admin/staff_policy'),
}
