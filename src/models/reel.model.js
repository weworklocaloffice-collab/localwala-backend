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

const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const reelSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    videoUrl: {
      type: String,
      required: true,
    },
    thumbnail: {
      type: String,
    },
    description: {
      type: String,
    },
    hashtags: [
      {
        type: String,
      },
    ],
    musicTitle: {
      type: String,
    },
    likes: {
      type: Number,
      default: 0,
    },
    comments: {
      type: Number,
      default: 0,
    },
    saves: {
      type: Number,
      default: 0,
    },
    shares: {
      type: Number,
      default: 0,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    // Publishing lifecycle (docs §15). V1: admin-only creation; only PUBLISHED
    // (and due SCHEDULED) reels reach the customer feed. Legacy docs predate
    // this field — the feed treats a missing status as PUBLISHED (§8).
    status: {
      type: String,
      enum: [
        'DRAFT',
        'PROCESSING',
        'READY',
        'SCHEDULED',
        'PUBLISHED',
        'PAUSED',
        'REJECTED',
        'EXPIRED',
      ],
      default: 'DRAFT',
    },
    vertical: {
      type: String,
      enum: ['FOOD', 'DAIRY', 'SERVICES', 'REAL_ESTATE'],
    },
    target: {
      type: {
        type: String,
        enum: ['RESTAURANT', 'PRODUCT', 'SERVICE', 'VENDOR', 'PROPERTY'],
      },
      refId: {
        type: String,
      },
    },
    cta: {
      label: {
        type: String,
        trim: true,
      },
      overridden: {
        type: Boolean,
        default: false,
      },
    },
    cityId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
    },
    localityId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Locality',
    },
    media: {
      sourceKey: {
        type: String,
      },
      renditions: [
        {
          quality: { type: String },
          url: { type: String },
        },
      ],
      thumbnailUrl: {
        type: String,
      },
      thumbnailSource: {
        type: String,
        enum: ['AUTO', 'CUSTOM'],
        default: 'AUTO',
      },
      durationSec: {
        type: Number,
      },
    },
    processing: {
      stage: {
        type: String,
        enum: ['UPLOADING', 'COMPRESSING', 'PROCESSING', 'THUMBNAIL', 'READY', 'FAILED'],
      },
      error: {
        type: String,
      },
      progress: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
    },
    publishAt: {
      type: Date,
    },
    publishedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

reelSchema.plugin(toJSON);
reelSchema.plugin(paginate);

reelSchema.index({ status: 1, createdAt: -1 });
reelSchema.index({ vertical: 1, status: 1 });
reelSchema.index({ publishAt: 1 }, { sparse: true });

const Reel = mongoose.model('Reel', reelSchema);

module.exports = Reel;
