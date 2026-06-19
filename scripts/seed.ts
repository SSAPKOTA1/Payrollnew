import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create companies from the uploaded sample files
  const companies = await Promise.all([
    prisma.company.upsert({
      where: { name: 'Höchster Hof Hotel GmbH' },
      update: {},
      create: {
        name: 'Höchster Hof Hotel GmbH',
        shortName: 'Höchster Hof',
        iban: 'DE42510500150159056233',
      },
    }),
    prisma.company.upsert({
      where: { name: 'Skyline Hotel GmbH' },
      update: {},
      create: {
        name: 'Skyline Hotel GmbH',
        shortName: 'Skyline',
        iban: 'DE14510500150159046358',
      },
    }),
    prisma.company.upsert({
      where: { name: 'Trip Inn Hotel Aschaffenburg GmbH' },
      update: {},
      create: {
        name: 'Trip Inn Hotel Aschaffenburg GmbH',
        shortName: 'Trip Inn Aschaffenburg',
      },
    }),
  ])

  console.log(`Created ${companies.length} companies`)
  console.log('Seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
