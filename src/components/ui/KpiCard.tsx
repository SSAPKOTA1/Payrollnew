import { ReactNode } from 'react'

interface KpiCardProps {
  title: string
  value: string
  subtitle?: string
  trend?: number
  icon: ReactNode
  color: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'orange'
}

const colorMap: Record<KpiCardProps['color'], { icon: string; trend: string; border: string }> = {
  blue: {
    icon: 'bg-blue-500/20 text-blue-400',
    trend: 'text-blue-400',
    border: 'border-blue-500/20',
  },
  green: {
    icon: 'bg-green-500/20 text-green-400',
    trend: 'text-green-400',
    border: 'border-green-500/20',
  },
  red: {
    icon: 'bg-red-500/20 text-red-400',
    trend: 'text-red-400',
    border: 'border-red-500/20',
  },
  yellow: {
    icon: 'bg-yellow-500/20 text-yellow-400',
    trend: 'text-yellow-400',
    border: 'border-yellow-500/20',
  },
  purple: {
    icon: 'bg-purple-500/20 text-purple-400',
    trend: 'text-purple-400',
    border: 'border-purple-500/20',
  },
  orange: {
    icon: 'bg-orange-500/20 text-orange-400',
    trend: 'text-orange-400',
    border: 'border-orange-500/20',
  },
}

export function KpiCard({ title, value, subtitle, trend, icon, color }: KpiCardProps) {
  const colors = colorMap[color]

  return (
    <div className={`bg-gray-900 border ${colors.border} rounded-xl p-5 flex flex-col gap-4`}>
      <div className="flex items-start justify-between">
        <div className={`p-2.5 rounded-lg ${colors.icon}`}>
          {icon}
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-sm font-medium ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            )}
            <span>{Math.abs(trend).toFixed(1)}%</span>
          </div>
        )}
      </div>
      <div>
        <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
        <div className="text-sm text-gray-400 mt-0.5">{title}</div>
        {subtitle && (
          <div className="text-xs text-gray-500 mt-1">{subtitle}</div>
        )}
      </div>
    </div>
  )
}
