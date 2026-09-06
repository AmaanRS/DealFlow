import mongoose from 'mongoose'
import { ITEM_CATEGORIES } from './constants.js'
import { CategoryDiscount, TierDiscount } from './discounts.js'

const { Schema } = mongoose

function nonNegativeNumber(defaultValue = 0) {
  return {
    type: Number,
    min: 0,
    default: defaultValue,
  }
}

function nonNegativeInteger(defaultValue = 0) {
  return {
    type: Number,
    min: 0,
    default: defaultValue,
    validate: {
      validator: Number.isInteger,
      message: '{PATH} must be an integer',
    },
  }
}

function percentage(defaultValue = 0) {
  return {
    type: Number,
    min: 0,
    max: 100,
    default: defaultValue,
  }
}

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
    max: 100,
  },
})

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
  { collection: 'hsn', timestamps: true },
)

hsnSchema.index(
  { 'reporting_hsn.reporting_hsn': 1 },
  { unique: true, sparse: true },
)

const storeSchema = new Schema(
  {
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
  { collection: 'stores', timestamps: true },
)

storeSchema.index(
  { name: 1, lat: 1, long: 1 },
  { name: 'store_identity_unique', unique: true },
)

const inventorySchema = new Schema(
  {
    sellable: nonNegativeInteger(),
    reserved: nonNegativeInteger(),
  },
  { _id: false },
)

const articleSchema = new Schema(
  {
    item_id: {
      type: Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
    },
    seller_identifier: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      ...nonNegativeInteger(),
      required: true,
    },
    inventory: {
      type: inventorySchema,
      default: () => ({}),
    },
    store_id: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      default: null,
    },
    discount: percentage(),
    restock_point: nonNegativeInteger(),
  },
  { collection: 'articles', timestamps: true },
)

articleSchema.index(
  { seller_identifier: 1 },
  { name: 'article_seller_identifier_unique', unique: true },
)
articleSchema.index(
  { item_id: 1, store_id: 1, 'inventory.sellable': -1 },
  { name: 'article_inventory_by_item' },
)

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
        ref: 'Article',
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
        message: 'categories must contain at least one category',
      },
    },
    cycle: {
      type: String,
      trim: true,
      default: null,
      validate: {
        validator(value) {
          return value == null || this.categories.includes('SUBSCRIPTION')
        },
        message: 'cycle can only be set for a SUBSCRIPTION item',
      },
    },
  },
  { collection: 'items', timestamps: true },
)

itemSchema.index(
  { name: 1, _id: 1 },
  { name: 'item_name_list' },
)
itemSchema.index(
  { categories: 1, name: 1, _id: 1 },
  { name: 'item_category_name_list' },
)
itemSchema.index(
  { reporting_hsn: 1 },
  { name: 'item_by_reporting_hsn' },
)

articleSchema.pre('validate', async function enforceSubscriptionArticle() {
  if (!this.item_id) return

  const item = await this.constructor.db
    .model('Item')
    .findById(this.item_id)
    .select('categories')
    .lean()

  if (!item) {
    this.invalidate('item_id', 'item_id must reference an existing item')
    return
  }

  if (item.categories.includes('SUBSCRIPTION')) {
    if (this.store_id !== null && this.store_id !== undefined) {
      this.invalidate(
        'store_id',
        'store_id must be null for a SUBSCRIPTION item',
      )
    }

    if (this.discount !== 0) {
      this.invalidate('discount', 'discount must be 0 for a SUBSCRIPTION item')
    }
    return
  }

  if (!this.store_id) {
    const hasInventory =
      (this.inventory?.sellable ?? 0) > 0 ||
      (this.inventory?.reserved ?? 0) > 0
    if (hasInventory) {
      this.invalidate(
        'store_id',
        'store_id is required before inventory can be added',
      )
    }
    return
  }

  const storeExists = await this.constructor.db
    .model('Store')
    .exists({ _id: this.store_id })

  if (!storeExists) {
    this.invalidate('store_id', 'store_id must reference an existing store')
  }
})

itemSchema.pre('validate', async function enforceExistingArticles() {
  if (
    !this.categories.includes('SUBSCRIPTION') ||
    this.all_identifiers.length === 0
  ) {
    return
  }

  const conflictingArticle = await this.constructor.db.model('Article').exists({
    _id: { $in: this.all_identifiers },
    $or: [{ store_id: { $ne: null } }, { discount: { $ne: 0 } }],
  })

  if (conflictingArticle) {
    this.invalidate(
      'all_identifiers',
      'all articles for a SUBSCRIPTION item must have store_id set to null and discount set to 0',
    )
  }
})

export const Hsn = mongoose.models.Hsn ?? mongoose.model('Hsn', hsnSchema)
export const Store =
  mongoose.models.Store ?? mongoose.model('Store', storeSchema)
export const Article =
  mongoose.models.Article ?? mongoose.model('Article', articleSchema)
export const Item = mongoose.models.Item ?? mongoose.model('Item', itemSchema)

export async function appendReportingHsn(hsnCode, gst) {
  const normalizedHsnCode = hsnCode.trim()

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reportingHsnId = new mongoose.Types.ObjectId()
    const existingEntries = { $ifNull: ['$reporting_hsn', []] }
    const nextSequence = {
      $add: [
        {
          $ifNull: [
            {
              $max: {
                $map: {
                  input: existingEntries,
                  as: 'entry',
                  in: {
                    $convert: {
                      input: {
                        $replaceOne: {
                          input: '$$entry.reporting_hsn',
                          find: `${normalizedHsnCode}H`,
                          replacement: '',
                        },
                      },
                      to: 'int',
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
    }

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
                          'H',
                          { $toString: nextSequence },
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
        { returnDocument: 'after', upsert: true, updatePipeline: true },
      )

      return hsn.reporting_hsn.id(reportingHsnId)
    } catch (error) {
      if (error?.code !== 11000 || attempt === 2) throw error
    }
  }

  throw new Error('Could not allocate a reporting HSN')
}

const catalogModels = [
  CategoryDiscount,
  TierDiscount,
  Hsn,
  Store,
  Article,
  Item,
]

async function migrateArticleIndexes() {
  await Article.createCollection()

  const indexes = await Article.collection.indexes()
  const sellerIdentifierIndexes = indexes.filter(
    (index) =>
      Object.keys(index.key).length === 1 &&
      index.key.seller_identifier === 1,
  )
  const hasUniqueSellerIdentifierIndex = sellerIdentifierIndexes.some(
    (index) => index.unique,
  )

  if (!hasUniqueSellerIdentifierIndex) {
    const duplicate = await Article.aggregate([
      {
        $group: {
          _id: '$seller_identifier',
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ])

    if (duplicate.length > 0) {
      throw new Error(
        `Cannot create the unique seller_identifier index while duplicate value "${duplicate[0]._id}" exists`,
      )
    }
  }

  await Promise.all(
    sellerIdentifierIndexes
      .filter((index) => !index.unique)
      .map((index) => Article.collection.dropIndex(index.name)),
  )

  const obsoleteSellerStoreIndex = indexes.find(
    (index) =>
      Object.keys(index.key).length === 2 &&
      index.key.seller_identifier === 1 &&
      index.key.store_id === 1,
  )

  if (obsoleteSellerStoreIndex) {
    await Article.collection.dropIndex(obsoleteSellerStoreIndex.name)
  }
}

export async function initializeCollections() {
  await migrateArticleIndexes()
  await Promise.all(catalogModels.map((model) => model.init()))
  return catalogModels.map((model) => model.collection.collectionName)
}

export { ITEM_CATEGORIES }
