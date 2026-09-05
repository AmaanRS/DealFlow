import mongoose from 'mongoose'

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

const tierDiscountSchema = new mongoose.Schema(
  {
    tier: {
      type: String,
      required: true,
      trim: true,
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
  },
  {
    collection: 'tier_discounts',
    timestamps: true,
    versionKey: false,
  },
)

tierDiscountSchema.index({ discount: 1, tier: 1 })

export const CategoryDiscount =
  mongoose.models.CategoryDiscount ??
  mongoose.model('CategoryDiscount', categoryDiscountSchema)

export const TierDiscount =
  mongoose.models.TierDiscount ??
  mongoose.model('TierDiscount', tierDiscountSchema)
