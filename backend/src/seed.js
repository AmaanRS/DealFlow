import { config } from './config.js'
import { USER_ROLES, USER_STATUSES } from './constants.js'
import { PortalInvitation, User } from './models.js'
import { hashPassword, hashToken } from './security.js'

export async function seedAuthenticationData() {
  let admin = await User.findOne({ emailLower: config.admin.email })

  if (!admin) {
    admin = await User.create({
      fullName: config.admin.name,
      email: config.admin.email,
      emailLower: config.admin.email,
      passwordHash: await hashPassword(config.admin.password),
      role: USER_ROLES.ADMIN,
      requestedRole: USER_ROLES.ADMIN,
      status: USER_STATUSES.ACTIVE,
      approval: {
        requestedAt: null,
        reviewedAt: new Date(),
        reviewedByUserId: null,
        reason: 'Predefined platform administrator',
      },
    })
    console.info(`Seeded administrator: ${config.admin.email}`)
  } else if (
    admin.role !== USER_ROLES.ADMIN ||
    admin.status !== USER_STATUSES.ACTIVE
  ) {
    throw new Error(
      `ADMIN_EMAIL belongs to a non-administrator account: ${config.admin.email}`,
    )
  }

  if (!config.demoPortal.token) return

  await PortalInvitation.findOneAndUpdate(
    { tokenHash: hashToken(config.demoPortal.token) },
    {
      $set: {
        quotationId: config.demoPortal.quotationId,
        quotationReference: config.demoPortal.quotationReference,
        customerName: config.demoPortal.customerName,
        customerEmail: config.demoPortal.customerEmail,
        customerEmailLower: config.demoPortal.customerEmail,
        createdByUserId: admin._id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        revokedAt: null,
      },
      $setOnInsert: {
        tokenHash: hashToken(config.demoPortal.token),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  )
  console.info('Seeded the local customer portal invitation')
}
