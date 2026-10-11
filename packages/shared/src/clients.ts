import type { Role } from './roles';

interface Actor {
  role: Role;
}

/** Roles that can open the Clients pages (`GET /clients`, `GET /clients/:id`). OT gets 403. */
export const CLIENT_VIEW_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM', 'OE', 'RO'];

/** Roles that can add, edit and deactivate clients and sites, and use the geocoder (`/geo/*`). */
export const CLIENT_EDIT_ROLES: readonly Role[] = ['SUPER_ADMIN', 'OM'];

export const canViewClients = (user: Actor): boolean => CLIENT_VIEW_ROLES.includes(user.role);

/** SA or OM may add, edit and deactivate clients and their sites. */
export const canEditClients = (user: Actor): boolean => CLIENT_EDIT_ROLES.includes(user.role);

/** Short client code, e.g. `ZOOM`: trimmed, uppercased, 2–12 letters, digits or dashes. */
export const CLIENT_CODE_PATTERN = /^[A-Z0-9-]{2,12}$/;

/** Default map view: India. */
export const INDIA_MAP_VIEW = { lat: 22.5, lng: 79, zoom: 5 } as const;
