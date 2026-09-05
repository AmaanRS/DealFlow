import mongoose from 'mongoose'

export const RISK_CONFIGURATION_ID = 'quote-risk'
export const DEFAULT_MEDIUM_RISK_THRESHOLD = 25
export const DEFAULT_HIGH_RISK_THRESHOLD = 50

const riskConfigurationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      default: RISK_CONFIGURATION_ID,
      immutable: true,
    },
    medium_risk_threshold: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: DEFAULT_MEDIUM_RISK_THRESHOLD,
    },
    high_risk_threshold: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: DEFAULT_HIGH_RISK_THRESHOLD,
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    collection: 'risk_configurations',
    timestamps: true,
    versionKey: false,
  },
)

riskConfigurationSchema.pre('validate', function validateThresholdOrder() {
  if (this.medium_risk_threshold >= this.high_risk_threshold) {
    this.invalidate(
      'high_risk_threshold',
      'high_risk_threshold must be greater than medium_risk_threshold',
    )
  }
})

export const RiskConfiguration =
  mongoose.models.RiskConfiguration ??
  mongoose.model('RiskConfiguration', riskConfigurationSchema)

export function effectiveRiskThresholds(configuration) {
  return {
    medium_risk_threshold:
      configuration?.medium_risk_threshold ?? DEFAULT_MEDIUM_RISK_THRESHOLD,
    high_risk_threshold:
      configuration?.high_risk_threshold ?? DEFAULT_HIGH_RISK_THRESHOLD,
  }
}
