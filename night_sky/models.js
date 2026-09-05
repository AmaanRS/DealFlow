import mongoose from "mongoose";

const { Schema } = mongoose;

export const ITEM_CATEGORIES = Object.freeze([
  "HARDWARE",
  "SERVICES",
  "SUBSCRIPTION",
]);

function nonNegativeNumber(defaultValue = 0) {
  return {
    type: Number,
    min: 0,
    default: defaultValue,
  };
}

function nonNegativeInteger(defaultValue = 0) {
  return {
    type: Number,
    min: 0,
    default: defaultValue,
    validate: {
      validator: Number.isInteger,
      message: "{PATH} must be an integer",
    },
  };
}

const categoryDiscountSchema = new Schema(
  {
    hardware: nonNegativeNumber(),
    service: nonNegativeNumber(),
    subscription: {
      type: Number,
      default: 0,
      enum: {
        values: [0],
        message: "subscription must be 0",
      },
      immutable: true,
    },
  },
  { collection: "category_discounts", timestamps: true },
);

const tierDiscountSchema = new Schema(
  {
    tier: {
      type: String,
      required: true,
      trim: true,
    },
    discount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "{PATH} must be an integer",
      },
    },
  },
  { collection: "tier_discounts", timestamps: true },
);

const reportingHsnSchema = new Schema({
  reporting_hsn: {
    type: String,
    required: true,
    trim: true,
    immutable: true,
  },
  gst: {
    type: Number,
    required: true,
    min: 0,
  },
});

const hsnSchema = new Schema(
  {
    hsn_code: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    reporting_hsn: {
      type: [reportingHsnSchema],
      default: [],
    },
  },
  { collection: "hsn", timestamps: true },
);

hsnSchema.index(
  { "reporting_hsn.reporting_hsn": 1 },
  { unique: true, sparse: true },
);

const storeSchema = new Schema(
  {
    _id: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "_id must be an integer",
      },
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    lat: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    long: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
  },
  { collection: "stores", timestamps: true },
);

const inventorySchema = new Schema(
  {
    sellable: nonNegativeInteger(),
    reserved: nonNegativeInteger(),
  },
  { _id: false },
);

const articleSchema = new Schema(
  {
    item_id: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true,
      index: true,
    },
    seller_identifier: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    price: {
      ...nonNegativeInteger(),
      required: true,
    },
    inventory: {
      type: inventorySchema,
      default: () => ({}),
    },
    store_id: nonNegativeInteger(),
    discount: nonNegativeNumber(),
    restock_point: nonNegativeInteger(),
  },
  { collection: "articles", timestamps: true },
);

articleSchema.index({ item_id: 1, store_id: 1 });

const itemSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    all_identifiers: [
      {
        type: Schema.Types.ObjectId,
        ref: "Article",
      },
    ],
    reporting_hsn: {
      type: String,
      required: true,
      trim: true,
    },
    categories: {
      type: [String],
      enum: ITEM_CATEGORIES,
      required: true,
      validate: {
        validator: (categories) => categories.length > 0,
        message: "categories must contain at least one category",
      },
    },
    cycle: {
      type: String,
      trim: true,
      default: null,
      validate: {
        validator(value) {
          return value == null || this.categories.includes("SUBSCRIPTION");
        },
        message: "cycle can only be set for a SUBSCRIPTION item",
      },
    },
  },
  { collection: "items", timestamps: true },
);

articleSchema.pre("validate", async function enforceSubscriptionArticle() {
  if (!this.item_id) {
    return;
  }

  const item = await mongoose
    .model("Item")
    .findById(this.item_id)
    .select("categories")
    .lean();

  if (!item) {
    this.invalidate("item_id", "item_id must reference an existing item");
    return;
  }

  if (!item.categories.includes("SUBSCRIPTION")) {
    return;
  }

  if (this.store_id !== 0) {
    this.invalidate("store_id", "store_id must be 0 for a SUBSCRIPTION item");
  }

  if (this.discount !== 0) {
    this.invalidate("discount", "discount must be 0 for a SUBSCRIPTION item");
  }
});

itemSchema.pre("validate", async function enforceExistingArticles() {
  if (
    !this.categories.includes("SUBSCRIPTION") ||
    this.all_identifiers.length === 0
  ) {
    return;
  }

  const conflictingArticle = await mongoose.model("Article").exists({
    _id: { $in: this.all_identifiers },
    $or: [{ store_id: { $ne: 0 } }, { discount: { $ne: 0 } }],
  });

  if (conflictingArticle) {
    this.invalidate(
      "all_identifiers",
      "all articles for a SUBSCRIPTION item must have store_id and discount set to 0",
    );
  }
});

export const CategoryDiscount =
  mongoose.models.CategoryDiscount ??
  mongoose.model("CategoryDiscount", categoryDiscountSchema);

export const TierDiscount =
  mongoose.models.TierDiscount ??
  mongoose.model("TierDiscount", tierDiscountSchema);

export const Hsn = mongoose.models.Hsn ?? mongoose.model("Hsn", hsnSchema);
export const Store =
  mongoose.models.Store ?? mongoose.model("Store", storeSchema);
export const Article =
  mongoose.models.Article ?? mongoose.model("Article", articleSchema);
export const Item = mongoose.models.Item ?? mongoose.model("Item", itemSchema);

export async function appendReportingHsn(hsnCode, gst) {
  const normalizedHsnCode = hsnCode.trim();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reportingHsnId = new mongoose.Types.ObjectId();
    const existingEntries = { $ifNull: ["$reporting_hsn", []] };
    const nextSequence = {
      $add: [
        {
          $ifNull: [
            {
              $max: {
                $map: {
                  input: existingEntries,
                  as: "entry",
                  in: {
                    $convert: {
                      input: {
                        $replaceOne: {
                          input: "$$entry.reporting_hsn",
                          find: `${normalizedHsnCode}H`,
                          replacement: "",
                        },
                      },
                      to: "int",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },
              },
            },
            0,
          ],
        },
        1,
      ],
    };

    try {
      const hsn = await Hsn.findOneAndUpdate(
        { hsn_code: normalizedHsnCode },
        [
          {
            $set: {
              hsn_code: normalizedHsnCode,
              reporting_hsn: {
                $concatArrays: [
                  existingEntries,
                  [
                    {
                      _id: reportingHsnId,
                      reporting_hsn: {
                        $concat: [
                          normalizedHsnCode,
                          "H",
                          {
                            $toString: nextSequence,
                          },
                        ],
                      },
                      gst,
                    },
                  ],
                ],
              },
            },
          },
        ],
        { returnDocument: "after", upsert: true, updatePipeline: true },
      );

      return hsn.reporting_hsn.id(reportingHsnId);
    } catch (error) {
      if (error?.code !== 11000 || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Could not allocate a reporting HSN");
}

const models = [CategoryDiscount, TierDiscount, Hsn, Store, Article, Item];

export async function initializeCollections() {
  await Promise.all(models.map((model) => model.init()));
  return models.map((model) => model.collection.collectionName);
}
