/*
|--------------------------------------------------------------------------
| Bouncer abilities
|--------------------------------------------------------------------------
|
| Authorisation lives in policies (D7): one class per resource, every method
| taking the actor explicitly so an API-key actor or an impersonating staff
| member goes through the same check as a signed-in user.
|
| Standalone abilities are for the rare rule that belongs to no resource.
| There are none yet.
|
*/

export {}
