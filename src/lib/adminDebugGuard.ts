import { NextResponse } from 'next/server';

export function guardProductionAdminDebugRoute() {
  if (process.env.NODE_ENV !== 'production') {
    return null;
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Not found',
      code: 'ADMIN_DEBUG_ROUTE_DISABLED',
    },
    {
      status: 404,
      headers: {
        'cache-control': 'no-store',
      },
    },
  );
}
