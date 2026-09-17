export default async function UnsubscribedPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <h1 className="text-xl font-semibold tracking-tight">
        {ok === "0" ? "Something went wrong" : "You're unsubscribed"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {ok === "0"
          ? "That unsubscribe link looks incomplete. If you keep getting emails, reply to one and let us know."
          : "You won't receive any more newsletter emails from us."}
      </p>
    </main>
  );
}
