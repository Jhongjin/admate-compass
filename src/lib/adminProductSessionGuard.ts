import { NextResponse, type NextRequest } from 'next/server';
import {
  readCompassProductSessionFromRequest,
  type CompassProductSession,
} from '@/lib/auth/coreHandoff';

const NO_STORE_HEADERS = {
  'cache-control': 'no-store',
};

function hasAdminProductSession(session: CompassProductSession | null) {
  if (!session) return false;

  return Boolean(
    session.permissions.canManage ||
      session.adminNavigation.canManageAccessRequests ||
      session.adminNavigation.canManageOrganizations ||
      session.adminNavigation.canManageUsers,
  );
}

export function guardCompassProductAdminSessionRoute(request: NextRequest) {
  if (hasAdminProductSession(readCompassProductSessionFromRequest(request))) {
    return null;
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Authentication required',
    },
    {
      status: 401,
      headers: NO_STORE_HEADERS,
    },
  );
}
