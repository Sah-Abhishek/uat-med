/**
 * Seeds demo data for the Valerion Health UAT environment.
 *
 * Idempotent — safe to run multiple times. It checks for existing rows
 * (by unique keys like client.code, user.email, worklist.worklistNumber)
 * and skips anything already present.
 *
 * Run:
 *   npx ts-node scripts/seed-demo.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { join } from 'path';

import { Client } from '../src/entities/client.entity';
import { Location } from '../src/entities/location.entity';
import { PrimarySpeciality } from '../src/entities/primary-speciality.entity';
import { User } from '../src/entities/user.entity';
import { Worklist } from '../src/entities/worklist.entity';
import { Chart } from '../src/entities/chart.entity';
import { ServiceLine } from '../src/entities/service-line.entity';

// Global service-line catalogue, in display order (sort_order = index*10).
const SERVICE_LINES = [
  'ED Facility', 'I&I Administration', 'ED Profee', 'EM-OP', 'EM-IP',
  'EM Procedure', 'Ob-gyn', 'New born', 'SDS', 'General Surgery',
  'WHC Profee/ facility', 'ASC', 'Ancillary', 'IP-DRG', 'HCC', 'PT/OT',
  'Surgical Pathology', 'Macular Pathology', 'Radiology', 'IVR', 'Denial/ Edits',
];

dotenv.config({ path: join(process.cwd(), 'env/.env.uat') });

(async () => {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT!,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    entities: [Client, Location, PrimarySpeciality, User, Worklist, Chart, ServiceLine],
    synchronize: false,
  });
  await ds.initialize();

  const clients = ds.getRepository(Client);
  const locations = ds.getRepository(Location);
  const specs = ds.getRepository(PrimarySpeciality);
  const users = ds.getRepository(User);
  const worklists = ds.getRepository(Worklist);
  const charts = ds.getRepository(Chart);
  const serviceLines = ds.getRepository(ServiceLine);

  // ── Service lines (global lookup) ───────────────────────────
  for (let i = 0; i < SERVICE_LINES.length; i++) {
    const name = SERVICE_LINES[i];
    const found = await serviceLines.findOne({ where: { name } });
    if (!found) {
      await serviceLines.save(serviceLines.create({ name, sortOrder: (i + 1) * 10, isActive: true }));
      console.log(`✓ Service line: ${name}`);
    }
  }

  // ── Client ──────────────────────────────────────────────────
  let demoClient = await clients.findOne({ where: { code: 'DEMO' } });
  if (!demoClient) {
    demoClient = await clients.save(
      clients.create({ name: 'Demo Client', code: 'DEMO', isActive: true }),
    );
    console.log(`✓ Client: ${demoClient.name} (id=${demoClient.id})`);
  } else {
    console.log(`• Client already exists: ${demoClient.name} (id=${demoClient.id})`);
  }

  // ── Location ────────────────────────────────────────────────
  let demoLoc = await locations.findOne({ where: { code: 'DF', clientId: demoClient.id } });
  if (!demoLoc) {
    demoLoc = await locations.save(
      locations.create({
        clientId: demoClient.id,
        name: 'Demo Facility',
        code: 'DF',
        isActive: true,
      }),
    );
    console.log(`✓ Location: ${demoLoc.name} (id=${demoLoc.id})`);
  } else {
    console.log(`• Location already exists: ${demoLoc.name} (id=${demoLoc.id})`);
  }

  // ── Specialities ────────────────────────────────────────────
  const specNames = ['ED', 'Cardiology', 'Primary Care'];
  for (const name of specNames) {
    const found = await specs.findOne({ where: { name } });
    if (!found) {
      const s = await specs.save(specs.create({ name, isActive: true }));
      console.log(`✓ Speciality: ${s.name} (id=${s.id})`);
    } else {
      console.log(`• Speciality already exists: ${name} (id=${found.id})`);
    }
  }
  const edSpec = await specs.findOneOrFail({ where: { name: 'ED' } });

  // ── Demo users (all share the same password: DemoPass123!) ─
  const demoPasswordHash = await bcrypt.hash('DemoPass123!', 12);
  const demoUsers = [
    { email: 'manager@demo.val', role: 'MANAGER', fullName: 'Manager Demo' },
    { email: 'auditor@demo.val', role: 'AUDITOR', fullName: 'Auditor Demo' },
    { email: 'coder1@demo.val',  role: 'CODER',   fullName: 'Coder One'   },
    { email: 'coder2@demo.val',  role: 'CODER',   fullName: 'Coder Two'   },
    { email: 'coder3@demo.val',  role: 'CODER',   fullName: 'Coder Three' },
  ] as const;

  for (const u of demoUsers) {
    const existing = await users.findOne({ where: { email: u.email } });
    if (existing) {
      console.log(`• User already exists: ${u.email} (id=${existing.id})`);
      continue;
    }
    const created = await users.save(
      users.create({
        email: u.email,
        fullName: u.fullName,
        role: u.role as any,
        status: 'ACTIVE' as any,
        passwordHash: demoPasswordHash,
        clientId: demoClient.id,
        locationId: demoLoc.id,
        primarySpecialityId: edSpec.id,
      }),
    );
    console.log(`✓ User: ${u.email} (${u.role}, id=${created.id})`);
  }

  // ── Worklist ────────────────────────────────────────────────
  let demoWorklist = await worklists.findOne({ where: { worklistNumber: 'DEMO-001' } });
  if (!demoWorklist) {
    demoWorklist = await worklists.save(
      worklists.create({
        worklistNumber: 'DEMO-001',
        clientId: demoClient.id,
        locationId: demoLoc.id,
        primarySpecialityId: edSpec.id,
        status: 'OPEN' as any,
        receivedDate: '2026-04-18' as any,
        totalCharts: 10,
      }),
    );
    console.log(`✓ Worklist: ${demoWorklist.worklistNumber} (id=${demoWorklist.id})`);
  } else {
    console.log(`• Worklist already exists: ${demoWorklist.worklistNumber} (id=${demoWorklist.id})`);
  }

  // ── 10 placeholder charts ───────────────────────────────────
  const existingChartCount = await charts.count({ where: { worklistId: demoWorklist.id } });
  if (existingChartCount === 0) {
    const rows = [];
    for (let i = 1; i <= 10; i++) {
      rows.push(
        charts.create({
          worklistId: demoWorklist.id,
          serialNo: i,
          chartNo: `CHART-${String(i).padStart(4, '0')}`,
          mrNumber: `MR${100000 + i}`,
          milestone: 'READY_TO_CODE' as any,
          chartStatus: 'OPEN' as any,
          priority: (i <= 3 ? 'HIGH' : 'MEDIUM') as any,
        }),
      );
    }
    await charts.save(rows);
    console.log(`✓ Seeded 10 charts under worklist ${demoWorklist.worklistNumber}`);
  } else {
    console.log(`• Charts already exist (${existingChartCount}) under worklist ${demoWorklist.worklistNumber}`);
  }

  console.log('\n─── Seed complete ───');
  console.log(`Demo password for all seeded users: DemoPass123!`);
  console.log(`Try:  POST /auth/login  { "username": "manager@demo.val", "password": "DemoPass123!" }`);

  await ds.destroy();
})().catch(e => {
  console.error(e);
  process.exit(1);
});