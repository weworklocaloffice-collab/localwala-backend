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

const Reel = require('../../../models/reel.model');
const ReelComment = require('../models/reel.comment.model');

const addComment = async (reelId, userId, text) => {
  const comment = await ReelComment.create({ reelId, userId, text: String(text).trim() });
  await Reel.updateOne({ _id: reelId }, { $inc: { comments: 1 } });
  return comment;
};

const listComments = async (reelId, { page = 1, limit = 10 } = {}) =>
  ReelComment.paginate(
    { reelId, status: 'VISIBLE' },
    {
      page: Number(page) || 1,
      limit: Math.min(Number(limit) || 10, 50),
      sortBy: 'createdAt:desc',
      populate: 'userId',
    }
  );

module.exports = {
  addComment,
  listComments,
};
