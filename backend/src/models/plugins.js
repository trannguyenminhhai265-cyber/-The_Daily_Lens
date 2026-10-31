// Shared schema helpers: snake_case timestamps and a clean JSON shape with `id`.

const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' };

function toJSONPlugin(schema) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.password_hash;
      return ret;
    },
  });
}

module.exports = { timestamps, toJSONPlugin };
