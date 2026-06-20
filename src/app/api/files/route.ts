/**
 * GET /api/files
 *
 * List all uploaded files with pagination.
 * Query params: ?page=1&limit=20
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Hash check used by the local agent to avoid re-uploading existing files
    const hash = searchParams.get('hash')
    if (hash) {
      const existing = await prisma.uploadedFile.findUnique({ where: { fileHash: hash } })
      return NextResponse.json({ exists: Boolean(existing) })
    }

    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)))
    const skip = (page - 1) * limit

    const [files, total] = await Promise.all([
      prisma.uploadedFile.findMany({
        skip,
        take: limit,
        orderBy: { uploadedAt: 'desc' },
        include: {
          company: {
            select: { id: true, name: true, shortName: true },
          },
        },
      }),
      prisma.uploadedFile.count(),
    ])

    return NextResponse.json({ files, total, page, limit })
  } catch (error) {
    console.error('[files] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch files' },
      { status: 500 }
    )
  }
}
