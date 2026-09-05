/**
 * Quotation stage vocabulary shared by the board and the workspace store.
 *
 * These are the values the services actually persist (`QUOTE_STATUSES` in
 * @app/models/constants), so a card can never land outside a column. They live
 * in their own module rather than beside the provider so importing them does
 * not break fast refresh for the component file.
 */

/** Board columns, in the order a deal moves through them. */
export const BOARD_COLUMNS = Object.freeze([
  { id: 'DRAFT', title: 'Draft', description: 'Building terms' },
  { id: 'PENDING_APPROVAL', title: 'Pending Approval', description: 'Pricing review' },
  { id: 'APPROVED', title: 'Approved', description: 'Owned by the approval chain' },
  { id: 'NEGOTIATION', title: 'Negotiation', description: 'Owned by the customer portal' },
  { id: 'COMPLETED', title: 'Confirmed', description: 'Owned by billing' },
])

/**
 * Stages a sales rep may write to their own quotation.
 *
 * The gateway clamps `PATCH /v1/api/quote/quotation` to DRAFT or
 * PENDING_APPROVAL, because APPROVED belongs to the approval chain, NEGOTIATION
 * to the customer portal and COMPLETED to billing. Only these two are therefore
 * valid drop targets on the board.
 */
export const MOVABLE_STAGES = Object.freeze(['DRAFT', 'PENDING_APPROVAL'])

/**
 * REJECTED is deliberately not a board column. It is not a stage a deal moves
 * through, and giving it a column would make every board look like a
 * graveyard; rejected quotations show up in the table view instead.
 */
export const BOARD_STAGE_IDS = Object.freeze(BOARD_COLUMNS.map((column) => column.id))
