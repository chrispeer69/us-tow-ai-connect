import { AcceptInviteClient } from './AcceptInviteClient';

export const metadata = {
  title: 'Accept invitation — US Tow AI-Connect',
  description: "Accept your invitation to a US Tow AI-Connect workspace.",
};

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; email?: string | string[] }>;
}) {
  const sp = await searchParams;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const token = pick(sp.token)?.trim() ?? '';
  const email = pick(sp.email)?.trim() ?? '';
  return <AcceptInviteClient token={token} email={email} />;
}
