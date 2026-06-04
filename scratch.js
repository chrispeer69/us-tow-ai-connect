const fs = require('fs');
const path = './packages/api/src/db/schema.ts';
let code = fs.readFileSync(path, 'utf8');

const usersTable = `
// ============ USERS ============
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  firstName: varchar('first_name', { length: 255 }),
  lastName: varchar('last_name', { length: 255 }),
  googleId: varchar('google_id', { length: 255 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

`;

// insert usersTable right before tenants
code = code.replace('// ============ TENANTS ============', usersTable + '// ============ TENANTS ============');

// add ownerId to tenants
code = code.replace(
  "companyName: varchar('company_name', { length: 255 }).notNull(),",
  "companyName: varchar('company_name', { length: 255 }).notNull(),\n  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),"
);

// add userId to tenantMembers
code = code.replace(
  "email: varchar('email', { length: 255 }).notNull(),",
  "userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),\n  email: varchar('email', { length: 255 }).notNull(),"
);

// Add usersRelations
const usersRelations = `
export const usersRelations = relations(users, ({ many }) => ({
  tenantMemberships: many(tenantMembers),
  ownedTenants: many(tenants),
}));
`;
code = code.replace('export const tenantsRelations', usersRelations + '\nexport const tenantsRelations');

// Add users to tenantsRelations
code = code.replace(
  "credentials: one(tenantCredentials",
  "owner: one(users, {\n    fields: [tenants.ownerId],\n    references: [users.id],\n  }),\n  credentials: one(tenantCredentials"
);

// Add users to tenantMembersRelations
code = code.replace(
  "tenant: one(tenants",
  "user: one(users, {\n    fields: [tenantMembers.userId],\n    references: [users.id],\n  }),\n  tenant: one(tenants"
);

// Add export type UserRow
code = code.replace('export type TenantRow', 'export type UserRow = typeof users.$inferSelect;\nexport type TenantRow');

fs.writeFileSync(path, code);
