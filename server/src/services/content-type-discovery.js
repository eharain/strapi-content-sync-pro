'use strict';

const PRIMITIVE_TYPES = [
  'string', 'text', 'richtext', 'integer', 'biginteger',
  'float', 'decimal', 'boolean', 'date', 'datetime',
  'time', 'email', 'password', 'enumeration', 'uid', 'json',
];

module.exports = ({ strapi }) => ({
  /**
   * Return every user-defined collection type that is eligible for sync.
   * Excludes admin, upload, and users-permissions content types.
   */
  getSyncableContentTypes() {
    const result = [];

    for (const [uid, ct] of Object.entries(strapi.contentTypes)) {
      if (!uid.startsWith('api::')) continue;
      if (ct.kind !== 'collectionType') continue;

      const primitiveAttributes = {};
      for (const [name, attr] of Object.entries(ct.attributes || {})) {
        if (PRIMITIVE_TYPES.includes(attr.type)) {
          primitiveAttributes[name] = {
            type: attr.type,
            required: attr.required || false,
          };
        }
      }

      result.push({
        uid,
        kind: ct.kind,
        displayName: ct.info?.displayName || uid,
        attributes: primitiveAttributes,
      });
    }

    return result;
  },
});
