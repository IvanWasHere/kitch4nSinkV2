import { DateTime } from 'luxon'
import { type BaseModel } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { NormalizeConstructor } from '@adonisjs/core/types/helpers'

/**
 * Soft deletion.
 *
 * Deleting a row a customer can see is never destructive: a lapsed card, a
 * mis-clicked delete or a departing colleague must not destroy shared work
 * (D9, plan §5.6). Rows are stamped with `deleted_at` and disappear from the
 * application's queries; the purge job is what eventually removes them.
 *
 * The mixin deliberately does *not* make deleted rows invisible globally.
 * A global query scope that silently rewrites every query is the kind of
 * magic that hides bugs — instead `notDeleted()` is explicit, and the admin
 * panel, which must see deleted rows, simply does not call it.
 */
export function withSoftDelete<Model extends NormalizeConstructor<typeof BaseModel>>(
  superclass: Model
) {
  class ModelWithSoftDelete extends superclass {
    /**
     * Restrict a query to rows that have not been soft-deleted.
     */
    static notDeleted<Builder extends ModelQueryBuilderContract<any, any>>(query: Builder) {
      return query.whereNull('deleted_at')
    }

    get isDeleted(): boolean {
      return (this as unknown as { deletedAt: DateTime | null }).deletedAt !== null
    }

    /**
     * Stamp the row as deleted. Named `softDelete` rather than overriding
     * `delete()` so a genuine hard delete stays available and obvious.
     */
    async softDelete(this: InstanceType<Model> & { deletedAt: DateTime | null }) {
      this.deletedAt = DateTime.utc()
      await this.save()
    }

    async restore(this: InstanceType<Model> & { deletedAt: DateTime | null }) {
      this.deletedAt = null
      await this.save()
    }
  }

  return ModelWithSoftDelete
}
