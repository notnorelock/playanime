import { Type, type Static } from '@sinclair/typebox';

/**
 * Dependency health. `degraded` means the service answered but slowly or
 * partially — worth alerting on, not worth failing a load balancer probe over.
 */
export const ServiceHealth = Type.Union([
  Type.Literal('healthy'),
  Type.Literal('degraded'),
  Type.Literal('unhealthy'),
]);
export type ServiceHealth = Static<typeof ServiceHealth>;

export const HealthReport = Type.Object({
  status: ServiceHealth,
  version: Type.String(),
  uptimeSeconds: Type.Integer(),
  checkedAt: Type.String({ format: 'date-time' }),
  services: Type.Object({
    database: Type.Object({
      status: ServiceHealth,
      latencyMs: Type.Union([Type.Number(), Type.Null()]),
      error: Type.Optional(Type.String()),
    }),
    redis: Type.Object({
      status: ServiceHealth,
      latencyMs: Type.Union([Type.Number(), Type.Null()]),
      error: Type.Optional(Type.String()),
    }),
  }),
});
export type HealthReport = Static<typeof HealthReport>;

/** Liveness: is the process up. Never touches a dependency. */
export const LivenessReport = Type.Object({
  status: Type.Literal('alive'),
  uptimeSeconds: Type.Integer(),
});
export type LivenessReport = Static<typeof LivenessReport>;
