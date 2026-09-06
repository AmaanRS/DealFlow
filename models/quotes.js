import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { User } from './auth.js'
import {
  Article,
  Hsn,
  Item,
  Store,
  resolveLatestReportingHsn,
} from './catalog.js'
import { RiskConfiguration } from './risk.js'
import {
  AUTO_APPROVER,
  ITEM_CATEGORIES,
  QUOTE_RISKS,
  QUOTE_STATUSES,
  SUBSCRIPTION_STATUSES,
} from './constants.js'

const { Schema } = mongoose
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function nonNegativeNumber(defaultValue = 0) {
  return {
    type: Number,
    min: 0,
    default: defaultValue,
  }
}

function positiveInteger() {
  return {
    type: Number,
    required: true,
    min: 1,
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

function emailField({ required = true } = {}) {
  return {
    type: String,
    required,
    default: required ? undefined : null,
    trim: true,
    lowercase: true,
    maxlength: 254,
    validate: {
      validator(value) {
        return value == null || EMAIL_PATTERN.test(value)
      },
      message: '{PATH} must be a valid email address',
    },
  }
}

const quotedProductSchema = new Schema({
  article_id: {
    type: Schema.Types.ObjectId,
    ref: Article.modelName,
    required: true,
  },
  item_id: {
    type: Schema.Types.ObjectId,
    ref: Item.modelName,
    required: true,
  },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  hsn: { type: String, required: true, trim: true, maxlength: 100 },
  category: { type: String, enum: ITEM_CATEGORIES, required: true },
  store_id: {
    type: Schema.Types.ObjectId,
    ref: Store.modelName,
    default: null,
  },
  gst: percentage(),
  unit_price: nonNegativeNumber(),
  product_discount: percentage(),
  inv: positiveInteger(),
  applied_discount: percentage(),
  category_discount: percentage(),
})

const fulfillmentDetailSchema = new Schema({
  seller_identifier: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  store: {
    type: Schema.Types.ObjectId,
    ref: Store.modelName,
    required: true,
  },
  inv: positiveInteger(),
})

const quoteSchema = new Schema(
  {
    customer: {
      type: String,
      ref: User.modelName,
      required: true,
      trim: true,
      validate: {
        validator: mongoose.isObjectIdOrHexString,
        message: 'customer must be a valid User ObjectId string',
      },
    },
    products: {
      type: [quotedProductSchema],
      default: [],
    },
    order_discount: percentage(),
    tier_discount: percentage(),
    cost_price: nonNegativeNumber(),
    discounted_price: nonNegativeNumber(),
    selling_price: nonNegativeNumber(),
    created_by: emailField(),
    approved_by: {
      type: String,
      default: null,
      trim: true,
      maxlength: 254,
      validate: {
        validator(value) {
          return value == null || value === AUTO_APPROVER || EMAIL_PATTERN.test(value)
        },
        message: `approved_by must be an email address or ${AUTO_APPROVER}`,
      },
    },
    assigned_to: emailField(),
    status: {
      type: String,
      enum: QUOTE_STATUSES,
      default: 'DRAFT',
      required: true,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
      maxlength: 2000,
    },
    is_latest_quote: {
      type: Boolean,
      default: true,
      required: true,
    },
    risk: {
      type: String,
      enum: QUOTE_RISKS,
      default: 'LOW',
      required: true,
    },
    customer_total_price_applied: {
      type: Boolean,
      default: false,
      required: true,
    },
    fulfillment_details: {
      type: [fulfillmentDetailSchema],
      default: [],
    },
    subscription_details: [
      {
        type: Schema.Types.ObjectId,
        ref: 'SubscriptionDetails',
      },
    ],
  },
  { collection: 'quotes', timestamps: true, versionKey: false },
)

quoteSchema.index(
  { is_latest_quote: 1, updatedAt: -1, _id: -1 },
  { name: 'quote_latest_list' },
)
quoteSchema.index(
  { customer: 1, is_latest_quote: 1, updatedAt: -1, _id: -1 },
  { name: 'quote_by_customer' },
)
quoteSchema.index(
  { status: 1, is_latest_quote: 1, updatedAt: -1, _id: -1 },
  { name: 'quote_by_status' },
)
quoteSchema.index(
  { risk: 1, is_latest_quote: 1, updatedAt: -1, _id: -1 },
  { name: 'quote_by_risk' },
)
quoteSchema.index(
  { created_by: 1, is_latest_quote: 1, updatedAt: -1, _id: -1 },
  { name: 'quote_by_creator' },
)
quoteSchema.index(
  { approved_by: 1, is_latest_quote: 1, updatedAt: -1, _id: -1 },
  { name: 'quote_by_approver' },
)
quoteSchema.index(
  { assigned_to: 1, is_latest_quote: 1, updatedAt: -1, _id: -1 },
  { name: 'quote_by_assignee' },
)

const quoteRevisionHistorySchema = new Schema(
  {
    quote_version: {
      ...positiveInteger(),
      immutable: true,
    },
    negotiation_id: {
      type: String,
      required: true,
      default: randomUUID,
      immutable: true,
      validate: {
        validator: (value) => UUID_PATTERN.test(value),
        message: 'negotiation_id must be a valid UUID',
      },
    },
    quote_id: {
      type: Schema.Types.ObjectId,
      ref: 'Quote',
      required: true,
      immutable: true,
    },
  },
  {
    collection: 'quote_revision_history',
    timestamps: true,
    versionKey: false,
  },
)

quoteRevisionHistorySchema.index({ quote_id: 1 }, { unique: true })
quoteRevisionHistorySchema.index(
  { negotiation_id: 1, quote_version: 1 },
  { unique: true },
)

const subscriptionDetailsSchema = new Schema(
  {
    article_id: {
      type: Schema.Types.ObjectId,
      ref: 'Article',
      required: true,
      immutable: true,
    },
    hsn: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },
    item_id: {
      type: Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      default: 'ACTIVE',
      required: true,
    },
    is_latest: {
      type: Boolean,
      default: true,
      required: true,
    },
    subscription_price: {
      ...nonNegativeNumber(),
      required: true,
      immutable: true,
    },
    selling_price: {
      ...nonNegativeNumber(),
      required: true,
      immutable: true,
    },
  },
  { collection: 'subscription_details', timestamps: true, versionKey: false },
)

subscriptionDetailsSchema.index(
  { is_latest: 1, updatedAt: -1, _id: -1 },
  { name: 'subscription_latest_list' },
)
subscriptionDetailsSchema.index(
  { status: 1, is_latest: 1, updatedAt: -1, _id: -1 },
  { name: 'subscription_by_status' },
)
subscriptionDetailsSchema.index(
  { article_id: 1, is_latest: 1, updatedAt: -1, _id: -1 },
  { name: 'subscription_by_article' },
)
subscriptionDetailsSchema.index(
  { item_id: 1, is_latest: 1, updatedAt: -1, _id: -1 },
  { name: 'subscription_by_item' },
)

subscriptionDetailsSchema.pre('validate', async function deriveSubscriptionPricing() {
  if (!this.article_id || (!this.isNew && !this.isModified('article_id'))) return

  const connection = this.constructor.db
  const ArticleModel =
    connection.models.Article ?? connection.model('Article', Article.schema)
  const ItemModel = connection.models.Item ?? connection.model('Item', Item.schema)
  const HsnModel = connection.models.Hsn ?? connection.model('Hsn', Hsn.schema)

  const article = await ArticleModel.findById(this.article_id)
    .select('item_id price')
    .lean()

  if (!article) {
    this.invalidate('article_id', 'article_id must reference an existing article')
    return
  }

  const item = await ItemModel.findById(article.item_id)
    .select('reporting_hsn')
    .lean()

  if (!item) {
    this.invalidate('item_id', 'The article must reference an existing item')
    return
  }

  const reportingHsn = await resolveLatestReportingHsn(item.reporting_hsn, {
    HsnModel,
  })

  if (!reportingHsn) {
    this.invalidate('hsn', 'The item must reference an existing reporting HSN')
    return
  }

  this.hsn = reportingHsn.reporting_hsn
  this.item_id = article.item_id
  this.subscription_price = article.price
  this.selling_price = Math.round(
    article.price * (1 + reportingHsn.gst / 100) * 100,
  ) / 100
})

const subscriptionRevisionHistorySchema = new Schema(
  {
    sub_version: positiveInteger(),
    subscription_details_id: {
      type: Schema.Types.ObjectId,
      ref: 'SubscriptionDetails',
      required: true,
    },
  },
  {
    collection: 'subscription_revision_history',
    timestamps: true,
    versionKey: false,
  },
)

subscriptionRevisionHistorySchema.index(
  { subscription_details_id: 1, sub_version: 1 },
  { unique: true },
)

const billingSchema = new Schema(
  {
    invoice_id: {
      type: String,
      required: true,
      default: randomUUID,
      immutable: true,
      unique: true,
      validate: {
        validator: (value) => UUID_PATTERN.test(value),
        message: 'invoice_id must be a valid UUID',
      },
    },
    quote_id: {
      type: Schema.Types.ObjectId,
      ref: 'Quote',
      required: true,
      unique: true,
      immutable: true,
    },
    invoice_number: {
      type: String,
      required: true,
      immutable: true,
      unique: true,
      sparse: true,
      maxlength: 16,
      match: /^[A-Za-z0-9/-]+$/,
    },
    invoice_object_key: {
      type: String,
      required: true,
      immutable: true,
      unique: true,
      sparse: true,
      default() {
        return this.invoice_id
      },
    },
    invoice_created_at: {
      type: Date,
      required: true,
      immutable: true,
      default: Date.now,
    },
    invoice_etag: {
      type: String,
      default: null,
      immutable: true,
    },
    final_amt: {
      ...nonNegativeNumber(),
      required: true,
      immutable: true,
    },
  },
  { collection: 'billing', timestamps: true, versionKey: false },
)

const invoiceSequenceSchema = new Schema(
  {
    _id: {
      type: String,
      required: true,
      match: /^\d{2}-\d{2}$/,
    },
    sequence: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { collection: 'invoice_sequences', versionKey: false },
)

billingSchema.pre('validate', async function calculateFinalAmount() {
  if (!this.quote_id || (!this.isNew && !this.isModified('quote_id'))) return

  const connection = this.constructor.db
  const QuoteModel =
    connection.models.Quote ?? connection.model('Quote', quoteSchema)
  const SubscriptionModel =
    connection.models.SubscriptionDetails ??
    connection.model('SubscriptionDetails', subscriptionDetailsSchema)
  const quote = await QuoteModel.findById(this.quote_id)
    .select('selling_price subscription_details')
    .lean()

  if (!quote) {
    this.invalidate('quote_id', 'quote_id must reference an existing quote')
    return
  }

  const subscriptions = await SubscriptionModel.find({
    _id: { $in: quote.subscription_details },
  })
    .select('selling_price')
    .lean()
  const subscriptionTotal = subscriptions.reduce(
    (total, subscription) => total + subscription.selling_price,
    0,
  )

  this.final_amt =
    Math.round((quote.selling_price + subscriptionTotal) * 100) / 100
})

export const Quote =
  mongoose.models.Quote ?? mongoose.model('Quote', quoteSchema)
export const QuoteRevisionHistory =
  mongoose.models.QuoteRevisionHistory ??
  mongoose.model('QuoteRevisionHistory', quoteRevisionHistorySchema)
export const SubscriptionDetails =
  mongoose.models.SubscriptionDetails ??
  mongoose.model('SubscriptionDetails', subscriptionDetailsSchema)
export const SubscriptionRevisionHistory =
  mongoose.models.SubscriptionRevisionHistory ??
  mongoose.model(
    'SubscriptionRevisionHistory',
    subscriptionRevisionHistorySchema,
  )
export const Billing =
  mongoose.models.Billing ?? mongoose.model('Billing', billingSchema)
const InvoiceSequence =
  mongoose.models.InvoiceSequence ??
  mongoose.model('InvoiceSequence', invoiceSequenceSchema)

export function indianFinancialYear(value = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new TypeError('date must be valid')

  // Work in Indian Standard Time so invoices around midnight are assigned to
  // the correct Indian financial year.
  const indiaDate = new Date(date.getTime() + 330 * 60 * 1000)
  const year = indiaDate.getUTCFullYear()
  const startYear = indiaDate.getUTCMonth() >= 3 ? year : year - 1
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`
}

export async function allocateInvoiceNumber(value = new Date()) {
  const financialYear = indianFinancialYear(value)
  const counter = await InvoiceSequence.findOneAndUpdate(
    { _id: financialYear },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  )

  if (!counter || counter.sequence > 999999) {
    throw new Error(`Invoice sequence exhausted for FY ${financialYear}`)
  }

  return `DF/${financialYear}/${String(counter.sequence).padStart(6, '0')}`
}

const quoteModels = [
  RiskConfiguration,
  Quote,
  QuoteRevisionHistory,
  SubscriptionDetails,
  SubscriptionRevisionHistory,
  Billing,
  InvoiceSequence,
]

async function migrateQuoteRevisionIndexes() {
  await QuoteRevisionHistory.createCollection()

  const indexes = await QuoteRevisionHistory.collection.indexes()
  const quoteIdIndex = indexes.find(
    (index) =>
      Object.keys(index.key).length === 1 && index.key.quote_id === 1,
  )

  if (quoteIdIndex && !quoteIdIndex.unique) {
    const duplicate = await QuoteRevisionHistory.aggregate([
      { $group: { _id: '$quote_id', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ])

    if (duplicate.length > 0) {
      throw new Error(
        'Cannot create the unique quote revision index while duplicate quote_id values exist',
      )
    }

    await QuoteRevisionHistory.collection.dropIndex(quoteIdIndex.name)
  }

  const obsoleteIndex = indexes.find(
    (index) =>
      Object.keys(index.key).length === 2 &&
      index.key.quote_id === 1 &&
      index.key.quote_version === 1,
  )

  if (obsoleteIndex) {
    await QuoteRevisionHistory.collection.dropIndex(obsoleteIndex.name)
  }
}

export async function initializeQuoteCollections() {
  await migrateQuoteRevisionIndexes()
  await Promise.all(quoteModels.map((model) => model.init()))
  await User.updateMany(
    {
      role: 'CUSTOMER',
      '_custom_json.total_price': { $exists: false },
    },
    { $set: { '_custom_json.total_price': 0 } },
    { runValidators: true },
  )
  return quoteModels.map((model) => model.collection.collectionName)
}
