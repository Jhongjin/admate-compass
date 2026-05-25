import { redirect } from "next/navigation";
import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

type LoginSearchParams = Record<string, string | string[] | undefined>;

const LOGIN_ERROR_PATTERN = /^[a-z0-9_-]+$/i;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<LoginSearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const nextPath = sanitizeCompassNextPath(firstValue(params?.next));
  const loginError = firstValue(params?.login_error) || firstValue(params?.auth_error);
  const query = new URLSearchParams();

  query.set("next", nextPath);

  if (loginError && LOGIN_ERROR_PATTERN.test(loginError)) {
    query.set("login_error", loginError);
  }

  redirect(`/?${query.toString()}`);
}
