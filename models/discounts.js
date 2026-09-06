import mongoose from 'mongoose'

export const DEFAULT_CUSTOMER_TIERS = Object.freeze([
  Object.freeze({ tier: 'BRONZE', discount: 0, threshold: 0 }),
  Object.freeze({ tier: 'SILVER', discount: 0, threshold: 0 }),
  Object.freeze({ tier: 'GOLD', discount: 0, threshold: 0 }),
])

function nonNegativeNumber(defaultValue = 0) {
  return {
    type: Number,
    min: 0,
    max: 100,
    default: defaultValue,
  }
}

const categoryDiscountSchema = new mongoose.Schema(
  {
    hardware: nonNegativeNumber(),
    service: nonNegativeNumber(),
    subscription: {
      type: Number,
      default: 0,
      enum: {
        values: [0],
        message: 'subscription must be 0',
      },
      immutable: true,
    },
  },
  {
    collection: 'category_discounts',
    timestamps: true,
    versionKey: false,
  },
)

// subscription is intentionally fixed at zero, so making it unique also
// enforces that category_discounts remains a singleton configuration.
categoryDiscountSchema.index(
  { subscription: 1 },
  { name: 'category_discount_singleton', unique: true },
)
categoryDiscountSchema.index(
  { updatedAt: -1, _id: -1 },
  { name: 'category_discount_latest' },
)

const tierDiscountSchema = new mongoose.Schema(
  {
    tier: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      unique: true,
    },
    discount: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      validate: {
        validator: Number.isInteger,
        message: '{PATH} must be an integer',
      },
    },
    threshold: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  {
    collection: 'tier_discounts',
    timestamps: true,
    versionKey: false,
  },
)

tierDiscountSchema.index({ threshold: 1, tier: 1 })

export const CategoryDiscount =
  mongoose.models.CategoryDiscount ??
  mongoose.model('CategoryDiscount', categoryDiscountSchema)

export const TierDiscount =
  mongoose.models.TierDiscount ??
  mongoose.model('TierDiscount', tierDiscountSchema)

export async function ensureDefaultDiscountPolicies() {
  await TierDiscount.updateMany(
    { threshold: { $exists: false } },
    { $set: { threshold: 0 } },
    { runValidators: true },
  )

  await Promise.all(
    DEFAULT_CUSTOMER_TIERS.map(({ tier, discount, threshold }) =>
      TierDiscount.updateOne(
        { tier },
        { $setOnInsert: { tier, discount, threshold } },
        { upsert: true, runValidators: true },
      ),
    ),
  )

  await CategoryDiscount.updateOne(
    { subscription: 0 },
    {
      $setOnInsert: {
        hardware: 0,
        service: 0,
        subscription: 0,
      },
    },
    { upsert: true, runValidators: true },
  )
}
