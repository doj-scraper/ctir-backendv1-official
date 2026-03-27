# Changelog

## [Unreleased] - 2026-03-27

### Fixed Build Issues

- **Alert Service**: Removed references to non-existent fields (`enabled`, `lastFiredAt`, `cooldownMinutes`, `windowMinutes`, `firedAt`, `metadata`, `serviceName`, `status`) and removed unused `calculateMetric` method to align with updated Prisma schema.
- **Metrics Service**: Updated to use correct field names (`name` instead of `serviceName`, `value` instead of `latencyMs`, `createdAt` instead of `recordedAt`).
- **Middleware Metrics**: Fixed to use correct Prisma fields for `MetricSnapshot` creation.
- **Monitoring Routes**: Removed invalid `source` field filter and adjusted alert rule creation to match the new schema.
- **Cart Service**: Removed `variant` include from inventory select as the field no longer exists.
- **Catalog Service**: Updated all type definitions to use `string` IDs instead of `number` to match the Prisma schema changes.
- **Inventory Service**: Removed `variant` references and adjusted logic to derive primary model from first compatibility.
- **Order Service**: Removed `variant` select from inventory queries.
- **Event Logger Service**: Fixed metadata type to store JSON string instead of `Prisma.InputJsonValue`.
- **Route Parameters**: Updated catalog and inventory route parameter schemas from `number` to `string` to reflect ID type changes.
- **TypeScript Configuration**: Excluded `prisma/` directory from compilation to avoid migration file type errors.

### What Was Done

The project had drifted from its Prisma schema, particularly after migrating to use string-based IDs (UUIDs/cuids) instead of auto-increment integers. This caused numerous TypeScript errors when trying to access fields that no longer exist or have been renamed.

Each service and route was audited and updated to:
- Use the correct field names from the current Prisma schema
- Remove references to removed relations (like `variant` on Inventory)
- Adjust data transfer objects and mapping functions to match the new ID types
- Ensure all Prisma query includes and selects match the current model definitions

### Next Steps for Developers

1. **Maintain Schema-Code Consistency**: When modifying the Prisma schema, immediately update all corresponding service methods and route handlers to reflect changes.
2. **Use String IDs Consistently**: All ID fields in the database are now strings (UUIDs/cuids). Ensure API parameters, DTOs, and internal mappings treat them as strings.
3. **Avoid Direct Field Access**: Prefer using Prisma's generated types and avoid hardcoding field names in queries where possible.
4. **Test End-to-End**: After schema changes, run the full test suite and manual verification to catch mismatches early.
5. **Monitor Prisma Updates**: The project is behind on Prisma version (6.19.2 vs latest 7.6.0). Consider upgrading following the official migration guide when feasible.
6. **Documentation**: Keep this changelog updated with any future schema or significant code changes.

### Verification

After these changes, the build command `npm run vercel-build` (which runs `prisma generate && tsc`) completes without TypeScript errors.

