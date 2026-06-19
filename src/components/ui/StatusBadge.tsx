type Status = 'PAID' | 'UNPAID' | 'PARTIAL' | 'NEEDS_REVIEW' | 'OVERPAID'

const statusConfig: Record<Status, { label: string; className: string }> = {
  PAID: {
    label: 'Paid',
    className: 'bg-green-500/15 text-green-400 border border-green-500/30',
  },
  UNPAID: {
    label: 'Unpaid',
    className: 'bg-red-500/15 text-red-400 border border-red-500/30',
  },
  PARTIAL: {
    label: 'Partial',
    className: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  },
  NEEDS_REVIEW: {
    label: 'Needs Review',
    className: 'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  },
  OVERPAID: {
    label: 'Overpaid',
    className: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  },
}

interface StatusBadgeProps {
  status: Status | string
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status as Status] ?? {
    label: status,
    className: 'bg-gray-500/15 text-gray-400 border border-gray-500/30',
  }

  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1'

  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${config.className}`}>
      <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${getDotColor(status as Status)}`} />
      {config.label}
    </span>
  )
}

function getDotColor(status: Status): string {
  switch (status) {
    case 'PAID': return 'bg-green-400'
    case 'UNPAID': return 'bg-red-400'
    case 'PARTIAL': return 'bg-yellow-400'
    case 'NEEDS_REVIEW': return 'bg-orange-400'
    case 'OVERPAID': return 'bg-purple-400'
    default: return 'bg-gray-400'
  }
}
