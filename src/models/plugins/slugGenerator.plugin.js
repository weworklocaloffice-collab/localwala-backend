/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

function randomHex(bytes = 5) {
  let result = '';
  const hex = 'abcdef0123456789';

  for (let i = 0; i < bytes * 2; i++) {
    result += hex[Math.floor(Math.random() * hex.length)];
  }

  return result;
}

const slugGenerator = (schema) => {
  schema.pre('save', async function () {
    if (this.isNew) {
      const { source } = schema.tree.slug;

      const tempSlug = this[source]
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s/g, '-')
        .replace(/[&/\\#,+()$~%.‘’'":*?''`!<>{};=@^_|।[\]]/g, '-')
        .replace(/-+/g, '-');

      let slug;

      if (tempSlug.slice(-1) === '-' && tempSlug.charAt(0) === '-') {
        slug = tempSlug.slice(1, -1);
      } else if (tempSlug.slice(-1) === '-') {
        slug = tempSlug.substring(0, tempSlug.length - 1);
      } else if (tempSlug.charAt(0) === '-') {
        slug = tempSlug.slice(1);
      } else {
        slug = tempSlug;
      }

      try {
        const exists = await this.model(this.constructor.modelName).exists({ slug });

        slug = exists ? `${slug}-${randomHex(5)}` : slug;
      } catch (error) {}

      this.slug = slug;
    }
  });
};

module.exports = slugGenerator;

