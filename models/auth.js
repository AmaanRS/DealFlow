import mongoose from 'mongoose'
import { SESSION_KINDS, USER_ROLES, USER_STATUSES } from './constants.js'
import { TierDiscount } from './discounts.js'

const approvalSchema = new mongoose.Schema(
  {
    requestedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reason: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
)

const profileSchema = new mongoose.Schema(
  {
    department: { type: String, default: null, maxlength: 100 },
    title: { type: String, default: null, maxlength: 100 },
    avatarUrl: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
)

const customerCustomJsonSchema = new mongoose.Schema(
  {
    delivery_address: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
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
    tier: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
    },
    total_price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { _id: false },
)

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, maxlength: 254 },
    emailLower: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: null,
    },
    requestedRole: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(USER_STATUSES),
      required: true,
    },
    is_verified: {
      type: Boolean,
      required: true,
      default: false,
    },
    is_deleted: {
      type: Boolean,
      required: true,
      default: false,
    },
    approval: { type: approvalSchema, required: true },
    profile: { type: profileSchema, default: () => ({}) },
    _custom_json: {
      type: customerCustomJsonSchema,
      default: null,
    },
  },
  { collection: 'users', timestamps: true, versionKey: false },
)

userSchema.index(
  { status: 1, 'approval.requestedAt': -1, _id: -1 },
  { name: 'user_registration_queue' },
)
userSchema.index(
  {
    role: 1,
    status: 1,
    is_verified: 1,
    is_deleted: 1,
    fullName: 1,
    _id: 1,
  },
  { name: 'user_customer_directory' },
)
userSchema.index(
  { is_deleted: 1, status: 1, createdAt: -1, _id: -1 },
  { name: 'user_admin_list' },
)

userSchema.pre('validate', async function assignCustomerTier() {
  const effectiveRole = this.role ?? this.requestedRole

  if (effectiveRole !== USER_ROLES.CUSTOMER) {
    if (this._custom_json !== null && this._custom_json !== undefined) {
      this.invalidate(
        '_custom_json',
        '_custom_json is only supported for CUSTOMER users',
      )
    }
    return
  }

  if (!this._custom_json) this._custom_json = {}
  if (this._custom_json.tier) return

  const TierDiscountModel =
    this.constructor.db.models.TierDiscount ??
    this.constructor.db.model('TierDiscount', TierDiscount.schema)
  const lowestTier = await TierDiscountModel.findOne({ tier: 'BRONZE' })
    .sort({ threshold: 1, tier: 1, _id: 1 })
    .select('tier')
    .lean()

  if (!lowestTier) {
    this.invalidate(
      '_custom_json.tier',
      'A CUSTOMER cannot be created until tier_discounts contains at least one tier',
    )
    return
  }

  this._custom_json.tier = lowestTier.tier
})

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    kind: {
      type: String,
      enum: Object.values(SESSION_KINDS),
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    portalInvitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PortalInvitation',
      default: null,
    },
    quotationId: { type: String, default: null, maxlength: 100 },
    createdAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, required: true, default: Date.now },
    userAgent: { type: String, default: null, maxlength: 500 },
    ipHash: { type: String, default: null },
  },
  { collection: 'sessions', versionKey: false },
)

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
sessionSchema.index({ userId: 1, revokedAt: 1 })

const portalInvitationSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    quotationId: { type: String, required: true, maxlength: 100 },
    quotationReference: { type: String, required: true, maxlength: 100 },
    customerName: { type: String, required: true, trim: true, maxlength: 120 },
    customerEmail: { type: String, required: true, trim: true, maxlength: 254 },
    customerEmailLower: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  {
    collection: 'portalinvitations',
    timestamps: true,
    versionKey: false,
  },
)

portalInvitationSchema.index(
  { quotationId: 1, customerEmailLower: 1 },
  {
    name: 'portal_invitation_active_unique',
    unique: true,
    partialFilterExpression: { revokedAt: null },
  },
)
portalInvitationSchema.index(
  { createdByUserId: 1, createdAt: -1 },
  { name: 'portal_invitation_by_creator' },
)

const auditEventSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true, maxlength: 100 },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    quotationId: { type: String, default: null, maxlength: 100 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { collection: 'auditevents', versionKey: false },
)

auditEventSchema.index(
  { eventType: 1, occurredAt: -1 },
  { name: 'audit_event_by_type' },
)
auditEventSchema.index(
  { actorUserId: 1, occurredAt: -1 },
  { name: 'audit_event_by_actor' },
)
auditEventSchema.index(
  { targetUserId: 1, occurredAt: -1 },
  { name: 'audit_event_by_target' },
)
auditEventSchema.index(
  { quotationId: 1, occurredAt: -1 },
  { name: 'audit_event_by_quotation' },
)

export const User = mongoose.models.User ?? mongoose.model('User', userSchema)
export const Session =
  mongoose.models.Session ?? mongoose.model('Session', sessionSchema)
export const PortalInvitation =
  mongoose.models.PortalInvitation ??
  mongoose.model('PortalInvitation', portalInvitationSchema)
export const AuditEvent =
  mongoose.models.AuditEvent ?? mongoose.model('AuditEvent', auditEventSchema)

const DEFAULT_TIER_ORDER = new Map([
  ['BRONZE', 0],
  ['SILVER', 1],
  ['GOLD', 2],
])

function orderedTierPolicies(tierPolicies) {
  return [...tierPolicies].sort((left, right) => {
    const leftRank = DEFAULT_TIER_ORDER.get(left.tier) ?? Number.MAX_SAFE_INTEGER
    const rightRank =
      DEFAULT_TIER_ORDER.get(right.tier) ?? Number.MAX_SAFE_INTEGER
    if (leftRank !== rightRank) return leftRank - rightRank

    const thresholdDifference = left.threshold - right.threshold
    if (thresholdDifference !== 0) return thresholdDifference
    return left.tier.localeCompare(right.tier)
  })
}

export function selectPromotedTier(
  tierPolicies,
  totalPrice,
  currentTier,
) {
  const orderedTiers = orderedTierPolicies(tierPolicies)
  const currentTierIndex = orderedTiers.findIndex(
    ({ tier }) => tier === currentTier,
  )
  let promotedTierIndex = currentTierIndex

  for (let index = 0; index < orderedTiers.length; index += 1) {
    if (totalPrice > orderedTiers[index].threshold) {
      promotedTierIndex = Math.max(promotedTierIndex, index)
    }
  }

  return promotedTierIndex >= 0
    ? orderedTiers[promotedTierIndex].tier
    : currentTier
}

export async function promoteCustomerTier(customerId, completedQuotePrice) {
  if (
    !mongoose.isObjectIdOrHexString(customerId) ||
    typeof completedQuotePrice !== 'number' ||
    !Number.isFinite(completedQuotePrice) ||
    completedQuotePrice < 0
  ) {
    throw new TypeError(
      'customerId must be a valid ObjectId and completedQuotePrice must be a non-negative number',
    )
  }

  const tierPolicies = await TierDiscount.find()
    .select('tier threshold')
    .lean()
  if (tierPolicies.length === 0) {
    throw new Error('Customer tier policies are not configured')
  }

  const orderedTiers = orderedTierPolicies(tierPolicies)
  const tierNames = orderedTiers.map(({ tier }) => tier)
  const newTotalPriceExpression = {
    $round: [
      {
        $add: [
          { $ifNull: ['$_custom_json.total_price', 0] },
          completedQuotePrice,
        ],
      },
      2,
    ],
  }
  const eligibleTierExpression = {
    $switch: {
      branches: [...orderedTiers].reverse().map(({ tier, threshold }) => ({
        case: { $gt: [newTotalPriceExpression, threshold] },
        then: tier,
      })),
      default: '$_custom_json.tier',
    },
  }
  const promotedTierExpression = {
    $let: {
      vars: {
        candidateTier: eligibleTierExpression,
        currentTierIndex: {
          $indexOfArray: [tierNames, '$_custom_json.tier'],
        },
      },
      in: {
        $let: {
          vars: {
            candidateTierIndex: {
              $indexOfArray: [tierNames, '$$candidateTier'],
            },
          },
          in: {
            $cond: [
              {
                $and: [
                  { $gte: ['$$candidateTierIndex', 0] },
                  {
                    $or: [
                      { $eq: ['$$currentTierIndex', -1] },
                      {
                        $gt: [
                          '$$candidateTierIndex',
                          '$$currentTierIndex',
                        ],
                      },
                    ],
                  },
                ],
              },
              '$$candidateTier',
              '$_custom_json.tier',
            ],
          },
        },
      },
    },
  }
  const previousCustomer = await User.findOneAndUpdate(
    {
      _id: customerId,
      role: USER_ROLES.CUSTOMER,
      _custom_json: { $ne: null },
    },
    [
      {
        $set: {
          '_custom_json.total_price': newTotalPriceExpression,
          '_custom_json.tier': promotedTierExpression,
        },
      },
    ],
    { returnDocument: 'before', updatePipeline: true },
  )

  if (!previousCustomer) {
    throw new Error('The completed quotation customer does not exist')
  }

  const previousTier = previousCustomer._custom_json.tier
  const totalPrice =
    Math.round(
      ((previousCustomer._custom_json.total_price ?? 0) +
        completedQuotePrice +
        Number.EPSILON) *
        100,
    ) / 100
  const tier = selectPromotedTier(tierPolicies, totalPrice, previousTier)

  return {
    customer_id: String(previousCustomer._id),
    previous_tier: previousTier,
    tier,
    promoted: previousTier !== tier,
    completed_quote_price: completedQuotePrice,
    total_price: totalPrice,
  }
}
