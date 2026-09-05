import mongoose from 'mongoose'
import { SESSION_KINDS, USER_ROLES, USER_STATUSES } from './constants.js'

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
      index: true,
    },
    approval: { type: approvalSchema, required: true },
    profile: { type: profileSchema, default: () => ({}) },
  },
  { timestamps: true, versionKey: false },
)

userSchema.index({ status: 1, 'approval.requestedAt': -1 })

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    kind: {
      type: String,
      enum: Object.values(SESSION_KINDS),
      required: true,
      index: true,
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
  { versionKey: false },
)

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
sessionSchema.index({ userId: 1, revokedAt: 1 })

const portalInvitationSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    quotationId: { type: String, required: true, maxlength: 100, index: true },
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
  { timestamps: true, versionKey: false },
)

const auditEventSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true, maxlength: 100, index: true },
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
  { versionKey: false },
)

export const User = mongoose.model('User', userSchema)
export const Session = mongoose.model('Session', sessionSchema)
export const PortalInvitation = mongoose.model(
  'PortalInvitation',
  portalInvitationSchema,
)
export const AuditEvent = mongoose.model('AuditEvent', auditEventSchema)
