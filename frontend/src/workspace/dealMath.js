import {
  CATEGORY_DISCOUNT_LIMITS,
  CUSTOMER_TIER_LIMITS,
  products,
  warehouseData,
} from './seed.js'

export const productById = new Map(products.map((product) => [product.id, product]))

export function formatMoney(value, compact = false) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? 'compact' : 'standard',
  }).format(Number(value) || 0)
}

export function formatPercentage(value, digits = 1) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}%` : 'Not available'
}

export function effectiveDiscount(lineDiscount = 0, orderDiscount = 0) {
  const lineFactor = 1 - Math.min(Math.max(lineDiscount, 0), 100) / 100
  const orderFactor = 1 - Math.min(Math.max(orderDiscount, 0), 100) / 100
  return (1 - lineFactor * orderFactor) * 100
}

export function calculateQuote(quote) {
  const enrichedLines = quote.lines
    .map((line) => {
      const product = line.product ?? productById.get(line.productId)
      if (!product) return null
      const gross = product.price * line.quantity
      const discount = effectiveDiscount(line.discount, quote.orderDiscount)
      const net = gross * (1 - discount / 100)
      const cost = Number.isFinite(product.cost)
        ? product.cost * line.quantity
        : null
      const marginValue = cost === null ? null : net - cost
      const allowedDiscount = Number.isFinite(product.discountLimit)
        ? product.discountLimit
        : Math.min(
            CUSTOMER_TIER_LIMITS[quote.customer.tier] ?? 0,
            CATEGORY_DISCOUNT_LIMITS[product.category] ?? 0,
          )
      const excess = Math.max(0, discount - allowedDiscount)

      return {
        ...line,
        product,
        gross,
        discount,
        net,
        cost,
        marginValue,
        marginPercent:
          marginValue === null ? null : net ? (marginValue / net) * 100 : 0,
        allowedDiscount,
        excess,
      }
    })
    .filter(Boolean)

  const gross = enrichedLines.reduce((sum, line) => sum + line.gross, 0)
  const total = enrichedLines.reduce((sum, line) => sum + line.net, 0)
  const cost = enrichedLines.every((line) => line.cost !== null)
    ? enrichedLines.reduce((sum, line) => sum + line.cost, 0)
    : null
  const discountValue = gross - total
  const marginValue = cost === null ? null : total - cost
  const marginPercent =
    marginValue === null ? null : total ? (marginValue / total) * 100 : 0
  const weightedExcess = gross
    ? enrichedLines.reduce((sum, line) => sum + line.excess * (line.gross / gross), 0)
    : 0
  const maxExcess = Math.max(0, ...enrichedLines.map((line) => line.excess))
  const lowMarginPenalty =
    marginPercent === null ? 0 : marginPercent < 20 ? 18 : marginPercent < 28 ? 8 : 0
  const riskScore = Math.min(
    100,
    Math.round(maxExcess * 6 + weightedExcess * 4 + lowMarginPenalty),
  )
  const approvalLevel =
    riskScore >= 65 || maxExcess >= 8
      ? 'MANAGER_AND_FINANCE'
      : riskScore > 0
        ? 'MANAGER'
        : 'NONE'

  const calculated = {
    lines: enrichedLines,
    gross,
    total,
    cost,
    discountValue,
    marginValue,
    marginPercent,
    weightedExcess,
    maxExcess,
    riskScore,
    approvalLevel,
  }

  if (!quote.serverPricing) return calculated

  const serverRiskScore =
    { LOW: 15, MEDIUM: 50, HIGH: 85 }[quote.serverPricing.risk] ?? 0
  return {
    ...calculated,
    gross: quote.serverPricing.gross,
    total: quote.serverPricing.total,
    cost: null,
    discountValue: Math.max(
      0,
      quote.serverPricing.gross - quote.serverPricing.discounted,
    ),
    marginValue: null,
    marginPercent: null,
    riskScore: serverRiskScore,
    approvalLevel:
      quote.serverPricing.risk === 'HIGH'
        ? 'MANAGER_AND_FINANCE'
        : quote.serverPricing.risk === 'MEDIUM'
          ? 'MANAGER'
          : 'NONE',
  }
}

export function getRecommendedSplit(quote) {
  const shipments = []

  quote.lines.forEach((line) => {
    const product = productById.get(line.productId)
    if (!product || product.stock === null) return

    let remaining = line.quantity
    const candidates = [...warehouseData].sort(
      (a, b) => a.shippingWeight - b.shippingWeight,
    )

    candidates.forEach((warehouse) => {
      if (!remaining) return
      const available = warehouse.stock[line.productId] ?? 0
      const allocated = Math.min(available, remaining)
      if (!allocated) return

      let shipment = shipments.find((item) => item.warehouseId === warehouse.id)
      if (!shipment) {
        shipment = {
          warehouseId: warehouse.id,
          warehouse: warehouse.name,
          city: warehouse.city,
          serviceLevel: warehouse.serviceLevel,
          cost: Math.round(1450 * warehouse.shippingWeight),
          lines: [],
        }
        shipments.push(shipment)
      }
      shipment.lines.push({ productId: product.id, name: product.name, quantity: allocated })
      remaining -= allocated
    })

    if (remaining) {
      shipments.push({
        warehouseId: `backorder-${product.id}`,
        warehouse: 'Backorder',
        city: 'Awaiting replenishment',
        serviceLevel: 'Estimated 5-7 days',
        cost: 0,
        lines: [{ productId: product.id, name: product.name, quantity: remaining }],
        backorder: true,
      })
    }
  })

  return shipments
}

export function getRecurringSchedule(quote) {
  const recurring = calculateQuote(quote).lines.filter((line) => line.product.recurring)
  const baseDate = new Date(2026, 8, 5)

  return Array.from({ length: 4 }, (_, index) => {
    const date = new Date(baseDate)
    date.setMonth(date.getMonth() + index)
    return {
      id: `invoice-${index + 1}`,
      date: new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(date),
      amount: recurring.reduce((sum, line) => sum + line.net, 0),
      status: index === 0 ? 'DUE' : 'SCHEDULED',
    }
  })
}
