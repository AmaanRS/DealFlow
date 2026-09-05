import {
  CalendarDays,
  FileDown,
  FileSpreadsheet,
  Filter,
  TrendingUp,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'
import { formatMoney } from '../dealMath.js'
import { reportRows } from '../seed.js'
import { PageHeader, Panel, StatCard } from '../components/Ui.jsx'

const tooltipStyle = {
  background: 'var(--ws-panel)',
  border: '1px solid var(--ws-line)',
  borderRadius: 10,
  color: 'var(--ws-text)',
  fontSize: 11,
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export default function ReportsPage() {
  const [period, setPeriod] = useState('6_MONTHS')
  const visibleRows = useMemo(
    () => period === '3_MONTHS' ? reportRows.slice(-3) : reportRows,
    [period],
  )
  const totals = useMemo(() => visibleRows.reduce((summary, row) => ({
    quotations: summary.quotations + row.quotations,
    won: summary.won + row.won,
    revenue: summary.revenue + row.revenue,
    margin: summary.margin + row.margin,
  }), { quotations: 0, won: 0, revenue: 0, margin: 0 }), [visibleRows])
  const currentDate = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())
  const firstRevenue = visibleRows[0]?.revenue ?? 0
  const lastRevenue = visibleRows.at(-1)?.revenue ?? 0
  const revenueChange = firstRevenue
    ? ((lastRevenue - firstRevenue) / firstRevenue) * 100
    : 0

  async function exportPdf() {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF()
    doc.setFillColor(15, 32, 60)
    doc.rect(0, 0, 210, 35, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(20)
    doc.text('DealFlow360 Sales Performance', 14, 18)
    doc.setFontSize(9)
    doc.text(`Generated ${currentDate} · Currency INR`, 14, 27)
    doc.setTextColor(26, 36, 52)
    doc.setFontSize(11)
    doc.text(`Quoted revenue: ${formatMoney(totals.revenue)}`, 14, 48)
    doc.text(`Win rate: ${((totals.won / totals.quotations) * 100).toFixed(1)}%`, 14, 56)
    doc.text(`Average margin: ${(totals.margin / visibleRows.length).toFixed(1)}%`, 14, 64)
    doc.setFontSize(9)
    let y = 82
    doc.setFont('helvetica', 'bold')
    doc.text('Period', 14, y)
    doc.text('Quotes', 52, y)
    doc.text('Won', 78, y)
    doc.text('Revenue', 102, y)
    doc.text('Avg discount', 145, y)
    doc.text('Margin', 180, y)
    doc.setFont('helvetica', 'normal')
    visibleRows.forEach((row) => {
      y += 10
      doc.text(row.month, 14, y)
      doc.text(String(row.quotations), 52, y)
      doc.text(String(row.won), 78, y)
      doc.text(formatMoney(row.revenue), 102, y)
      doc.text(`${row.avgDiscount}%`, 145, y)
      doc.text(`${row.margin}%`, 180, y)
    })
    doc.save('dealflow-sales-report.pdf')
    toast.success('PDF report exported')
  }

  function exportXls() {
    const headers = ['Period', 'Quotations', 'Won', 'Revenue INR', 'Average Discount', 'Margin']
    const rows = visibleRows.map((row) => [row.month, row.quotations, row.won, row.revenue, row.avgDiscount, row.margin])
    const tableRows = [headers, ...rows]
      .map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="${typeof cell === 'number' ? 'Number' : 'String'}">${xmlEscape(cell)}</Data></Cell>`).join('')}</Row>`)
      .join('')
    const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Sales Performance"><Table>${tableRows}</Table></Worksheet></Workbook>`
    downloadBlob(new Blob([workbook], { type: 'application/vnd.ms-excel' }), 'dealflow-sales-report.xls')
    toast.success('XLS report exported')
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Analytics"
        title="Sales reporting"
        description="Filter performance, pricing discipline and conversion across the organization."
        actions={<><button className="button button--quiet" type="button" onClick={exportPdf}><FileDown size={15} /> Export PDF</button><button className="button button--primary" type="button" onClick={exportXls}><FileSpreadsheet size={15} /> Export XLS</button></>}
      />

      <section className="report-filters report-filters--compact">
        <span><Filter size={16} /> Report filters</span>
        <label><small>Period</small><select name="period" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="3_MONTHS">Last 3 months</option><option value="6_MONTHS">Last 6 months</option></select></label>
      </section>

      <section className="stats-grid stats-grid--three">
        <StatCard icon={TrendingUp} label="Quoted revenue" value={formatMoney(totals.revenue, true)} detail={`${revenueChange >= 0 ? '+' : ''}${revenueChange.toFixed(1)}% from first to latest month`} tone="blue" />
        <StatCard icon={CalendarDays} label="Win rate" value={`${((totals.won / totals.quotations) * 100).toFixed(1)}%`} detail={`${totals.won} of ${totals.quotations} quotations won`} tone="green" />
        <StatCard icon={FileSpreadsheet} label="Average margin" value={`${(totals.margin / visibleRows.length).toFixed(1)}%`} detail={`Across ${visibleRows.length} reporting months`} tone="violet" />
      </section>

      <section className="reports-chart-grid">
        <Panel title="Revenue and wins" description="Monthly quoted revenue with won-deal count.">
          <div className="report-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visibleRows} margin={{ top: 12, right: 10, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(174,196,230,.09)" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#71829d', fontSize: 10 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#71829d', fontSize: 10 }} tickFormatter={(value) => `${value / 1000000}m`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => name === 'revenue' ? formatMoney(value) : value} />
                <Legend wrapperStyle={{ fontSize: 10, color: '#8798b3' }} />
                <Bar dataKey="revenue" name="Quoted revenue" fill="#5d9bff" radius={[5, 5, 0, 0]} />
                <Bar dataKey="won" name="Won deals" fill="#56d39b" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Pricing discipline" description="Discount and gross margin movement.">
          <div className="report-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={visibleRows} margin={{ top: 12, right: 10, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(174,196,230,.09)" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#71829d', fontSize: 10 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#71829d', fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => `${value}%`} />
                <Legend wrapperStyle={{ fontSize: 10, color: '#8798b3' }} />
                <Line type="monotone" dataKey="margin" name="Margin %" stroke="#56d39b" strokeWidth={2.2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="avgDiscount" name="Average discount %" stroke="#f6b94a" strokeWidth={2.2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>

      <Panel title="Performance detail" description="The active filters are applied to every metric and export.">
        <div className="data-table-wrap data-table-wrap--nested">
          <table className="data-table"><thead><tr><th>Period</th><th>Quotations</th><th>Won</th><th>Conversion</th><th>Revenue</th><th>Avg. discount</th><th>Margin</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.month}><td><strong>{row.month}</strong></td><td>{row.quotations}</td><td>{row.won}</td><td>{((row.won / row.quotations) * 100).toFixed(1)}%</td><td><strong>{formatMoney(row.revenue)}</strong></td><td>{row.avgDiscount}%</td><td><span className="text-success">{row.margin}%</span></td></tr>)}</tbody></table>
        </div>
      </Panel>
    </div>
  )
}
