import { BaseModel, beforeCreate } from '@adonisjs/lucid/orm'
import type { NormalizeConstructor } from '@adonisjs/core/types/helpers'

import { generatePublicId, type PublicIdResource } from '#models/public_id'

/**
 * Assigns a prefixed `public_id` before the row is inserted (D6).
 *
 * The column itself comes from the migration and is typed by the generated
 * schema class; this mixin only owns the value. Compose it into a model:
 *
 *   export default class TodoList extends compose(TodoListSchema, withPublicId('todoList')) {}
 *
 * An explicitly assigned `publicId` is respected, which is what lets a seeder
 * or a test fixture pin an id.
 */
export function withPublicId(resource: PublicIdResource) {
  return <Model extends NormalizeConstructor<typeof BaseModel>>(superclass: Model) => {
    class ModelWithPublicId extends superclass {
      /**
       * The resource this model's public ids belong to. Exposed so callers can
       * validate an incoming id against the model it is meant to address.
       */
      static publicIdResource: PublicIdResource = resource

      @beforeCreate()
      static assignPublicId(model: InstanceType<Model> & { publicId?: string | null }) {
        if (!model.publicId) {
          model.publicId = generatePublicId(resource)
        }
      }
    }

    return ModelWithPublicId
  }
}
