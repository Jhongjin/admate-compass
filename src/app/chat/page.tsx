import { redirect } from "next/navigation";

type LegacyChatPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LegacyChatPage({ searchParams }: LegacyChatPageProps) {
  const params = (await searchParams) || {};
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const normalized = firstValue(value);
    if (typeof normalized === "string" && normalized.trim()) {
      query.set(key, normalized);
    }
  }

  const suffix = query.toString();
  redirect(suffix ? `/desk?${suffix}` : "/desk");
}
