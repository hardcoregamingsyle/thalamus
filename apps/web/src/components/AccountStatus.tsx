import type { MeAccount } from "@/lib/types";
import { WaitlistJoinButton } from "./WaitlistJoinButton";

/**
 * The account-status half of /console and /chat: renders for every status
 * except "invited"/"active", which each page treats as "has access" and
 * renders its own content for instead. Returns null for those two statuses.
 */
export function AccountStatus({
  account,
  waitlistPosition,
  onJoined,
}: {
  account: MeAccount | null;
  waitlistPosition: number | null;
  onJoined: () => void;
}) {
  if (!account || account.status === "none") {
    return (
      <div>
        <h2 className="font-medium">You're signed in, but haven't joined the waitlist yet.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Thalamus is in private beta. Join the waitlist and we'll invite accounts in order.
        </p>
        <div className="mt-4">
          <WaitlistJoinButton onJoined={onJoined} />
        </div>
      </div>
    );
  }

  if (account.status === "waitlisted") {
    return (
      <div>
        <h2 className="font-medium">You're on the waitlist.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {typeof waitlistPosition === "number"
            ? `Position ${waitlistPosition}.`
            : "We'll email you when it's your turn."}{" "}
          See the <a href="/docs">docs</a> in the meantime.
        </p>
      </div>
    );
  }

  if (account.status === "suspended") {
    return (
      <div>
        <h2 className="font-medium">This account is suspended.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Contact support if you think this is a mistake.
        </p>
      </div>
    );
  }

  return null;
}

export function hasAccess(account: MeAccount | null): boolean {
  return account?.status === "invited" || account?.status === "active";
}
